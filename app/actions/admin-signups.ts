"use server"

import { asc, desc, eq, ilike, or } from "drizzle-orm"
import { db } from "@/lib/db"
import { enrollments, user, coachClubs, coaches } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { generateContractPdf } from "@/lib/contract-pdf"
import { sendWelcomeEmail } from "@/lib/email"
import { formatSlot } from "@/lib/slots"
import { put } from "@vercel/blob"
import { revalidatePath } from "next/cache"
import { nanoid } from "nanoid"

export type AdminSignup = {
  id: number
  referenceNumber: string
  parentName: string
  parentEmail: string
  parentMobile: string
  childName: string
  childDob: string | null
  childAge: number | null
  packageName: string
  club: string | null
  clubId: number | null
  coachId: number | null
  coachName: string | null
  slotWeekday: number | null
  // numeric column returns string from Drizzle; parse with parseFloat before display
  slotHour: string | null
  slotLabel: string | null
  slotWeekday2: number | null
  slotHour2: string | null
  slotLabel2: string | null
  scheduleCustomized: boolean
  emergencyContactName: string | null
  emergencyContactPhone: string | null
  debitAccountHolder: string | null
  debitBankName: string | null
  debitAccountNumber: string | null
  debitAccountType: string | null
  debitDay: number | null
  agreedTerms: boolean
  consentMedia: boolean
  contractUrl: string | null
  status: string
  paymentType: string
  paymentStatus: string
  payfastPaymentId: string | null
  signedAt: string | null
  createdAt: string | null
  pendingDiscountPercent: number
}

export type UpdateSignupInput = {
  parentName: string
  parentEmail: string
  parentMobile: string
  childName: string
  childDob: string
  childAge: number
  packageName: string
  club: string
  clubId?: number | null
  coachName: string
  coachId?: number | null
  slotWeekday: number | null
  slotHour: number | null
  slotWeekday2: number | null
  slotHour2: number | null
  emergencyContactName: string
  emergencyContactPhone: string
  status: string
  paymentStatus?: string
}

export async function getAllSignups(): Promise<AdminSignup[]> {
  await requireAdmin()
  const rows = await db.select().from(enrollments).orderBy(desc(enrollments.createdAt))
  return rows.map((r) => ({
    id: r.id,
    referenceNumber: r.referenceNumber,
    parentName: r.parentName,
    parentEmail: r.parentEmail,
    parentMobile: r.parentMobile,
    childName: r.childName,
    childDob: r.childDob ?? null,
    childAge: r.childAge ?? null,
    packageName: r.packageName,
    club: r.club ?? null,
    clubId: r.clubId ?? null,
    coachId: r.coachId ?? null,
    coachName: r.coachName ?? null,
    slotWeekday: r.slotWeekday ?? null,
    slotHour: r.slotHour ?? null,
    slotLabel: r.slotWeekday != null && r.slotHour != null ? formatSlot(r.slotWeekday, parseFloat(String(r.slotHour))) : null,
    slotWeekday2: r.slotWeekday2 ?? null,
    slotHour2: r.slotHour2 ?? null,
    slotLabel2: r.slotWeekday2 != null && r.slotHour2 != null ? formatSlot(r.slotWeekday2, parseFloat(String(r.slotHour2))) : null,
    scheduleCustomized: r.scheduleCustomized ?? false,
    emergencyContactName: r.emergencyContactName ?? null,
    emergencyContactPhone: r.emergencyContactPhone ?? null,
    debitAccountHolder: r.debitAccountHolder ?? null,
    debitBankName: r.debitBankName ?? null,
    debitAccountNumber: r.debitAccountNumber ?? null,
    debitAccountType: r.debitAccountType ?? null,
    debitDay: r.debitDay ?? null,
    agreedTerms: r.agreedTerms,
    consentMedia: r.consentMedia,
    contractUrl: r.contractUrl ?? null,
    status: r.status,
    paymentType: r.paymentType ?? "monthly",
    paymentStatus: r.paymentStatus ?? "pending",
    payfastPaymentId: r.payfastPaymentId ?? null,
    signedAt: r.signedAt ? r.signedAt.toISOString() : null,
    createdAt: r.createdAt ? r.createdAt.toISOString() : null,
    pendingDiscountPercent: r.pendingDiscountPercent ?? 0,
  }))
}

