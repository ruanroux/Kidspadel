"use server"

import { db } from "@/lib/db"
import { sessionAttendance, enrollments, coaches, coachClubs, clubs } from "@/lib/db/schema"
import { eq, and, gte, lte, inArray, asc } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { requireAdmin } from "@/lib/admin-auth"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CoachOption = {
  id: number
  name: string
  clubIds: number[]
}

export type CoachingEnrollment = {
  enrollmentId: number
  childName: string
  parentName: string
  club: string
  clubId: number | null
  packageName: string
  status: string
  // Slot 1
  slotWeekday: number | null
  slotHour: number | null
  // Slot 2 (advanced package)
  slotWeekday2: number | null
  slotHour2: number | null
}

export type AttendanceRecord = {
  id: number
  enrollmentId: number
  sessionDate: string // ISO date string YYYY-MM-DD
  status: "present" | "absent" | "excused"
  note: string | null
}

export type CoachingPortalData = {
  coaches: CoachOption[]
  enrollments: CoachingEnrollment[]
  attendance: AttendanceRecord[]
  clubNames: Record<number, string>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDateStr(d: Date | string | null | undefined): string {
  if (!d) return ""
  // Drizzle may return a string (ISO) or a Date object for timestamp columns
  const dt = typeof d === "string" ? new Date(d) : d
  if (isNaN(dt.getTime())) return String(d).split("T")[0] ?? ""
  return dt.toISOString().split("T")[0]
}

function weekBounds(weekOffset: number): { start: Date; end: Date } {
  const now = new Date()
  // Monday of current week
  const day = now.getDay() // 0=Sun
  const diffToMon = (day === 0 ? -6 : 1 - day)
  const mon = new Date(now)
  mon.setDate(now.getDate() + diffToMon + weekOffset * 7)
  mon.setHours(0, 0, 0, 0)
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  sun.setHours(23, 59, 59, 999)
  return { start: mon, end: sun }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Load all coaches (admin use). */
export async function getCoachOptions(): Promise<CoachOption[]> {
  await requireAdmin()
  const rows = await db
    .select({ id: coaches.id, name: coaches.name })
    .from(coaches)
    .orderBy(asc(coaches.sortOrder), asc(coaches.id))
  if (rows.length === 0) return []
  const ccRows = await db.select().from(coachClubs)
  const clubMap = new Map<number, number[]>()
  for (const cc of ccRows) {
    if (!clubMap.has(cc.coachId)) clubMap.set(cc.coachId, [])
    clubMap.get(cc.coachId)!.push(cc.clubId)
  }
  return rows.map((r) => ({ id: r.id, name: r.name, clubIds: clubMap.get(r.id) ?? [] }))
}

/**
 * Fetch enrollments for a coach.
 * Includes only active/pending enrollments with a slotWeekday assigned.
 */
export async function getCoachEnrollments(coachId: number): Promise<CoachingEnrollment[]> {
  await requireAdmin()
  const rows = await db
    .select({
      id: enrollments.id,
      childName: enrollments.childName,
      parentName: enrollments.parentName,
      club: enrollments.club,
      clubId: enrollments.clubId,
      packageName: enrollments.packageName,
      status: enrollments.status,
      slotWeekday: enrollments.slotWeekday,
      slotHour: enrollments.slotHour,
      slotWeekday2: enrollments.slotWeekday2,
      slotHour2: enrollments.slotHour2,
    })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.coachId, coachId),
        inArray(enrollments.status, ["active", "pending"])
      )
    )
    .orderBy(asc(enrollments.clubId), asc(enrollments.slotWeekday), asc(enrollments.slotHour))

  return rows.map((r) => ({
    enrollmentId: r.id,
    childName: r.childName,
    parentName: r.parentName ?? "",
    club: r.club ?? "",
    clubId: r.clubId ?? null,
    packageName: r.packageName,
    status: r.status,
    slotWeekday: r.slotWeekday ?? null,
    slotHour: r.slotHour != null ? Number(r.slotHour) : null,
    slotWeekday2: r.slotWeekday2 ?? null,
    slotHour2: r.slotHour2 != null ? Number(r.slotHour2) : null,
  }))
}

