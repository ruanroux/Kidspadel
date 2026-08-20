"use server"

import { db } from "@/lib/db"
import { sessionAttendance, enrollments, coaches, coachClubs, clubs } from "@/lib/db/schema"
import { eq, and, gte, lte, inArray, asc } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { requireAdmin } from "@/lib/admin-auth"
// requireAdmin is used only in getCoachOptions (admin-only list).
// All other functions in this file are called from admin-coaching-portal.tsx,
// which is already rendered inside the admin page that guards with isAdminAuthenticated().

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CoachOption = {
  id: number
  name: string
  clubIds: number[]
  clubCount: number
  studentCount: number
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
  // Which coach is formally assigned to slot 1 (slotWeekday/slotHour)
  assignedCoachId?: number | null
  // Which coach is formally assigned to slot 2 (slotWeekday2/slotHour2).
  // Null means slot 2 has never been split off from slot 1 — it still
  // follows assignedCoachId until reassigned independently.
  assignedCoachId2?: number | null
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
  // Drizzle's date() type returns a plain "YYYY-MM-DD" string — pass it straight through.
  // If it's a Date object (legacy or timestamp column), convert via ISO.
  if (typeof d === "string") {
    // Could be "YYYY-MM-DD" or a full ISO string — keep only the date part
    return d.split("T")[0]
  }
  if (isNaN(d.getTime())) return ""
  return d.toISOString().split("T")[0]
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

/** Load all coaches with club and student counts (admin use). */
export async function getCoachOptions(): Promise<CoachOption[]> {
  await requireAdmin()
  const rows = await db
    .select({ id: coaches.id, name: coaches.name })
    .from(coaches)
    .orderBy(asc(coaches.sortOrder), asc(coaches.id))
  if (rows.length === 0) return []

  // Only count published clubs toward the coach's club count
  const publishedClubs = await db
    .select({ id: clubs.id })
    .from(clubs)
    .where(eq(clubs.published, true))
  const publishedClubIds = new Set(publishedClubs.map((c) => c.id))

  // Club assignments per coach (published clubs only)
  const ccRows = await db.select().from(coachClubs)
  const clubMap = new Map<number, number[]>()
  for (const cc of ccRows) {
    if (!publishedClubIds.has(cc.clubId)) continue
    if (!clubMap.has(cc.coachId)) clubMap.set(cc.coachId, [])
    clubMap.get(cc.coachId)!.push(cc.clubId)
  }

  // Student count per coach (active/pending enrollments)
  const studentRows = await db
    .select({ coachId: enrollments.coachId, id: enrollments.id })
    .from(enrollments)
    .where(inArray(enrollments.status, ["active", "pending"]))
  const studentMap = new Map<number, number>()
  for (const s of studentRows) {
    if (s.coachId == null) continue
    studentMap.set(s.coachId, (studentMap.get(s.coachId) ?? 0) + 1)
  }

  return rows.map((r) => {
    const ids = clubMap.get(r.id) ?? []
    return {
      id: r.id,
      name: r.name,
      clubIds: ids,
      clubCount: ids.length,
      studentCount: studentMap.get(r.id) ?? 0,
    }
  })
}

/**
 * Fetch enrollments visible to a coach.
 * A coach sees ALL active/pending enrollments at ANY club they are assigned to,
 * regardless of which coach is named on the enrollment. This supports shared clubs
 * where multiple coaches cover the same venue.
 */
export async function getCoachEnrollments(coachId: number): Promise<CoachingEnrollment[]> {
  // Resolve which club IDs this coach covers
  const ccRows = await db
    .select({ clubId: coachClubs.clubId })
    .from(coachClubs)
    .where(eq(coachClubs.coachId, coachId))
  const clubIds = ccRows.map((r) => r.clubId)
  if (clubIds.length === 0) return []

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
      coachId: enrollments.coachId,
      coachId2: enrollments.coachId2,
    })
    .from(enrollments)
    .where(
      and(
        inArray(enrollments.clubId, clubIds),
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
    assignedCoachId: r.coachId ?? null,
    // Slot 2 falls back to slot 1's coach until it's been split off independently.
    assignedCoachId2: r.coachId2 ?? r.coachId ?? null,
  }))
}

/**
 * Reassign a single enrollment's session to a different coach.
 * Used by the admin conflict-resolution panel.
 *
 * An advanced-package enrollment has two independent weekly sessions
 * (slot 1: slotWeekday/slotHour, slot 2: slotWeekday2/slotHour2), each with
 * its own coach column (coachId/coachName and coachId2/coachName2). `slotNum`
 * selects which session's coach is being changed — omitting it, or passing 1,
 * updates slot 1 only. This lets e.g. slot 1 (Tuesday) go to one coach and
 * slot 2 (Wednesday) go to a different coach on the same enrollment, without
 * one save overwriting the other.
 */
export async function reassignEnrollment(
  enrollmentId: number,
  newCoachId: number,
  slotNum: 1 | 2 = 1
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin()
  try {
    const coachRow = await db
      .select({ name: coaches.name })
      .from(coaches)
      .where(eq(coaches.id, newCoachId))
      .limit(1)
    if (!coachRow.length) return { ok: false, error: "Coach not found" }
    await db
      .update(enrollments)
      .set(
        slotNum === 2
          ? { coachId2: newCoachId, coachName2: coachRow[0].name }
          : { coachId: newCoachId, coachName: coachRow[0].name }
      )
      .where(eq(enrollments.id, enrollmentId))
    revalidatePath("/admin")
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Reassign failed" }
  }
}

/** Fetch attendance records for a coach within a date range (full week). */
export async function getCoachAttendance(
  coachId: number,
  weekOffset: number
): Promise<AttendanceRecord[]> {
  const { start, end } = weekBounds(weekOffset)
  // date column — compare using "YYYY-MM-DD" strings
  const startStr = toDateStr(start)
  const endStr = toDateStr(end)
  const rows = await db
    .select()
    .from(sessionAttendance)
    .where(
      and(
        eq(sessionAttendance.coachId, coachId),
        gte(sessionAttendance.sessionDate, startStr),
        lte(sessionAttendance.sessionDate, endStr)
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
  const ninetyDaysAgo = new Date()
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
  const ninetyDaysAgoStr = toDateStr(ninetyDaysAgo)
  const rows = await db
    .select()
    .from(sessionAttendance)
    .where(
      and(
        eq(sessionAttendance.coachId, coachId),
        gte(sessionAttendance.sessionDate, ninetyDaysAgoStr)
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
  try {
    // sessionDate column is DATE type — pass "YYYY-MM-DD" string directly
    const sessionDateStr = input.sessionDate // already "YYYY-MM-DD"
    // Check for existing record
    const existing = await db
      .select({ id: sessionAttendance.id })
      .from(sessionAttendance)
      .where(
        and(
          eq(sessionAttendance.coachId, input.coachId),
          eq(sessionAttendance.enrollmentId, input.enrollmentId),
          eq(sessionAttendance.sessionDate, sessionDateStr)
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
        sessionDate: sessionDateStr,
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
  try {
    await db.delete(sessionAttendance).where(eq(sessionAttendance.id, attendanceId))
    revalidatePath("/admin")
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to delete attendance" }
  }
}

/** Load published club names for display. */
export async function getClubNames(): Promise<Record<number, string>> {
  const rows = await db
    .select({ id: clubs.id, name: clubs.name })
    .from(clubs)
    .where(eq(clubs.published, true))
  return Object.fromEntries(rows.map((r) => [r.id, r.name]))
}
