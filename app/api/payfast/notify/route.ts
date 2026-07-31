/**
 * PayFast ITN (Instant Transaction Notification) webhook.
 *
 * PayFast POSTs to this URL after a payment is processed.
 * We verify the signature, confirm with PayFast's servers, and update
 * the enrollment payment status in the database.
 *
 * PayFast docs: https://developers.payfast.co.za/docs#notify
 */

import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { enrollments } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { redeemVoucher } from "@/app/actions/referrals"
import { verifyItnSignature } from "@/lib/payfast"
import { completeReferralForEnrollment } from "@/app/actions/referrals"

// PayFast requires a 200 text/plain response.
function ok() {
  return new NextResponse("OK", { status: 200, headers: { "Content-Type": "text/plain" } })
}

function reject(reason: string) {
  console.log("[v0] PayFast ITN rejected:", reason)
  return new NextResponse("FAILED", { status: 200, headers: { "Content-Type": "text/plain" } })
}

export async function POST(req: NextRequest) {
  // Parse URL-encoded body
  const text = await req.text()
  const params = Object.fromEntries(new URLSearchParams(text))

  const passphrase = process.env.PAYFAST_PASSPHRASE ?? ""
  const merchantId = process.env.PAYFAST_MERCHANT_ID ?? ""

  console.log("[PayFast ITN] received payment_status:", params.payment_status, "m_payment_id:", params.m_payment_id, "pf_payment_id:", params.pf_payment_id)

  // 1. Verify signature
  if (!verifyItnSignature(params, passphrase)) {
    console.log("[PayFast ITN] signature mismatch — computed vs received. Keys in body:", Object.keys(params).join(", "))
    return reject("Invalid signature")
  }

  // 2. Verify merchant_id
  if (params.merchant_id !== merchantId) {
    return reject("Merchant ID mismatch")
  }

  // 3. Validate with PayFast servers (confirm the ITN is genuine)
  try {
    const validationUrl =
      process.env.NODE_ENV === "production"
        ? "https://www.payfast.co.za/eng/query/validate"
        : "https://sandbox.payfast.co.za/eng/query/validate"

    const validationResponse = await fetch(validationUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: text,
    })
    const validationText = await validationResponse.text()
    if (!validationText.includes("VALID")) {
      return reject("ITN validation failed: " + validationText)
    }
  } catch (err) {
    return reject("Could not reach PayFast validation server: " + String(err))
  }

  const { m_payment_id, pf_payment_id, payment_status } = params

  if (!m_payment_id) {
    return reject("Missing m_payment_id")
  }

  // 4. Update the enrollment
  const newPaymentStatus =
    payment_status === "COMPLETE" ? "complete"
    : payment_status === "FAILED" ? "failed"
    : payment_status === "CANCELLED" ? "cancelled"
    : "pending"

  const newStatus = payment_status === "COMPLETE" ? "active" : "pending"

  const updated = await db
    .update(enrollments)
    .set({
      paymentType: "payfast",
      paymentStatus: newPaymentStatus,
      payfastPaymentId: pf_payment_id ?? null,
      status: newStatus,
      onboardingComplete: payment_status === "COMPLETE",
      updatedAt: new Date(),
    })
    .where(eq(enrollments.referenceNumber, m_payment_id))
    .returning({ id: enrollments.id })

  console.log("[PayFast ITN] DB updated rows:", updated.length, "for reference:", m_payment_id, "-> paymentStatus:", newPaymentStatus)

  if (payment_status === "COMPLETE" && updated[0]?.id) {
    const enrollmentId = updated[0].id

    // Complete the referral — marks it done, issues referrer their voucher,
    // and stamps pendingDiscountPercent on the referrer's enrollment.
    try { await completeReferralForEnrollment(enrollmentId) } catch {}

    // Redeem the friend's own voucher deferred from enrollment creation.
    try {
      const [fresh] = await db
        .select({ pendingVoucherId: enrollments.pendingVoucherId })
        .from(enrollments)
        .where(eq(enrollments.id, enrollmentId))
        .limit(1)
      if (fresh?.pendingVoucherId) {
        await redeemVoucher(fresh.pendingVoucherId, enrollmentId)
        await db
          .update(enrollments)
          .set({ pendingVoucherId: null })
          .where(eq(enrollments.id, enrollmentId))
      }
    } catch {}
  }

  return ok()
}