/** Admin updates contact / enrollment details for a sign-up. */
export async function updateSignup(
  id: number,
  input: UpdateSignupInput,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin()
    await db
      .update(enrollments)
      .set({
        parentName: input.parentName.trim(),
        parentEmail: input.parentEmail.trim(),
        parentMobile: input.parentMobile.trim(),
        childName: input.childName.trim(),
        childDob: input.childDob,
        childAge: input.childAge,
        packageName: input.packageName.trim(),
        club: input.club.trim(),
        clubId: input.clubId ?? undefined,
        coachName: input.coachName.trim() || null,
        ...(input.coachId !== undefined && { coachId: input.coachId }),
        slotWeekday: input.slotWeekday ?? undefined,
        slotHour: input.slotHour != null ? String(input.slotHour) : undefined,
        slotWeekday2: input.slotWeekday2 ?? null,
        slotHour2: input.slotHour2 != null ? String(input.slotHour2) : null,
        emergencyContactName: input.emergencyContactName.trim() || undefined,
        emergencyContactPhone: input.emergencyContactPhone.trim() || undefined,
        status: input.status,
        ...(input.paymentStatus !== undefined && { paymentStatus: input.paymentStatus }),
        updatedAt: new Date(),
      })
      .where(eq(enrollments.id, id))
    revalidatePath("/admin")
    return { ok: true }
  } catch (err) {
    console.log("[v0] updateSignup error:", err)
    return { ok: false, error: err instanceof Error ? err.message : "Update failed" }
  }
}

export type UpdateTimeSlotsInput = {
  slotWeekday: number
  slotHour: number
  slotWeekday2?: number | null
  slotHour2?: number | null
}

/**
 * Focused, schedule-only update for a single client's weekly time slot(s).
 * Advanced packages require two distinct slots; all other packages keep exactly one.
 * Only touches slot fields + scheduleCustomized — no other enrollment data is modified.
 */
export async function updateClientTimeSlots(
  id: number,
  input: UpdateTimeSlotsInput,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin()

    const rows = await db.select().from(enrollments).where(eq(enrollments.id, id)).limit(1)
    const row = rows[0]
    if (!row) return { ok: false, error: "Enrollment not found" }

    const isAdvanced = /advanced/i.test(row.packageName)

    if (input.slotWeekday == null || input.slotHour == null) {
      return { ok: false, error: "A weekly time slot is required" }
    }

    let slotWeekday2: number | null = null
    let slotHour2: number | null = null

    if (isAdvanced) {
      if (input.slotWeekday2 == null || input.slotHour2 == null) {
        return { ok: false, error: "Advanced packages require two weekly time slots" }
      }
      if (input.slotWeekday === input.slotWeekday2 && input.slotHour === input.slotHour2) {
        return { ok: false, error: "Time Slot 1 and Time Slot 2 cannot be the same" }
      }
      slotWeekday2 = input.slotWeekday2
      slotHour2 = input.slotHour2
    }

    await db
      .update(enrollments)
      .set({
        slotWeekday: input.slotWeekday,
        slotHour: String(input.slotHour),
        slotWeekday2,
        slotHour2: slotHour2 != null ? String(slotHour2) : null,
        scheduleCustomized: true,
        updatedAt: new Date(),
      })
      .where(eq(enrollments.id, id))

    revalidatePath("/admin")
    return { ok: true }
  } catch (err) {
    console.log("[v0] updateClientTimeSlots error:", err)
    return { ok: false, error: err instanceof Error ? err.message : "Update failed" }
  }
}

async function loadEnrollment(id: number) {
  const rows = await db.select().from(enrollments).where(eq(enrollments.id, id)).limit(1)
  const row = rows[0]
  if (!row) throw new Error("Signup not found")
  return row
}

function priceFor(packageName: string): number {
  if (/advanced/i.test(packageName)) return 900
  if (/beginner/i.test(packageName)) return 600
  return 0
}

