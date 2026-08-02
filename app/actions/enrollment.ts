"use server"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { enrollments, user, coachClubs, coaches } from "@/lib/db/schema"
import { and, asc, desc, eq, inArray } from "drizzle-orm"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { put } from "@vercel/blob"
import { generateContractPdf } from "@/lib/contract-pdf"
import { sendWelcomeEmail, sendAdminNotificationEmail } from "@/lib/email"
import { formatSlot } from "@/lib/slots"
import { buildNetcashPayment } from "@/lib/netcash"
import { orders } from "@/lib/db/schema"
import { recordReferralOnEnrollment } from "@/app/actions/referrals"
import { redeemVoucher } from "@/app/actions/referrals"

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user.id
}

function generateReference() {
  const year = new Date().getFullYear()
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase()
  return `NGP-${year}-${rand}`
}

export type EnrollmentInput = {
  parentName: string
  parentEmail: string
  parentMobile: string
  childName: string
  childDob: string
  childAge: number
  packageName: string
  packagePrice: number
  club: string
  clubId: number | null
  slotWeekday: number | null
  slotHour: number | null
  slotAgeGroup: string | null
  // Debit order — only required for monthly packages
  debitAccountHolder?: string
  debitBankName?: string
  debitAccountNumber?: string
  debitAccountType?: string
  debitDay?: number | null
  emergencyContactName: string
  emergencyContactPhone: string
  agreedTerms: boolean
  consentMedia: boolean
  signatureData: string | null
  signedName: string
  prefEmail: boolean
  prefWhatsapp: boolean
  prefSessionReminders: boolean
  prefAnnouncements: boolean
  prefEvents: boolean
  prefHolidayClinics: boolean
  // Payment
  paymentType?: "monthly" | "once-off"
  // School program (mutually exclusive with club for school packages)
  schoolId?: number | null
  schoolName?: string | null
  // Coach selection
  coachId?: number | null
  coachName?: string | null
  // Referral & voucher
  referralCode?: string | null
  voucherId?: number | null
  discountPercent?: number
}

/**
 * Look up the first coach assigned to a club (by coachId ascending).
 * Used to auto-assign a coach when one is not explicitly selected during enrollment.
 */
async function lookupClubCoach(clubId: number | null | undefined): Promise<{ coachId: number; coachName: string } | null> {
  if (!clubId) return null
  try {
    const rows = await db
      .select({ coachId: coachClubs.coachId, coachName: coaches.name })
      .from(coachClubs)
      .innerJoin(coaches, eq(coaches.id, coachClubs.coachId))
      .where(eq(coachClubs.clubId, clubId))
      .orderBy(asc(coachClubs.coachId))
      .limit(1)
    return rows[0] ?? null
  } catch {
    return null
  }
}

