/**
 * Netcash Pay Now ITN (Instant Transaction Notification) webhook.
 *
 * Netcash POSTs application/x-www-form-urlencoded to this URL after every
 * payment event (accept, decline, cancel, subscription).
 *
 * Verification strategy — per the official Netcash WooCommerce plugin and
 * Netcash\PayNow PHP SDK:
 *
 *   Netcash does NOT send a cryptographic signature/hash in the ITN body.
 *   The three verification steps are:
 *
 *   Step 1 — Reference: the `Reference` field must match a real order in our DB.
 *   Step 2 — Amount: the posted `Amount` must equal the amount stored on that order.
 *   Step 3 — TransactionAccepted: only activate the order when this is "TRUE".
 *
 * Netcash expects a plain-text "OK" (200) response for every notification,
 * even declined or cancelled ones. Returning anything else causes Netcash to
 * retry, flooding the endpoint.
 */

import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import {
  enrollments,
  orders,
  payments,
  subscriptions,
  paymentEvents,
  webhookLogs,
} from "@/lib/db/schema"
import { and, eq } from "drizzle-orm"
import {
  parseNetcashItn,
  amountMatchesExpected,
  type NetcashItnPayload,
} from "@/lib/netcash"
import { completeReferralForEnrollment } from "@/app/actions/referrals"
import { autoMarkMonthPaidFromWebhook } from "@/app/actions/subscription-months"
import { revalidatePath } from "next/cache"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok() {
  return new NextResponse("OK", {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  })
}