/** Regenerate the contract PDF for a signup and store it in Blob; returns the blob pathname. */
export async function regenerateContract(id: number): Promise<{ pathname: string }> {
  await requireAdmin() // throws intentionally — not a { ok } return type
  const r = await loadEnrollment(id)
  const slotLabel =
    r.slotWeekday != null && r.slotHour != null ? formatSlot(r.slotWeekday, parseFloat(String(r.slotHour))) : "To be confirmed"

  const pdf = await generateContractPdf({
    referenceNumber: r.referenceNumber,
    packageName: r.packageName,
    packagePrice: priceFor(r.packageName),
    clubName: r.club ?? "",
    slotLabel,
    childName: r.childName,
    childAge: r.childAge ?? "",
    parentName: r.parentName,
    parentEmail: r.parentEmail,
    parentMobile: r.parentMobile,
    emergencyName: r.emergencyContactName,
    emergencyPhone: r.emergencyContactPhone,
    agreedTerms: r.agreedTerms,
    consentMedia: r.consentMedia,
    signedName: r.signedName,
    signedAt: r.signedAt,
    signatureDataUrl: r.signatureData,
  })

  const blob = await put(`contracts/${r.referenceNumber}.pdf`, Buffer.from(pdf), {
    access: "private",
    contentType: "application/pdf",
    addRandomSuffix: true,
  })
  // Persist the blob pathname; the file is served via an authenticated admin route.
  await db.update(enrollments).set({ contractUrl: blob.pathname }).where(eq(enrollments.id, id))
  return { pathname: blob.pathname }
}

/** Resend the welcome email (with the contract) for an existing signup. */
export async function resendWelcome(id: number): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin()
  } catch {
    return { ok: false, error: "Not authorized" }
  }
  const r = await loadEnrollment(id)
  const slotLabel =
    r.slotWeekday != null && r.slotHour != null ? formatSlot(r.slotWeekday, parseFloat(String(r.slotHour))) : "To be confirmed"

  let pdf: Uint8Array | null = null
  try {
    pdf = await generateContractPdf({
      referenceNumber: r.referenceNumber,
      packageName: r.packageName,
      packagePrice: priceFor(r.packageName),
      clubName: r.club ?? "",
      slotLabel,
      childName: r.childName,
      childAge: r.childAge ?? "",
      parentName: r.parentName,
      parentEmail: r.parentEmail,
      parentMobile: r.parentMobile,
      emergencyName: r.emergencyContactName,
      emergencyPhone: r.emergencyContactPhone,
      agreedTerms: r.agreedTerms,
      consentMedia: r.consentMedia,
      signedName: r.signedName,
      signedAt: r.signedAt,
      signatureDataUrl: r.signatureData,
    })
  } catch (err) {
    console.error("[email] resendWelcome PDF generation failed:", err)
  }

  return sendWelcomeEmail({
    to: r.parentEmail,
    parentName: r.parentName,
    childName: r.childName,
    packageName: r.packageName,
    packagePrice: priceFor(r.packageName),
    clubName: r.club ?? "",
    slotLabel,
    referenceNumber: r.referenceNumber,
    contractPdf: pdf,
  })
}

/**
 * Make an enrollment Inactive (status="inactive").
 * All data — parent info, student info, package, club, attendance, payment history — is preserved.
 * Only the status changes.
 */
export async function deactivateSignup(id: number): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin()
    await db.update(enrollments).set({ status: "inactive", updatedAt: new Date() }).where(eq(enrollments.id, id))
    revalidatePath("/admin")
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to deactivate" }
  }
}

/**
 * Reactivate an enrollment (status="active").
 * Restores the enrollment to the coaching portal and all active views.
 */
export async function reactivateSignup(id: number): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin()
    await db.update(enrollments).set({ status: "active", updatedAt: new Date() }).where(eq(enrollments.id, id))
    revalidatePath("/admin")
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to reactivate" }
  }
}

/** @deprecated Use deactivateSignup instead — production records must never be permanently deleted. */
export async function deleteSignup(id: number): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin()
    await db.delete(enrollments).where(eq(enrollments.id, id))
    revalidatePath("/admin")
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Delete failed" }
  }
}

/**
 * Permanently delete an inactive enrollment.
 * Only allowed when the enrollment status is "inactive" — this is enforced
 * server-side so the UI restriction cannot be bypassed.
 * The deletion cascades to any associated orders rows.
 */