export async function createEnrollment(input: EnrollmentInput) {
  const userId = await getUserId()
  const referenceNumber = generateReference()
  const signedAt = new Date()

  const isOnceOff = input.paymentType === "once-off"

  // Auto-assign a coach from the club's assigned coaches if one wasn't selected
  let resolvedCoachId = input.coachId ?? null
  let resolvedCoachName = input.coachName ?? null
  if (!resolvedCoachId && input.clubId) {
    const autoCoach = await lookupClubCoach(input.clubId)
    if (autoCoach) {
      resolvedCoachId = autoCoach.coachId
      resolvedCoachName = autoCoach.coachName
    }
  }

  const inserted = await db
    .insert(enrollments)
    .values({
      userId,
      referenceNumber,
      parentName: input.parentName,
      parentEmail: input.parentEmail,
      parentMobile: input.parentMobile,
      childName: input.childName,
      childDob: input.childDob,
      childAge: input.childAge,
      packageName: input.packageName,
      club: input.club,
      clubId: input.clubId ?? undefined,
      schoolId: input.schoolId ?? undefined,
      schoolName: input.schoolName ?? undefined,
      slotWeekday: input.slotWeekday ?? undefined,
      slotHour: input.slotHour != null ? String(input.slotHour) : undefined,
      slotAgeGroup: input.slotAgeGroup ?? undefined,
      // Debit order fields intentionally omitted — Netcash handles payment collection
      emergencyContactName: input.emergencyContactName,
      emergencyContactPhone: input.emergencyContactPhone,
      agreedTerms: input.agreedTerms,
      consentMedia: input.consentMedia,
      signatureData: input.signatureData ?? undefined,
      signedName: input.signedName,
      signedAt,
      prefEmail: input.prefEmail,
      prefWhatsapp: input.prefWhatsapp,
      prefSessionReminders: input.prefSessionReminders,
      prefAnnouncements: input.prefAnnouncements,
      prefEvents: input.prefEvents,
      prefHolidayClinics: input.prefHolidayClinics,
      // Payment — all enrollments start as pending; the Netcash ITN webhook
      // sets paymentStatus to 'paid' and status to 'active' after verification.
      paymentType: isOnceOff ? "once-off" : "monthly",
      paymentStatus: "pending",
      status: "pending",
      accountStatus: "active",
      onboardingComplete: false,
      // Coach — either explicitly selected or auto-resolved from club assignments
      coachId: resolvedCoachId ?? undefined,
      coachName: resolvedCoachName ?? undefined,
    })
    .returning({ id: enrollments.id })

  const enrollmentId = inserted[0]?.id

  // Record referral (best-effort — never block enrollment).
  // The referral status stays "pending" until first payment is confirmed via ITN.
  if (enrollmentId != null && input.referralCode) {
    try { await recordReferralOnEnrollment(input.referralCode, enrollmentId) } catch {}
  }

  // Store the voucherId on the enrollment so the ITN webhook can redeem it after
  // payment is confirmed. We do NOT call redeemVoucher() here — the discount must
  // only activate once the friend's enrollment payment succeeds.
  if (enrollmentId != null && input.voucherId) {
    try {
      await db
        .update(enrollments)
        .set({ pendingVoucherId: input.voucherId })
        .where(eq(enrollments.id, enrollmentId))
    } catch {}
  }

  const slotLabel =
    input.slotWeekday != null && input.slotHour != null ? formatSlot(input.slotWeekday, input.slotHour) : "To be confirmed"

  // Generate the signed contract PDF and store it in Blob.
  let contractPdf: Uint8Array | null = null
  let contractUrl: string | null = null
  try {
    contractPdf = await generateContractPdf({
      referenceNumber,
      packageName: input.packageName,
      packagePrice: input.packagePrice,
      clubName: input.club,
      slotLabel,
      childName: input.childName,
      childAge: input.childAge,
      parentName: input.parentName,
      parentEmail: input.parentEmail,
      parentMobile: input.parentMobile,
      emergencyName: input.emergencyContactName,
      emergencyPhone: input.emergencyContactPhone,
      agreedTerms: input.agreedTerms,
      consentMedia: input.consentMedia,
      signedName: input.signedName,
      signedAt,
      signatureDataUrl: input.signatureData,
    })

    const blob = await put(`contracts/${referenceNumber}.pdf`, Buffer.from(contractPdf), {
      access: "private",
      contentType: "application/pdf",
      addRandomSuffix: true,
    })
    // Store the blob pathname (not a public URL). The contract is served to
    // admins through an authenticated route, since it contains banking details.
    contractUrl = blob.pathname

    if (enrollmentId != null) {
      await db.update(enrollments).set({ contractUrl }).where(eq(enrollments.id, enrollmentId))
    }
  } catch (err) {
    console.log("[v0] Contract PDF generation/upload failed:", err)
  }

  // Send the welcome email with the contract attached (best-effort).
  try {
    await sendWelcomeEmail({
      to: input.parentEmail,
      parentName: input.parentName,
      childName: input.childName,
      packageName: input.packageName,
      packagePrice: input.packagePrice,
      clubName: input.club,
      slotLabel,
      referenceNumber,
      contractPdf,
    })
  } catch (err) {
    console.log("[v0] Welcome email failed:", err)
  }

  // Notify the academy that a new sign-up has arrived (best-effort).
  try {
    await sendAdminNotificationEmail({
      parentName: input.parentName,
      parentEmail: input.parentEmail,
      parentMobile: input.parentMobile,
      childName: input.childName,
      childAge: input.childAge,
      packageName: input.packageName,
      packagePrice: input.packagePrice,
      clubName: input.club,
      slotLabel,
      referenceNumber,
    })
  } catch (err) {
    console.log("[v0] Admin notification email failed:", err)
  }

  revalidatePath("/dashboard")
  return { referenceNumber, enrollmentId: enrollmentId ?? null }
}