/** Fetch attendance records for a coach within a date range (full week). */
export async function getCoachAttendance(
  coachId: number,
  weekOffset: number
): Promise<AttendanceRecord[]> {
  await requireAdmin()
  const { start, end } = weekBounds(weekOffset)
  const rows = await db
    .select()
    .from(sessionAttendance)
    .where(
      and(
        eq(sessionAttendance.coachId, coachId),
        gte(sessionAttendance.sessionDate, start),
        lte(sessionAttendance.sessionDate, end)
      )
    )
  return rows.map((r) => ({
    id: r.id,
    enrollmentId: r.enrollmentId,
    sessionDate: toDateStr(r.sessionDate),
    status: r.status as "present" | "absent" | "excused",
    note: r.note ?? null,
  }))
}

/** Get attendance for a wider range (last 90 days) for the correction view. */
export async function getCoachAttendanceHistory(
  coachId: number
): Promise<AttendanceRecord[]> {
  await requireAdmin()
  const ninetyDaysAgo = new Date()
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
  const rows = await db
    .select()
    .from(sessionAttendance)
    .where(
      and(
        eq(sessionAttendance.coachId, coachId),
        gte(sessionAttendance.sessionDate, ninetyDaysAgo)
      )
    )
    .orderBy(asc(sessionAttendance.sessionDate))
  return rows.map((r) => ({
    id: r.id,
    enrollmentId: r.enrollmentId,
    sessionDate: toDateStr(r.sessionDate),
    status: r.status as "present" | "absent" | "excused",
    note: r.note ?? null,
  }))
}

/** Upsert an attendance record (mark or update a session). */
export async function markAttendance(input: {
  coachId: number
  enrollmentId: number
  sessionDate: string // YYYY-MM-DD
  status: "present" | "absent" | "excused"
  note?: string
}): Promise<{ ok: boolean; id?: number; error?: string }> {
  await requireAdmin()
  try {
    const dateObj = new Date(input.sessionDate + "T00:00:00.000Z")
    // Check for existing record
    const existing = await db
      .select({ id: sessionAttendance.id })
      .from(sessionAttendance)
      .where(
        and(
          eq(sessionAttendance.coachId, input.coachId),
          eq(sessionAttendance.enrollmentId, input.enrollmentId),
          eq(sessionAttendance.sessionDate, dateObj)
        )
      )
      .limit(1)

    if (existing.length > 0) {
      await db
        .update(sessionAttendance)
        .set({
          status: input.status,
          note: input.note ?? null,
          updatedAt: new Date(),
        })
        .where(eq(sessionAttendance.id, existing[0].id))
      revalidatePath("/admin")
      return { ok: true, id: existing[0].id }
    }

    const [row] = await db
      .insert(sessionAttendance)
      .values({
        coachId: input.coachId,
        enrollmentId: input.enrollmentId,
        sessionDate: dateObj,
        status: input.status,
        note: input.note ?? null,
      })
      .returning({ id: sessionAttendance.id })
    revalidatePath("/admin")
    return { ok: true, id: row.id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to save attendance" }
  }
}

/** Correct an attendance error — update an existing attendance record. */
export async function correctAttendance(input: {
  attendanceId: number
  status: "present" | "absent" | "excused"
  note?: string
}): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin()
  try {
    await db
      .update(sessionAttendance)
      .set({
        status: input.status,
        note: input.note ?? null,
        updatedAt: new Date(),
      })
      .where(eq(sessionAttendance.id, input.attendanceId))
    revalidatePath("/admin")
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to correct attendance" }
  }
}

/** Delete an attendance record (remove a mark entirely). */
export async function deleteAttendance(attendanceId: number): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin()
  try {
    await db.delete(sessionAttendance).where(eq(sessionAttendance.id, attendanceId))
    revalidatePath("/admin")
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to delete attendance" }
  }
}

/** Load all club names for display. */
export async function getClubNames(): Promise<Record<number, string>> {
  await requireAdmin()
  const rows = await db.select({ id: clubs.id, name: clubs.name }).from(clubs)
  return Object.fromEntries(rows.map((r) => [r.id, r.name]))
}
