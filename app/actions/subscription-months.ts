"use server"

import { db } from "@/lib/db"
import { subscriptionMonths, enrollments, packages } from "@/lib/db/schema"
import { eq, and, inArray, asc, desc, sql } from "drizzle-orm"
import { requireAdmin } from "@/lib/admin-auth"
import { revalidatePath } from "next/cache"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SubscriptionMonthRow = {
  id: number
  enrollmentId: number
  year: number
  month: number
  amountCents: number
  status: string
  discountPct: number
  discountReason: string | null
  paidCents: number | null
  paymentReference: string | null
  notes: string | null
  paidAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type BillingLedgerEntry = SubscriptionMonthRow & {
  childName: string
  parentName: string
  parentEmail: string
  parentMobile: string
  packageName: string
  club: string
  referenceNumber: string
}

export type MonthLabel = { year: number; month: number; label: string }

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  "Jan","Feb","Mar","Apr","May","Jun",
  "Jul","Aug","Sep","Oct","Nov","Dec",
]

// Current academic/billing year window: Aug–Dec 2026
const BILLING_START_YEAR  = 2026
const BILLING_START_MONTH = 8   // August
const BILLING_END_MONTH   = 12  // December

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMonth(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`
}

/** Generate all (year, month) pairs for Aug–Dec of a given year */
function getBillingMonths(year: number): { year: number; month: number }[] {
  const months: { year: number; month: number }[] = []
  for (let m = BILLING_START_MONTH; m <= BILLING_END_MONTH; m++) {
    months.push({ year, month: m })
  }
  return months
}

// ---------------------------------------------------------------------------
// Generate / backfill months for a single enrollment (idempotent)
// ---------------------------------------------------------------------------

export async function generateMonthsForEnrollment(
  enrollmentId: number,
  amountCents: number,
  year = BILLING_START_YEAR,
): Promise<void> {
  const months = getBillingMonths(year)
  for (const { year: y, month: m } of months) {
    await db
      .insert(subscriptionMonths)
      .values({
        enrollmentId,
        year: y,
        month: m,
        amountCents,
        status: "outstanding",
      })
      .onConflictDoNothing()
  }
}

// ---------------------------------------------------------------------------
// Backfill ALL active/pending enrollments (idempotent — safe to run anytime)
// ---------------------------------------------------------------------------

export async function backfillAllEnrollments(): Promise<{ generated: number }> {
  try {
    await requireAdmin()
  } catch {
    return { generated: 0 }
  }

  // Load all active/pending enrollments with their package price
  const rows = await db
    .select({
      id: enrollments.id,
      packageName: enrollments.packageName,
      status: enrollments.status,
      paymentType: enrollments.paymentType,
    })
    .from(enrollments)
    .where(inArray(enrollments.status, ["active", "pending"]))

  // Load package prices for lookup
  const pkgRows = await db.select({ name: packages.name, price: packages.price }).from(packages)
  const pkgMap = new Map(pkgRows.map((p) => [p.name, p.price]))

  let generated = 0
  for (const enr of rows) {
    // Only generate months for monthly packages
    if (enr.paymentType === "once-off") continue
    const amountCents = (pkgMap.get(enr.packageName) ?? 0) * 100
    const months = getBillingMonths(BILLING_START_YEAR)
    for (const { year: y, month: m } of months) {
      const result = await db
        .insert(subscriptionMonths)
        .values({
          enrollmentId: enr.id,
          year: y,
          month: m,
          amountCents,
          status: "outstanding",
        })
        .onConflictDoNothing()
        .returning({ id: subscriptionMonths.id })
      if (result.length > 0) generated++
    }
  }

  revalidatePath("/admin")
  return { generated }
}

// ---------------------------------------------------------------------------
// Get months for a single enrollment
// ---------------------------------------------------------------------------

export async function getMonthsForEnrollment(
  enrollmentId: number,
): Promise<SubscriptionMonthRow[]> {
  const rows = await db
    .select()
    .from(subscriptionMonths)
    .where(eq(subscriptionMonths.enrollmentId, enrollmentId))
    .orderBy(asc(subscriptionMonths.year), asc(subscriptionMonths.month))
  return rows
}

// ---------------------------------------------------------------------------
// Get full billing ledger (all enrollments + their months)
// ---------------------------------------------------------------------------

export async function getBillingLedger(year = BILLING_START_YEAR): Promise<BillingLedgerEntry[]> {
  try {
    await requireAdmin()
  } catch {
    return []
  }

  const rows = await db
    .select({
      id: subscriptionMonths.id,
      enrollmentId: subscriptionMonths.enrollmentId,
      year: subscriptionMonths.year,
      month: subscriptionMonths.month,
      amountCents: subscriptionMonths.amountCents,
      status: subscriptionMonths.status,
      discountPct: subscriptionMonths.discountPct,
      discountReason: subscriptionMonths.discountReason,
      paidCents: subscriptionMonths.paidCents,
      paymentReference: subscriptionMonths.paymentReference,
      notes: subscriptionMonths.notes,
      paidAt: subscriptionMonths.paidAt,
      createdAt: subscriptionMonths.createdAt,
      updatedAt: subscriptionMonths.updatedAt,
      childName: enrollments.childName,
      parentName: enrollments.parentName,
      parentEmail: enrollments.parentEmail,
      parentMobile: enrollments.parentMobile,
      packageName: enrollments.packageName,
      club: enrollments.club,
      referenceNumber: enrollments.referenceNumber,
    })
    .from(subscriptionMonths)
    .innerJoin(enrollments, eq(subscriptionMonths.enrollmentId, enrollments.id))
    .where(eq(subscriptionMonths.year, year))
    .orderBy(asc(enrollments.childName), asc(subscriptionMonths.month))

  return rows
}

// ---------------------------------------------------------------------------
// Outstanding report — enrollments with at least one outstanding month
// ---------------------------------------------------------------------------

export type OutstandingEntry = {
  enrollmentId: number
  childName: string
  parentName: string
  parentEmail: string
  parentMobile: string
  packageName: string
  club: string
  referenceNumber: string
  outstandingMonths: {
    id: number
    year: number
    month: number
    amountCents: number
    remainingCents: number  // amountCents - paidCents (for partial) or amountCents
    status: string
    label: string
  }[]
  totalOutstandingCents: number
}

export async function getOutstandingReport(year = BILLING_START_YEAR): Promise<OutstandingEntry[]> {
  try {
    await requireAdmin()
  } catch {
    return []
  }

  // Include both 'outstanding' and 'partial' months — partial still has a balance
  const rows = await db
    .select({
      id: subscriptionMonths.id,
      enrollmentId: subscriptionMonths.enrollmentId,
      year: subscriptionMonths.year,
      month: subscriptionMonths.month,
      amountCents: subscriptionMonths.amountCents,
      discountPct: subscriptionMonths.discountPct,
      discountReason: subscriptionMonths.discountReason,
      paidCents: subscriptionMonths.paidCents,
      status: subscriptionMonths.status,
      childName: enrollments.childName,
      parentName: enrollments.parentName,
      parentEmail: enrollments.parentEmail,
      parentMobile: enrollments.parentMobile,
      packageName: enrollments.packageName,
      club: enrollments.club,
      referenceNumber: enrollments.referenceNumber,
    })
    .from(subscriptionMonths)
    .innerJoin(enrollments, eq(subscriptionMonths.enrollmentId, enrollments.id))
    .where(
      and(
        eq(subscriptionMonths.year, year),
        // outstanding OR partial (partial still has a remaining balance)
        sql`${subscriptionMonths.status} IN ('outstanding', 'partial')`,
      )
    )
    .orderBy(asc(enrollments.childName), asc(subscriptionMonths.month))

  // Group by enrollmentId
  const map = new Map<number, OutstandingEntry>()
  for (const row of rows) {
    if (!map.has(row.enrollmentId)) {
      map.set(row.enrollmentId, {
        enrollmentId: row.enrollmentId,
        childName: row.childName,
        parentName: row.parentName,
        parentEmail: row.parentEmail,
        parentMobile: row.parentMobile,
        packageName: row.packageName,
        club: row.club,
        referenceNumber: row.referenceNumber,
        outstandingMonths: [],
        totalOutstandingCents: 0,
      })
    }
    const entry = map.get(row.enrollmentId)!
    // Effective due amount after discount
    const discountedCents = Math.round(row.amountCents * (1 - (row.discountPct ?? 0) / 100))
    // Remaining = discounted total minus what's already been paid (for partial)
    const remainingCents = row.status === "partial"
      ? Math.max(0, discountedCents - (row.paidCents ?? 0))
      : discountedCents
    entry.outstandingMonths.push({
      id: row.id,
      year: row.year,
      month: row.month,
      amountCents: row.amountCents,
      remainingCents,
      status: row.status,
      label: formatMonth(row.year, row.month),
    })
    entry.totalOutstandingCents += remainingCents
  }

  return [...map.values()]
    .filter((e) => e.totalOutstandingCents > 0)
    .sort((a, b) => a.childName.localeCompare(b.childName))
}

// ---------------------------------------------------------------------------
// Revenue report — totals by month
// ---------------------------------------------------------------------------

export type RevenueMonthSummary = {
  year: number
  month: number
  label: string
  paidCents: number
  outstandingCents: number
  waivedCents: number
  totalCents: number
  paidCount: number
  outstandingCount: number
}

export async function getRevenueReport(year = BILLING_START_YEAR): Promise<RevenueMonthSummary[]> {
  try {
    await requireAdmin()
  } catch {
    return []
  }

  const rows = await db
    .select({
      year: subscriptionMonths.year,
      month: subscriptionMonths.month,
      status: subscriptionMonths.status,
      amountCents: subscriptionMonths.amountCents,
      discountPct: subscriptionMonths.discountPct,
      paidCents: subscriptionMonths.paidCents,
    })
    .from(subscriptionMonths)
    .where(eq(subscriptionMonths.year, year))
    .orderBy(asc(subscriptionMonths.month))

  // Build summary per month
  const monthMap = new Map<string, RevenueMonthSummary>()
  for (let m = BILLING_START_MONTH; m <= BILLING_END_MONTH; m++) {
    const key = `${year}-${m}`
    monthMap.set(key, {
      year,
      month: m,
      label: formatMonth(year, m),
      paidCents: 0,
      outstandingCents: 0,
      waivedCents: 0,
      totalCents: 0,
      paidCount: 0,
      outstandingCount: 0,
    })
  }

  for (const row of rows) {
    const key = `${row.year}-${row.month}`
    const summary = monthMap.get(key)
    if (!summary) continue
    const discountedCents = Math.round(row.amountCents * (1 - (row.discountPct ?? 0) / 100))
    summary.totalCents += discountedCents
    if (row.status === "paid") {
      summary.paidCents += discountedCents
      summary.paidCount++
    } else if (row.status === "outstanding") {
      summary.outstandingCents += discountedCents
      summary.outstandingCount++
    } else if (row.status === "partial") {
      // Partial: paidCents counts as collected, remainder is outstanding
      const paid = row.paidCents ?? 0
      const remaining = Math.max(0, discountedCents - paid)
      summary.paidCents += paid
      summary.outstandingCents += remaining
      if (remaining > 0) summary.outstandingCount++
      else summary.paidCount++
    }
  }

  return [...monthMap.values()]
}

// ---------------------------------------------------------------------------
// Mark a single month as paid / outstanding / waived / deferred
// ---------------------------------------------------------------------------

export async function updateMonthStatus(
  id: number,
  status: "outstanding" | "paid" | "partial",
  opts?: {
    paymentReference?: string
    notes?: string
    discountPct?: number
    discountReason?: string
    paidCents?: number
  },
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin()
    await db
      .update(subscriptionMonths)
      .set({
        status,
        paidAt: status === "paid" ? new Date() : null,
        discountPct: opts?.discountPct ?? 0,
        discountReason: opts?.discountReason ?? null,
        paidCents: status === "partial" ? (opts?.paidCents ?? null) : null,
        paymentReference: opts?.paymentReference ?? null,
        notes: opts?.notes ?? null,
        updatedAt: new Date(),
      })
      .where(eq(subscriptionMonths.id, id))
    revalidatePath("/admin")
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Update failed" }
  }
}

// ---------------------------------------------------------------------------
// Bulk mark months for an enrollment as paid (e.g. lump sum)
// ---------------------------------------------------------------------------

export async function bulkMarkPaid(
  ids: number[],
  paymentReference?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin()
    if (ids.length === 0) return { ok: true }
    await db
      .update(subscriptionMonths)
      .set({
        status: "paid",
        paidAt: new Date(),
        paymentReference: paymentReference ?? null,
        updatedAt: new Date(),
      })
      .where(inArray(subscriptionMonths.id, ids))
    revalidatePath("/admin")
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Bulk update failed" }
  }
}

// ---------------------------------------------------------------------------
// Auto-mark month paid from Netcash webhook (called internally, no auth check)
// ---------------------------------------------------------------------------

export async function autoMarkMonthPaidFromWebhook(
  enrollmentId: number,
  amountCents: number,
  paymentReference: string,
): Promise<void> {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1

  // Try current month first, fall back to earliest outstanding
  const existing = await db
    .select()
    .from(subscriptionMonths)
    .where(
      and(
        eq(subscriptionMonths.enrollmentId, enrollmentId),
        eq(subscriptionMonths.status, "outstanding"),
      )
    )
    .orderBy(asc(subscriptionMonths.year), asc(subscriptionMonths.month))
    .limit(12)

  // Prefer the current calendar month if it is outstanding
  const currentMonthRow = existing.find((r) => r.year === year && r.month === month)
  const targetRow = currentMonthRow ?? existing[0]

  if (!targetRow) {
    // No outstanding month found ��� insert one for current month and mark paid
    await db
      .insert(subscriptionMonths)
      .values({
        enrollmentId,
        year,
        month,
        amountCents,
        status: "paid",
        paymentReference,
        paidAt: now,
      })
      .onConflictDoNothing()
    return
  }

  await db
    .update(subscriptionMonths)
    .set({
      status: "paid",
      paidAt: now,
      paymentReference,
      amountCents,
      updatedAt: now,
    })
    .where(eq(subscriptionMonths.id, targetRow.id))
}

// MONTH_NAMES, BILLING_START_YEAR/MONTH/END_MONTH, getMonthLabel, formatMonth
// are all exported from lib/billing-utils.ts — import from there in UI code.
