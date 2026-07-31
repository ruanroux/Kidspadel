"use server"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import {
  referralProfiles,
  referrals,
  vouchers,
  voucherCampaigns,
  enrollments,
  user,
} from "@/lib/db/schema"
import { and, eq, desc, count, sql, gt } from "drizzle-orm"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { nanoid } from "nanoid"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getSessionUser() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user
}

function generateVoucherCode(): string {
  return `NGP-${nanoid(8).toUpperCase()}`
}

function generateReferralCode(): string {
  return nanoid(6).toUpperCase()
}

// ---------------------------------------------------------------------------
// Referral profile — auto-create on first load
// ---------------------------------------------------------------------------

export async function getOrCreateReferralProfile() {
  const u = await getSessionUser()

  const existing = await db
    .select()
    .from(referralProfiles)
    .where(eq(referralProfiles.userId, u.id))
    .limit(1)

  if (existing.length > 0) return existing[0]

  const code = generateReferralCode()
  const [profile] = await db
    .insert(referralProfiles)
    .values({ userId: u.id, code })
    .returning()

  return profile
}

// ---------------------------------------------------------------------------
// Dashboard referral summary
// ---------------------------------------------------------------------------

export type ReferralSummary = {
  profile: { id: number; userId: string; code: string; createdAt: Date }
  referralUrl: string
  pending: number
  successful: number
  vouchers: Array<{
    id: number
    code: string
    discountPercent: number
    status: string
    expiresAt: Date | null
    campaignName: string
  }>
}

export async function getReferralSummary(): Promise<ReferralSummary> {
  const u = await getSessionUser()
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://localhost:3000")

  const profile = await getOrCreateReferralProfile()

  const [pendingResult, successfulResult] = await Promise.all([
    db
      .select({ n: count() })
      .from(referrals)
      .where(and(eq(referrals.referrerId, u.id), eq(referrals.status, "pending"))),
    db
      .select({ n: count() })
      .from(referrals)
      .where(and(eq(referrals.referrerId, u.id), eq(referrals.status, "complete"))),
  ])

  const myVouchers = await db
    .select({
      id: vouchers.id,
      code: vouchers.code,
      discountPercent: vouchers.discountPercent,
      status: vouchers.status,
      expiresAt: vouchers.expiresAt,
      campaignName: voucherCampaigns.name,
    })
    .from(vouchers)
    .innerJoin(voucherCampaigns, eq(vouchers.campaignId, voucherCampaigns.id))
    .where(eq(vouchers.userId, u.id))
    .orderBy(desc(vouchers.createdAt))

  return {
    profile,
    referralUrl: `${baseUrl}/enrollment?ref=${profile.code}`,
    pending: pendingResult[0]?.n ?? 0,
    successful: successfulResult[0]?.n ?? 0,
    vouchers: myVouchers,
  }
}

// ---------------------------------------------------------------------------
// Record a referral when someone registers with a ref code
// ---------------------------------------------------------------------------

export async function recordReferralOnEnrollment(
  referralCode: string,
  enrollmentId: number,
): Promise<void> {
  // Find the referrer
  const [refProfile] = await db
    .select()
    .from(referralProfiles)
    .where(eq(referralProfiles.code, referralCode))
    .limit(1)

  if (!refProfile) return // Invalid code — silently skip

  // Get enrollment to prevent self-referral
  const [enr] = await db
    .select({ userId: enrollments.userId })
    .from(enrollments)
    .where(eq(enrollments.id, enrollmentId))
    .limit(1)

  if (enr?.userId === refProfile.userId) return // Self-referral — skip

  await db.insert(referrals).values({
    referrerId: refProfile.userId,
    referralCode,
    enrollmentId,
    status: "pending",
  })
}

// ---------------------------------------------------------------------------
// Complete a referral after first payment and issue voucher to referrer
// ---------------------------------------------------------------------------