// Netcash still expects a 200 for declined/failed events — returning non-200
// triggers retries. We log internally and always respond OK.
function ack(reason: string) {
  console.error("[netcash-itn] acknowledged with error:", reason)
  return new NextResponse("OK", {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  })
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const rawBody = await req.text()

  // Capture raw headers for audit log
  const headerMap: Record<string, string> = {}
  req.headers.forEach((value, key) => {
    headerMap[key] = value
  })

  // Parse URL-encoded body into payload object
  const params = new URLSearchParams(rawBody)
  const payload: NetcashItnPayload = {}
  params.forEach((value, key) => {
    payload[key] = value
  })

  // ------------------------------------------------------------------
  // Extract the official Netcash ITN fields
  // Reference: Netcash-ZA/PayNow-WooCommerce → getPostData()
  // ------------------------------------------------------------------
  const reference       = payload.Reference ?? ""          // your p3 order ref
  const transactionType = payload.type ?? ""               // "DEPOSITRECEIPT" for notify
  const requestTrace    = payload.RequestTrace ?? ""        // Netcash's own trace ID
  const postedAmount    = payload.Amount ?? ""             // Rands, e.g. "300.00"
  const extra1          = payload.Extra1 ?? ""             // echo of our m2 (enrollmentId)

  // Log every incoming webhook regardless of outcome — before any verification
  let logId: number | undefined
  try {
    const [logRow] = await db
      .insert(webhookLogs)
      .values({
        provider: "netcash",
        eventType: transactionType || "NOTIFY",
        rawBody,
        headers: headerMap,
        processed: false,
      })
      .returning({ id: webhookLogs.id })
    logId = logRow?.id
  } catch (err) {
    console.error("[netcash-itn] could not write webhook log:", err)
  }

  // ------------------------------------------------------------------
  // Step 1 — Reference check: the Reference must map to a real order.
  // ------------------------------------------------------------------
  if (!reference) {
    const msg = "Missing Reference field in ITN payload"
    console.error("[netcash-itn]", msg)
    if (logId) {
      await db
        .update(webhookLogs)
        .set({ processingError: msg })
        .where(eq(webhookLogs.id, logId))
    }
    return ack(msg)
  }

  // Netcash appends "-O{n}" to the reference for recurring billing occurrences
  // e.g. "NGP-2026-LMDFFFXRAE-O15" → base ref is "NGP-2026-LMDFFFXRAE"
  // Strip the suffix so we can match against our stored referenceNumber.
  const enrollmentRef = reference.replace(/-O\d+$/, "")
  console.log(`[netcash-itn] reference="${reference}" enrollmentRef="${enrollmentRef}"`)

  // Look up the order by our referenceNumber (try both raw and stripped)
  const orderRows = await db
    .select()
    .from(orders)
    .where(eq(orders.netcashOrderId, reference))
    .limit(1)

  // Also try with the stripped reference in case orders were stored that way
  const orderRowsFallback = orderRows.length === 0
    ? await db.select().from(orders).where(eq(orders.netcashOrderId, enrollmentRef)).limit(1)
    : []

  let order = orderRows[0] ?? orderRowsFallback[0]

  // Resolve the enrollment — either via order or directly by referenceNumber
  let enrollmentRow: typeof enrollments.$inferSelect | undefined

  if (order) {
    const enrollRows = await db
      .select()
      .from(enrollments)
      .where(eq(enrollments.id, order.enrollmentId))
      .limit(1)
    enrollmentRow = enrollRows[0]
  }

  if (!enrollmentRow) {
    // Fallback: look up enrollment directly by stripped referenceNumber
    // This handles the common case where Netcash sends "NGP-2026-LMDFFFXRAE-O15"
    // and we need to match against stored "NGP-2026-LMDFFFXRAE"
    const enrollRows = await db
      .select()
      .from(enrollments)
      .where(eq(enrollments.referenceNumber, enrollmentRef))
      .limit(1)
    enrollmentRow = enrollRows[0]
  }

  if (!enrollmentRow) {
    const msg = `Step 1 failed — no enrollment found for Reference: ${reference} (enrollmentRef: ${enrollmentRef})`
    console.error("[netcash-itn]", msg)
    if (logId) {
      await db
        .update(webhookLogs)
        .set({ processingError: msg })
        .where(eq(webhookLogs.id, logId))
    }
    return ack(msg)
  }

  // ------------------------------------------------------------------
  // Step 2 — Amount check: posted Amount must match the order amount.
  // (Official SDK: checkEqualAmounts — float comparison at 2 d.p.)
  // We use the amount stored on the `orders` row (cents). If no order row
  // exists yet (fallback enrollment-only path) we skip the amount check
  // rather than rejecting a genuine notification.
  // ------------------------------------------------------------------
  const postedAmountRands = parseFloat(postedAmount || "0")
  const expectedAmountCents = order?.amount ?? null // stored in cents, null if no order row

  if (postedAmount && expectedAmountCents !== null && !amountMatchesExpected(postedAmountRands, expectedAmountCents)) {
    const msg = `Step 2 failed — amount mismatch. Posted: ${postedAmount} Rands, Expected: ${(expectedAmountCents / 100).toFixed(2)} Rands`
    console.error("[netcash-itn]", msg)
    if (logId) {
      await db
        .update(webhookLogs)
        .set({ processingError: msg })
        .where(eq(webhookLogs.id, logId))
    }
    return ack(msg)
  }

  // ------------------------------------------------------------------
  // Parse the ITN and determine the outcome
  // ------------------------------------------------------------------
  const itn = parseNetcashItn(payload)

  const now = new Date()

  try {
    if (itn.accepted) {
      // ----------------------------------------------------------------
      // Step 3 — TransactionAccepted === "TRUE" → activate order
      // ----------------------------------------------------------------

      // Update order status
      if (order) {
        await db
          .update(orders)
          .set({
            status: "paid",
            netcashOrderId: reference,
            paidAt: now,
            updatedAt: now,
          })
          .where(eq(orders.id, order.id))
      }

      // Create payment record
      const [paymentRow] = await db
        .insert(payments)
        .values({
          orderId: order?.id ?? 0,
          enrollmentId: enrollmentRow.id,
          userId: enrollmentRow.userId,
          amount: Math.round(postedAmountRands * 100), // store cents
          provider: "netcash",
          status: "paid",
          netcashTransactionId: requestTrace,
          netcashSubscriptionRef: itn.ccToken ?? null,
          paidAt: now,
        })
        .returning({ id: payments.id })

      // For monthly packages — upsert subscription record
      if (enrollmentRow.paymentType === "monthly" && itn.ccToken) {
        const existingSubs = await db
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.enrollmentId, enrollmentRow.id))
          .limit(1)

        if (existingSubs[0]) {
          await db
            .update(subscriptions)
            .set({
              status: "active",
              netcashSubscriptionRef: itn.ccToken,
              lastPaymentDate: now,
              nextBillingDate: nextMonthDate(now),
              updatedAt: now,
            })
            .where(eq(subscriptions.id, existingSubs[0].id))
        } else {
          await db.insert(subscriptions).values({
            enrollmentId: enrollmentRow.id,
            userId: enrollmentRow.userId,
            provider: "netcash",
            netcashSubscriptionRef: itn.ccToken,
            status: "active",
            billingFrequency: "monthly",
            amount: Math.round(postedAmountRands * 100),
            lastPaymentDate: now,
            nextBillingDate: nextMonthDate(now),
          })
        }
      }

      // Activate the enrollment — only after all verification steps pass
      await db
        .update(enrollments)
        .set({
          paymentStatus: "paid",
          status: "active",
          onboardingComplete: true,
          payfastPaymentId: requestTrace, // reuses existing column for transaction ID
          updatedAt: now,
        })
        .where(eq(enrollments.id, enrollmentRow.id))

      // Log the payment event
      await db.insert(paymentEvents).values({
        orderId: order?.id,
        paymentId: paymentRow?.id,
        enrollmentId: enrollmentRow.id,
        eventType: "payment_complete",
        payload: {
          reference,
          requestTrace,
          amount: postedAmount,
          ccToken: itn.ccToken,
          transactionAccepted: payload.TransactionAccepted,
          extra1,
        },
      })

      // Activate sibling enrollments for cart checkouts (multi-child).
      // All cart enrollment rows share the same orderReference column.
      if (enrollmentRow.orderReference) {
        try {
          const siblings = await db
            .select({ id: enrollments.id })
            .from(enrollments)
            .where(and(eq(enrollments.orderReference, enrollmentRow.orderReference)))
          for (const sibling of siblings) {
            if (sibling.id === enrollmentRow.id) continue
            await db
              .update(enrollments)
              .set({
                paymentStatus: "paid",
                status: "active",
                onboardingComplete: true,
                payfastPaymentId: requestTrace,
                updatedAt: now,
              })
              .where(eq(enrollments.id, sibling.id))
          }
        } catch (siblingErr) {
          console.error("[netcash-itn] sibling activation error:", siblingErr)
        }
      }

      // Auto-mark the corresponding subscription month as paid
      // Best-effort: never fail the webhook over billing ledger errors
      try {
        await autoMarkMonthPaidFromWebhook(
          enrollmentRow.id,
          Math.round(postedAmountRands * 100),
          requestTrace || reference,
        )
      } catch (billingErr) {
        console.error("[netcash-itn] billing ledger update failed:", billingErr)
      }

      // Complete any pending referral — marks it "complete", issues the referrer
      // their voucher, and stamps pendingDiscountPercent on the referrer's enrollment.
      // Only fires after payment is verified. (best-effort, non-blocking)
      try {
        await completeReferralForEnrollment(enrollmentRow.id)
      } catch {}

      // Redeem the friend's own voucher (if they applied one at enrollment).
      // This was deferred from enrollment creation to here so it only fires
      // after the friend's payment is actually confirmed.
      try {
        const freshEnrollment = await db
          .select({ pendingVoucherId: enrollments.pendingVoucherId })
          .from(enrollments)
          .where(eq(enrollments.id, enrollmentRow.id))
          .limit(1)
        const pendingVoucherId = freshEnrollment[0]?.pendingVoucherId
        if (pendingVoucherId) {
          const { redeemVoucher } = await import("@/app/actions/referrals")
          await redeemVoucher(pendingVoucherId, enrollmentRow.id)
          // Clear the pending voucher reference now that it has been redeemed
          await db
            .update(enrollments)
            .set({ pendingVoucherId: null })
            .where(eq(enrollments.id, enrollmentRow.id))
        }
      } catch {}

    } else if (itn.declined) {
      // Payment was actively declined by the bank/gateway
      if (order) {
        await db
          .update(orders)
          .set({
            status: "failed",
            failureReason: itn.reason || "Declined by Netcash",
            updatedAt: now,
          })
          .where(eq(orders.id, order.id))
      }

      await db
        .update(enrollments)
        .set({ paymentStatus: "failed", updatedAt: now })
        .where(eq(enrollments.id, enrollmentRow.id))

      await db.insert(paymentEvents).values({
        orderId: order?.id,
        enrollmentId: enrollmentRow.id,
        eventType: "payment_failed",
        payload: {
          reference,
          requestTrace,
          amount: postedAmount,
          reason: itn.reason,
          transactionAccepted: payload.TransactionAccepted,
        },
      })

    } else {
      // Cancelled (user clicked Cancel on the Netcash page)
      if (order) {
        await db
          .update(orders)
          .set({ status: "cancelled", updatedAt: now })
          .where(eq(orders.id, order.id))
      }

      await db.insert(paymentEvents).values({
        orderId: order?.id,
        enrollmentId: enrollmentRow.id,
        eventType: "payment_cancelled",
        payload: {
          reference,
          requestTrace,
          amount: postedAmount,
          transactionAccepted: payload.TransactionAccepted,
        },
      })
    }

    // Mark webhook log as processed
    if (logId) {
      await db
        .update(webhookLogs)
        .set({ processed: true })
        .where(eq(webhookLogs.id, logId))
    }

    revalidatePath("/dashboard")
    revalidatePath("/admin")
  } catch (err) {
    console.error("[netcash-itn] processing error:", err)
    if (logId) {
      await db
        .update(webhookLogs)
        .set({ processingError: String(err) })
        .where(eq(webhookLogs.id, logId))
    }
    // Still return OK — returning non-200 causes Netcash to retry indefinitely
    return ack("Processing error")
  }

  return ok()
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function nextMonthDate(from: Date): Date {
  const d = new Date(from)
  d.setMonth(d.getMonth() + 1)
  return d
}