/** Parent changes the booked slot for one of their own enrollments. */
export async function updateEnrollmentSlot(input: {
  enrollmentId: number
  slotWeekday: number
  slotHour: number
}) {
  const userId = await getUserId()

  // Fetch the enrollment (scoped to the signed-in user)
  const rows = await db
    .select()
    .from(enrollments)
    .where(and(eq(enrollments.id, input.enrollmentId), eq(enrollments.userId, userId)))
    .limit(1)
  const current = rows[0]
  if (!current) throw new Error("Enrollment not found")
  if (current.clubId == null) throw new Error("This enrollment has no club assigned")

  await db
    .update(enrollments)
    .set({ slotWeekday: input.slotWeekday, slotHour: String(input.slotHour), updatedAt: new Date() })
    .where(and(eq(enrollments.id, input.enrollmentId), eq(enrollments.userId, userId)))

  revalidatePath("/dashboard")
  return { success: true }
}

export async function getMyEnrollments() {
  const userId = await getUserId()
  return db
    .select()
    .from(enrollments)
    .where(eq(enrollments.userId, userId))
    .orderBy(desc(enrollments.createdAt))
}

export async function getMyEnrollment(id: number) {
  const userId = await getUserId()
  const rows = await db
    .select()
    .from(enrollments)
    .where(and(eq(enrollments.id, id), eq(enrollments.userId, userId)))
    .limit(1)
  return rows[0] ?? null
}

export async function updateProfile(input: { name: string; mobile: string }) {
  const userId = await getUserId()
  const name = input.name.trim()
  const mobile = input.mobile.trim()
  if (!name) throw new Error("Name is required.")
  // Update the user display name
  await db.update(user).set({ name, updatedAt: new Date() }).where(eq(user.id, userId))
  // Also update parentName and parentMobile on all the user's enrollments
  await db
    .update(enrollments)
    .set({ parentName: name, parentMobile: mobile })
    .where(eq(enrollments.userId, userId))
  revalidatePath("/dashboard")
  return { success: true }
}

/**
 * Build a Netcash Pay Now payment request for an enrollment.
 * Works for both once-off and monthly subscriptions.
 * Called after the enrollment record has been persisted.
 */
export async function buildNetcashPaymentForEnrollment(input: {
  referenceNumber: string
  enrollmentId: number
  parentName: string
  parentEmail: string
  packageName: string
  packagePrice: number
  paymentType: "once-off" | "monthly"
}) {
  // Resolve the userId from the enrollment record
  const enrollmentRows = await db
    .select({ userId: enrollments.userId })
    .from(enrollments)
    .where(eq(enrollments.id, input.enrollmentId))
    .limit(1)
  const userId = enrollmentRows[0]?.userId ?? ""

  // Upsert: reuse an existing pending/awaiting_payment order for this enrollment
  // to prevent duplicate order rows when the parent clicks "Pay" more than once.
  const existingOrderRows = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.enrollmentId, input.enrollmentId),
        inArray(orders.status, ["pending", "awaiting_payment"]),
      ),
    )
    .limit(1)

  let orderId: number | undefined = existingOrderRows[0]?.id

  if (orderId) {
    // Reset the existing order so it is ready for a fresh payment attempt
    await db
      .update(orders)
      .set({
        status: "awaiting_payment",
        netcashOrderId: input.referenceNumber,
        failureReason: null,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId))
  } else {
    const [orderRow] = await db
      .insert(orders)
      .values({
        enrollmentId: input.enrollmentId,
        userId,
        packageType: input.paymentType,
        amount: Math.round(input.packagePrice * 100), // store in cents
        status: "awaiting_payment",
        netcashOrderId: input.referenceNumber,
      })
      .returning({ id: orders.id })
    orderId = orderRow?.id
  }

  const { netcashUrl, formFields } = await buildNetcashPayment({
    referenceNumber: input.referenceNumber,
    enrollmentId: input.enrollmentId,
    parentName: input.parentName,
    parentEmail: input.parentEmail,
    packageName: input.packageName,
    packagePrice: input.packagePrice,
    paymentType: input.paymentType,
  })

  return { netcashUrl, formFields, orderId }
}