export async function completeReferralForEnrollment(enrollmentId: number): Promise<void> {
  const [referral] = await db
    .select()
    .from(referrals)
    .where(and(eq(referrals.enrollmentId, enrollmentId), eq(referrals.status, "pending")))
    .limit(1)

  if (!referral) return

  // Mark referral complete
  await db
    .update(referrals)
    .set({ status: "complete", completedAt: new Date(), updatedAt: new Date() })
    .where(eq(referrals.id, referral.id))

  // Get referral campaign config
  const [campaign] = await db
    .select()
    .from(voucherCampaigns)
    .where(and(eq(voucherCampaigns.type, "referral"), eq(voucherCampaigns.enabled, true)))
    .limit(1)

  if (!campaign) return

  // One referral voucher per user per campaign — skip if they already have an active one
  const [existingVoucher] = await db
    .select({ id: vouchers.id })
    .from(vouchers)
    .where(
      and(
        eq(vouchers.userId, referral.referrerId),
        eq(vouchers.campaignId, campaign.id),
        eq(vouchers.status, "active"),
      ),
    )
    .limit(1)

  if (existingVoucher) return

  const expiresAt = campaign.expiryDays
    ? new Date(Date.now() + campaign.expiryDays * 86_400_000)
    : null

  const [newVoucher] = await db
    .insert(vouchers)
    .values({
      code: generateVoucherCode(),
      campaignId: campaign.id,
      userId: referral.referrerId,
      discountPercent: campaign.discountPercent,
      status: "active",
      referralId: referral.id,
      expiresAt,
    })
    .returning()

  // Link voucher back to referral
  await db
    .update(referrals)
    .set({ voucherId: newVoucher.id })
    .where(eq(referrals.id, referral.id))

  // Stamp the pending discount onto the referrer's active monthly enrollment so it
  // applies to their next debit order. If they have multiple active enrollments we
  // apply it to the most recent one.
  const [referrerEnrollment] = await db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.userId, referral.referrerId),
        eq(enrollments.status, "active"),
        eq(enrollments.paymentType, "monthly"),
      ),
    )
    .orderBy(desc(enrollments.createdAt))
    .limit(1)

  if (referrerEnrollment) {
    await db
      .update(enrollments)
      .set({ pendingDiscountPercent: campaign.discountPercent })
      .where(
        and(
          eq(enrollments.id, referrerEnrollment.id),
          // Don't overwrite a larger existing discount
          eq(enrollments.pendingDiscountPercent, 0),
        ),
      )
  }

  revalidatePath("/dashboard")
  revalidatePath("/admin")
}

// ---------------------------------------------------------------------------
// Apply a voucher code during enrollment
// ---------------------------------------------------------------------------

export type VoucherValidationResult =
  | { valid: true; voucher: { id: number; code: string; discountPercent: number; campaignName: string } }
  | { valid: false; error: string }

export async function validateVoucherCode(
  code: string,
  packagePeriod: "monthly" | "once-off",
): Promise<VoucherValidationResult> {
  const u = await getSessionUser()

  const [row] = await db
    .select({
      id: vouchers.id,
      code: vouchers.code,
      discountPercent: vouchers.discountPercent,
      status: vouchers.status,
      expiresAt: vouchers.expiresAt,
      userId: vouchers.userId,
      appliesTo: voucherCampaigns.appliesTo,
      campaignName: voucherCampaigns.name,
      campaignEnabled: voucherCampaigns.enabled,
    })
    .from(vouchers)
    .innerJoin(voucherCampaigns, eq(vouchers.campaignId, voucherCampaigns.id))
    .where(eq(vouchers.code, code.toUpperCase()))
    .limit(1)

  if (!row) return { valid: false, error: "Voucher code not found." }
  if (row.userId !== u.id) return { valid: false, error: "This voucher does not belong to your account." }
  if (row.status !== "active") return { valid: false, error: "This voucher has already been used or expired." }
  if (!row.campaignEnabled) return { valid: false, error: "This voucher campaign is no longer active." }
  if (row.expiresAt && row.expiresAt < new Date()) return { valid: false, error: "This voucher has expired." }
  if (row.appliesTo === "monthly" && packagePeriod !== "monthly")
    return { valid: false, error: "This voucher can only be applied to monthly subscription packages." }
  if (row.appliesTo === "once-off" && packagePeriod !== "once-off")
    return { valid: false, error: "This voucher can only be applied to once-off packages." }

  return {
    valid: true,
    voucher: {
      id: row.id,
      code: row.code,
      discountPercent: row.discountPercent,
      campaignName: row.campaignName,
    },
  }
}

export async function redeemVoucher(voucherId: number, enrollmentId: number): Promise<void> {
  await db
    .update(vouchers)
    .set({ status: "used", usedAt: new Date(), redeemedOnEnrollmentId: enrollmentId })
    .where(eq(vouchers.id, voucherId))

  revalidatePath("/dashboard")
}

// ---------------------------------------------------------------------------
// Issue a Boot Camp voucher (admin action) — accepts email OR user ID
// ---------------------------------------------------------------------------