export async function permanentlyDeleteSignup(id: number): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin()
    // Safety guard: only inactive enrollments may be permanently deleted
    const rows = await db
      .select({ id: enrollments.id, status: enrollments.status })
      .from(enrollments)
      .where(eq(enrollments.id, id))
      .limit(1)
    const row = rows[0]
    if (!row) return { ok: false, error: "Enrollment not found" }
    if (row.status !== "inactive") {
      return { ok: false, error: "Only inactive enrollments can be permanently deleted. Deactivate it first." }
    }
    await db.delete(enrollments).where(eq(enrollments.id, id))
    revalidatePath("/admin")
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Delete failed" }
  }
}

export type UserSearchResult = {
  id: string
  name: string
  email: string
}

/**
 * Search registered user accounts by name or email.
 * Used in the admin Add Sign-up modal to link a new enrollment to an
 * existing parent account so they see all their children on login.
 */
export async function searchUsers(query: string): Promise<UserSearchResult[]> {
  await requireAdmin()
  if (!query || query.trim().length < 2) return []
  const q = `%${query.trim()}%`
  const rows = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(or(ilike(user.name, q), ilike(user.email, q)))
    .limit(8)
  return rows
}

export type CreateSignupInput = {
  parentName: string
  parentEmail: string
  parentMobile: string
  childName: string
  childDob: string
  childAge: number
  packageName: string
  club: string
  clubId?: number | null
  coachName: string
  coachId?: number | null
  slotWeekday: number | null
  slotHour: number | null
  slotWeekday2: number | null
  slotHour2: number | null
  emergencyContactName: string
  emergencyContactPhone: string
  status: string
  /**
   * When set, the enrollment is linked to this user account so the parent
   * can see it on their dashboard. Leave undefined to create an unlinked record.
   */
  linkUserId?: string
}

/** Resolve the first coach assigned to a club (used by admin createSignup). */
async function resolveCoachForClub(clubId: number | null | undefined): Promise<{ coachId: number; coachName: string } | null> {
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

/** Manually create a sign-up from the admin dashboard. */
export async function createSignup(input: CreateSignupInput): Promise<{ ok: boolean; id?: number; referenceNumber?: string; error?: string }> {
  try {
    await requireAdmin()
    const referenceNumber = `NGP-${nanoid(8).toUpperCase()}`
    // Use the linked user's ID so the parent sees this on their dashboard,
    // or fall back to "admin" for unlinked / new-account enrollments.
    const userId = input.linkUserId ?? "admin"

    // Auto-assign coach from club if not explicitly provided
    let resolvedCoachId = input.coachId ?? null
    let resolvedCoachName = input.coachName.trim() || null
    if (!resolvedCoachId && input.clubId) {
      const autoCoach = await resolveCoachForClub(input.clubId)
      if (autoCoach) {
        resolvedCoachId = autoCoach.coachId
        if (!resolvedCoachName) resolvedCoachName = autoCoach.coachName
      }
    }

    const [row] = await db
      .insert(enrollments)
      .values({
        userId,
        referenceNumber,
        parentName: input.parentName.trim(),
        parentEmail: input.parentEmail.trim(),
        parentMobile: input.parentMobile.trim(),
        childName: input.childName.trim(),
        childDob: input.childDob,
        childAge: input.childAge,
        packageName: input.packageName.trim(),
        club: input.club.trim(),
        clubId: input.clubId ?? undefined,
        coachId: resolvedCoachId ?? undefined,
        coachName: resolvedCoachName,
        slotWeekday: input.slotWeekday ?? undefined,
        slotHour: input.slotHour != null ? String(input.slotHour) : undefined,
        slotWeekday2: input.slotWeekday2 ?? null,
        slotHour2: input.slotHour2 != null ? String(input.slotHour2) : null,
        emergencyContactName: input.emergencyContactName.trim() || undefined,
        emergencyContactPhone: input.emergencyContactPhone.trim() || undefined,
        status: input.status,
        agreedTerms: false,
        consentMedia: false,
      })
      .returning({ id: enrollments.id })
    revalidatePath("/admin")
    return { ok: true, id: row.id, referenceNumber }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Create failed" }
  }
}