export async function issueBootcampVoucher(
  targetUserIdOrEmail: string,
): Promise<{ code: string } | { error: string }> {
  const [campaign] = await db
    .select()
    .from(voucherCampaigns)
    .where(and(eq(voucherCampaigns.type, "bootcamp"), eq(voucherCampaigns.enabled, true)))
    .limit(1)

  if (!campaign) return { error: "Boot Camp Reward campaign is not currently active." }

  // Accept either the user's UUID or their email address — look up by email if
  // the value contains "@", otherwise treat it as a raw user ID.
  let resolvedUserId = targetUserIdOrEmail.trim()
  if (resolvedUserId.includes("@")) {
    const [found] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, resolvedUserId))
      .limit(1)
    if (!found) return { error: `No account found for email: ${resolvedUserId}` }
    resolvedUserId = found.id
  }

  // CRITICAL: Never allow an email address to be inserted as userId.
  // This is a foreign key to user.id (UUID), not an email field.
  if (!resolvedUserId || resolvedUserId.includes("@")) {
    return { error: "Invalid user ID — must be a UUID, not an email address." }
  }

  // One bootcamp voucher per user per campaign — prevent duplicates
  const [existingVoucher] = await db
    .select({ id: vouchers.id, code: vouchers.code, status: vouchers.status })
    .from(vouchers)
    .where(
      and(
        eq(vouchers.userId, resolvedUserId),
        eq(vouchers.campaignId, campaign.id),
      ),
    )
    .limit(1)

  if (existingVoucher) {
    return {
      error: `This parent already has a Boot Camp voucher (${existingVoucher.code} — ${existingVoucher.status}). Each client may only receive one.`,
    }
  }

  const expiresAt = campaign.expiryDays
    ? new Date(Date.now() + campaign.expiryDays * 86_400_000)
    : null

  const [newVoucher] = await db
    .insert(vouchers)
    .values({
      code: generateVoucherCode(),
      campaignId: campaign.id,
      userId: resolvedUserId,
      discountPercent: campaign.discountPercent,
      status: "active",
      expiresAt,
    })
    .returning()

  revalidatePath("/dashboard")
  return { code: newVoucher.code }
}

// ---------------------------------------------------------------------------
// Admin: list all referrals
// ---------------------------------------------------------------------------

export type AdminReferralRow = {
  id: number
  referrerName: string
  referrerEmail: string
  status: string
  createdAt: Date
  completedAt: Date | null
  enrollmentRef: string | null
}

export async function adminGetAllReferrals(): Promise<AdminReferralRow[]> {
  const rows = await db
    .select({
      id: referrals.id,
      referrerName: user.name,
      referrerEmail: user.email,
      status: referrals.status,
      createdAt: referrals.createdAt,
      completedAt: referrals.completedAt,
      enrollmentRef: enrollments.referenceNumber,
    })
    .from(referrals)
    .innerJoin(user, eq(referrals.referrerId, user.id))
    .leftJoin(enrollments, eq(referrals.enrollmentId, enrollments.id))
    .orderBy(desc(referrals.createdAt))

  return rows
}

// ---------------------------------------------------------------------------
// Admin: list all vouchers
// ---------------------------------------------------------------------------

export type AdminVoucherRow = {
  id: number
  code: string
  discountPercent: number
  status: string
  campaignName: string
  userName: string
  userEmail: string
  expiresAt: Date | null
  usedAt: Date | null
  createdAt: Date
}

export async function adminGetAllVouchers(): Promise<AdminVoucherRow[]> {
  const rows = await db
    .select({
      id: vouchers.id,
      code: vouchers.code,
      discountPercent: vouchers.discountPercent,
      status: vouchers.status,
      campaignName: voucherCampaigns.name,
      userName: user.name,
      userEmail: user.email,
      expiresAt: vouchers.expiresAt,
      usedAt: vouchers.usedAt,
      createdAt: vouchers.createdAt,
    })
    .from(vouchers)
    .innerJoin(voucherCampaigns, eq(vouchers.campaignId, voucherCampaigns.id))
    .innerJoin(user, eq(vouchers.userId, user.id))
    .orderBy(desc(vouchers.createdAt))

  return rows
}

// ---------------------------------------------------------------------------
// Admin: get/update voucher campaigns
// ---------------------------------------------------------------------------

export async function adminGetCampaigns() {
  return db.select().from(voucherCampaigns).orderBy(voucherCampaigns.id)
}

export async function adminUpdateCampaign(
  id: number,
  data: {
    name?: string
    description?: string
    discountPercent?: number
    appliesTo?: string
    expiryDays?: number | null
    enabled?: boolean
  },
) {
  await db
    .update(voucherCampaigns)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(voucherCampaigns.id, id))

  revalidatePath("/admin")
}

// ---------------------------------------------------------------------------
// Admin: mark a referral discount as applied to the next debit order
// ---------------------------------------------------------------------------

export async function markReferralDiscountApplied(enrollmentId: number): Promise<void> {
  await db
    .update(enrollments)
    .set({
      pendingDiscountPercent: 0,
      discountAppliedAt: new Date(),
    })
    .where(eq(enrollments.id, enrollmentId))

  revalidatePath("/admin")
  revalidatePath("/dashboard")
}

export async function adminCreateCampaign(data: {
  name: string
  description: string
  discountPercent: number
  appliesTo: string
  expiryDays: number | null
  enabled: boolean
}) {
  await db.insert(voucherCampaigns).values({ ...data, type: "custom" })
  revalidatePath("/admin")
}
