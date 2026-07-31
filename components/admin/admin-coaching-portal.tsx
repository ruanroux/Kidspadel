"use client"

import { useState, useTransition, useMemo, useCallback } from "react"
import {
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  Clock,
  Users,
  Building2,
  AlertTriangle,
  RotateCcw,
  Calendar,
  UserCheck,
} from "lucide-react"
import type { CoachOption, CoachingEnrollment, AttendanceRecord } from "@/app/actions/coaching-portal"
import {
  getCoachEnrollments,
  getCoachAttendance,
  getCoachAttendanceHistory,
  markAttendance,
  correctAttendance,
  deleteAttendance,
} from "@/app/actions/coaching-portal"

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const WEEKDAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

function formatHour(h: number): string {
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`
}

function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0]
}

/** Get the Monday of a week offset from today. */
function getWeekMonday(offset: number): Date {
  const now = new Date()
  const day = now.getDay()
  const diffToMon = day === 0 ? -6 : 1 - day
  const mon = new Date(now)
  mon.setDate(now.getDate() + diffToMon + offset * 7)
  mon.setHours(0, 0, 0, 0)
  return mon
}

/** Generate Mon–Fri dates for a given week offset. */
function getWeekDays(offset: number): Date[] {
  const mon = getWeekMonday(offset)
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(mon)
    d.setDate(mon.getDate() + i)
    return d
  })
}

function formatWeekLabel(offset: number): string {
  const mon = getWeekMonday(offset)
  const fri = new Date(mon)
  fri.setDate(mon.getDate() + 4)
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" })
  return `${fmt(mon)} – ${fmt(fri)}, ${fri.getFullYear()}`
}

function formatDateShort(d: Date): string {
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" })
}

// ---------------------------------------------------------------------------
// Attendance status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: "present" | "absent" | "excused" | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">Not marked</span>
  const cfg = {
    present: "bg-lime/20 text-[#3a5a00] border-lime/40",
    absent: "bg-red-50 text-red-700 border-red-200",
    excused: "bg-amber-50 text-amber-700 border-amber-200",
  }[status]
  const label = { present: "Present", absent: "Absent", excused: "Excused" }[status]
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${cfg}`}>
      {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Session Card — one card per unique time slot on a day for a coach
// ---------------------------------------------------------------------------

type SessionSlot = {
  weekday: number // 1=Mon…7=Sun, matching JS .getDay() convention but 1-based Mon
  hour: number
  club: string
  clubId: number | null
  enrollments: CoachingEnrollment[]
}

function SessionCard({
  slot,
  date,
  coachId,
  attendance,
  onAttendanceChange,
}: {
  slot: SessionSlot
  date: Date
  coachId: number
  attendance: AttendanceRecord[]
  onAttendanceChange: (record: AttendanceRecord) => void
}) {
  const dateStr = toDateStr(date)
  const [pending, startTransition] = useTransition()

  const getAttendance = useCallback(
    (enrollmentId: number) =>
      attendance.find((a) => a.enrollmentId === enrollmentId && a.sessionDate === dateStr) ?? null,
    [attendance, dateStr]
  )

  function handleMark(enrollmentId: number, status: "present" | "absent" | "excused") {
    startTransition(async () => {
      const res = await markAttendance({ coachId, enrollmentId, sessionDate: dateStr, status })
      if (res.ok && res.id) {
        onAttendanceChange({ id: res.id, enrollmentId, sessionDate: dateStr, status, note: null })
      }
    })
  }

  const allMarked = slot.enrollments.every((e) => getAttendance(e.enrollmentId) !== null)
  const presentCount = slot.enrollments.filter(
    (e) => getAttendance(e.enrollmentId)?.status === "present"
  ).length

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="flex items-center justify-between gap-2 bg-navy px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-lime shrink-0" />
          <span className="text-sm font-bold text-white">{formatHour(slot.hour)}</span>
          <span className="text-xs text-white/60">·</span>
          <Building2 className="h-3.5 w-3.5 text-white/60 shrink-0" />
          <span className="text-sm text-white/80 truncate">{slot.club}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Users className="h-3.5 w-3.5 text-white/60" />
          <span className="text-xs text-white/70">
            {presentCount}/{slot.enrollments.length}
          </span>
          {allMarked && (
            <span className="ml-1 flex items-center gap-1 rounded-full bg-lime/20 px-2 py-0.5 text-xs font-bold text-lime">
              <Check className="h-3 w-3" />
              Done
            </span>
          )}
        </div>
      </div>

      {/* Roster */}
      <div className="divide-y divide-border">
        {slot.enrollments.map((enr) => {
          const att = getAttendance(enr.enrollmentId)
          return (
            <div key={enr.enrollmentId} className="flex items-center gap-3 px-4 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-navy truncate">{enr.childName}</p>
                <p className="text-xs text-muted-foreground truncate">{enr.parentName}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {att ? (
                  <>
                    <StatusBadge status={att.status} />
                  </>
                ) : (
                  <>
                    <button
                      disabled={pending}
                      onClick={() => handleMark(enr.enrollmentId, "present")}
                      className="flex items-center gap-1 rounded-md border border-lime/50 bg-lime/10 px-2.5 py-1 text-xs font-semibold text-[#3a5a00] hover:bg-lime/20 transition-colors disabled:opacity-50"
                    >
                      <Check className="h-3 w-3" />
                      Present
                    </button>
                    <button
                      disabled={pending}
                      onClick={() => handleMark(enr.enrollmentId, "absent")}
                      className="flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50"
                    >
                      <X className="h-3 w-3" />
                      Absent
                    </button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Correction Panel — fix a previously marked attendance
// ---------------------------------------------------------------------------

function CorrectionPanel({
  coachId,
  enrollments,
  history,
  onHistoryChange,
}: {
  coachId: number
  enrollments: CoachingEnrollment[]
  history: AttendanceRecord[]
  onHistoryChange: (updated: AttendanceRecord[]) => void
}) {
  const [pending, startTransition] = useTransition()
  const [editing, setEditing] = useState<number | null>(null) // attendance id
  const [newStatus, setNewStatus] = useState<"present" | "absent" | "excused">("present")
  const [newNote, setNewNote] = useState("")
  const [filterChild, setFilterChild] = useState("")

  const enrollmentMap = useMemo(
    () => new Map(enrollments.map((e) => [e.enrollmentId, e])),
    [enrollments]
  )

  const filtered = useMemo(() => {
    if (!filterChild.trim()) return history
    const q = filterChild.toLowerCase()
    return history.filter((r) => {
      const enr = enrollmentMap.get(r.enrollmentId)
      return enr?.childName.toLowerCase().includes(q)
    })
  }, [history, enrollmentMap, filterChild])

  function startEdit(record: AttendanceRecord) {
    setEditing(record.id)
    setNewStatus(record.status)
    setNewNote(record.note ?? "")
  }

  function handleSave(recordId: number) {
    startTransition(async () => {
      const res = await correctAttendance({ attendanceId: recordId, status: newStatus, note: newNote || undefined })
      if (res.ok) {
        onHistoryChange(
          history.map((r) =>
            r.id === recordId ? { ...r, status: newStatus, note: newNote || null } : r
          )
        )
        setEditing(null)
      }
    })
  }

  function handleDelete(recordId: number) {
    if (!confirm("Remove this attendance record entirely?")) return
    startTransition(async () => {
      const res = await deleteAttendance(recordId)
      if (res.ok) {
        onHistoryChange(history.filter((r) => r.id !== recordId))
        setEditing(null)
      }
    })
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <input
          type="text"
          placeholder="Search by child name..."
          value={filterChild}
          onChange={(e) => setFilterChild(e.target.value)}
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime"
        />
        <span className="text-sm text-muted-foreground">{filtered.length} records</span>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-12 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <p className="mt-2 text-sm text-muted-foreground">No attendance records found.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {[...filtered].reverse().map((record) => {
            const enr = enrollmentMap.get(record.enrollmentId)
            const isEditing = editing === record.id
            return (
              <div
                key={record.id}
                className={`rounded-xl border bg-card p-4 transition-shadow ${isEditing ? "border-lime shadow-sm" : "border-border"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-navy text-sm">{enr?.childName ?? `Enrollment #${record.enrollmentId}`}</span>
                      <StatusBadge status={record.status} />
                    </div>
                    <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      <span>{new Date(record.sessionDate + "T00:00:00").toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</span>
                      {enr && <span>{enr.club}</span>}
                      {enr && <span>{enr.packageName}</span>}
                    </div>
                    {record.note && (
                      <p className="mt-1 text-xs text-muted-foreground italic">{record.note}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!isEditing && (
                      <>
                        <button
                          onClick={() => startEdit(record)}
                          className="flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-navy hover:bg-muted transition-colors"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Correct
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {isEditing && (
                  <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3 space-y-3">
                    <p className="text-xs font-semibold text-navy">Correct attendance for {enr?.childName}</p>
                    <div className="flex gap-2 flex-wrap">
                      {(["present", "absent", "excused"] as const).map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setNewStatus(s)}
                          className={`rounded-md border px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                            newStatus === s
                              ? s === "present"
                                ? "border-lime bg-lime/20 text-[#3a5a00]"
                                : s === "absent"
                                ? "border-red-300 bg-red-50 text-red-700"
                                : "border-amber-300 bg-amber-50 text-amber-700"
                              : "border-border bg-background text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                    <input
                      type="text"
                      placeholder="Optional note (e.g. late arrival, injury)"
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        disabled={pending}
                        onClick={() => handleSave(record.id)}
                        className="flex items-center gap-1.5 rounded-md bg-lime px-3 py-1.5 text-xs font-bold text-lime-foreground hover:bg-lime/90 disabled:opacity-50 transition-colors"
                      >
                        <Check className="h-3 w-3" />
                        {pending ? "Saving..." : "Save correction"}
                      </button>
                      <button
                        disabled={pending}
                        onClick={() => setEditing(null)}
                        className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        disabled={pending}
                        onClick={() => handleDelete(record.id)}
                        className="ml-auto flex items-center gap-1 rounded-md border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <X className="h-3 w-3" />
                        Remove record
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AdminCoachingPortal({
  initialCoaches,
  initialEnrollments,
  initialAttendance,
  initialHistory,
}: {
  initialCoaches: CoachOption[]
  initialEnrollments: CoachingEnrollment[]
  initialAttendance: AttendanceRecord[]
  initialHistory: AttendanceRecord[]
}) {
  const [selectedCoachId, setSelectedCoachId] = useState<number | null>(
    initialCoaches[0]?.id ?? null
  )
  const [weekOffset, setWeekOffset] = useState(0)
  const [filterClubId, setFilterClubId] = useState<number | null>(null)
  const [view, setView] = useState<"calendar" | "corrections">("calendar")

  const [enrollments, setEnrollments] = useState<CoachingEnrollment[]>(initialEnrollments)
  const [attendance, setAttendance] = useState<AttendanceRecord[]>(initialAttendance)
  const [history, setHistory] = useState<AttendanceRecord[]>(initialHistory)
  const [loading, startLoading] = useTransition()

  function handleCoachChange(coachId: number) {
    setSelectedCoachId(coachId)
    setFilterClubId(null)
    startLoading(async () => {
      const [enrs, att, hist] = await Promise.all([
        getCoachEnrollments(coachId),
        getCoachAttendance(coachId, weekOffset),
        getCoachAttendanceHistory(coachId),
      ])
      setEnrollments(enrs)
      setAttendance(att)
      setHistory(hist)
    })
  }

  function handleWeekChange(delta: number) {
    const newOffset = weekOffset + delta
    setWeekOffset(newOffset)
    if (selectedCoachId) {
      startLoading(async () => {
        const att = await getCoachAttendance(selectedCoachId, newOffset)
        setAttendance(att)
      })
    }
  }

  function handleAttendanceChange(record: AttendanceRecord) {
    setAttendance((prev) => {
      const idx = prev.findIndex(
        (a) => a.enrollmentId === record.enrollmentId && a.sessionDate === record.sessionDate
      )
      if (idx >= 0) {
        const updated = [...prev]
        updated[idx] = record
        return updated
      }
      return [...prev, record]
    })
    // Also update history
    setHistory((prev) => {
      const idx = prev.findIndex((a) => a.id === record.id)
      if (idx >= 0) {
        const updated = [...prev]
        updated[idx] = record
        return updated
      }
      return [...prev, record]
    })
  }

  // Build session slots for the current week
  const weekDays = getWeekDays(weekOffset) // Mon-Fri

  // Convert JS .getDay() (0=Sun,1=Mon…) to our slot weekday (which uses 0=Sun also)
  // Enrollments store slotWeekday as 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat, 7=Sun (some use 0 too)
  // weekDays[0]=Mon → .getDay()=1, weekDays[4]=Fri → .getDay()=5

  type DaySlots = Map<string, SessionSlot> // key = `${clubId}-${hour}`

  const daySlotMap = useMemo<Map<string, DaySlots>>(() => {
    const result = new Map<string, DaySlots>()
    for (const day of weekDays) {
      const dateStr = toDateStr(day)
      const weekdayNum = day.getDay() // 0=Sun, 1=Mon...
      const daySlots: DaySlots = new Map()

      for (const enr of enrollments) {
        // Check slot 1
        if (enr.slotWeekday === weekdayNum && enr.slotHour !== null) {
          if (!filterClubId || enr.clubId === filterClubId) {
            const key = `${enr.clubId ?? "null"}-${enr.slotHour}`
            if (!daySlots.has(key)) {
              daySlots.set(key, {
                weekday: weekdayNum,
                hour: enr.slotHour,
                club: enr.club,
                clubId: enr.clubId,
                enrollments: [],
              })
            }
            daySlots.get(key)!.enrollments.push(enr)
          }
        }
        // Check slot 2 (advanced)
        if (enr.slotWeekday2 === weekdayNum && enr.slotHour2 !== null) {
          if (!filterClubId || enr.clubId === filterClubId) {
            const key = `${enr.clubId ?? "null"}-${enr.slotHour2}-s2`
            if (!daySlots.has(key)) {
              daySlots.set(key, {
                weekday: weekdayNum,
                hour: enr.slotHour2,
                club: enr.club,
                clubId: enr.clubId,
                enrollments: [],
              })
            }
            daySlots.get(key)!.enrollments.push(enr)
          }
        }
      }

      if (daySlots.size > 0) {
        result.set(dateStr, daySlots)
      }
    }
    return result
  }, [enrollments, weekDays, filterClubId])

  // Unique clubs for this coach
  const coachClubs = useMemo(() => {
    const seen = new Map<number, string>()
    for (const enr of enrollments) {
      if (enr.clubId != null && !seen.has(enr.clubId)) {
        seen.set(enr.clubId, enr.club)
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [enrollments])

  const selectedCoach = initialCoaches.find((c) => c.id === selectedCoachId)
  const totalSessions = [...daySlotMap.values()].reduce((s, m) => s + m.size, 0)
  const markedCount = attendance.length

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-xl font-bold text-navy">Coaching Portal</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          View coach schedules, mark session attendance, and correct errors.
        </p>
      </div>

      {/* Coach selector + view toggle */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-semibold text-navy">Coach:</label>
          <div className="flex flex-wrap gap-2">
            {initialCoaches.map((c) => (
              <button
                key={c.id}
                onClick={() => handleCoachChange(c.id)}
                className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors ${
                  selectedCoachId === c.id
                    ? "border-navy bg-navy text-white"
                    : "border-border bg-background text-muted-foreground hover:border-navy hover:text-navy"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-1">
          <button
            onClick={() => setView("calendar")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
              view === "calendar" ? "bg-white text-navy shadow-sm" : "text-muted-foreground hover:text-navy"
            }`}
          >
            <Calendar className="h-4 w-4" />
            Calendar
          </button>
          <button
            onClick={() => setView("corrections")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
              view === "corrections" ? "bg-white text-navy shadow-sm" : "text-muted-foreground hover:text-navy"
            }`}
          >
            <RotateCcw className="h-4 w-4" />
            Correct Errors
          </button>
        </div>
      </div>

      {!selectedCoachId ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <UserCheck className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 text-muted-foreground">Select a coach to view their schedule.</p>
        </div>
      ) : view === "corrections" ? (
        <div>
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
              <p className="text-sm font-semibold text-amber-800">
                Attendance corrections for {selectedCoach?.name} — last 90 days
              </p>
            </div>
            <p className="mt-1 text-xs text-amber-700 ml-6">
              Use this panel to fix sessions that were marked incorrectly. Changes are saved immediately.
            </p>
          </div>
          <CorrectionPanel
            coachId={selectedCoachId}
            enrollments={enrollments}
            history={history}
            onHistoryChange={setHistory}
          />
        </div>
      ) : (
        <>
          {/* Stats bar */}
          <div className="mb-5 grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-border bg-card px-4 py-3 text-center">
              <p className="text-2xl font-extrabold text-navy">{enrollments.length}</p>
              <p className="text-xs text-muted-foreground">Active students</p>
            </div>
            <div className="rounded-xl border border-border bg-card px-4 py-3 text-center">
              <p className="text-2xl font-extrabold text-navy">{totalSessions}</p>
              <p className="text-xs text-muted-foreground">Sessions this week</p>
            </div>
            <div className="rounded-xl border border-border bg-card px-4 py-3 text-center">
              <p className="text-2xl font-extrabold text-lime">{markedCount}</p>
              <p className="text-xs text-muted-foreground">Marked this week</p>
            </div>
          </div>

          {/* Week nav + club filter */}
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
              <button
                onClick={() => handleWeekChange(-1)}
                className="rounded-md p-1 hover:bg-muted transition-colors"
              >
                <ChevronLeft className="h-4 w-4 text-navy" />
              </button>
              <span className="text-sm font-semibold text-navy min-w-[200px] text-center">
                {formatWeekLabel(weekOffset)}
              </span>
              <button
                onClick={() => handleWeekChange(1)}
                className="rounded-md p-1 hover:bg-muted transition-colors"
              >
                <ChevronRight className="h-4 w-4 text-navy" />
              </button>
            </div>
            {weekOffset !== 0 && (
              <button
                onClick={() => {
                  setWeekOffset(0)
                  if (selectedCoachId) {
                    startLoading(async () => {
                      const att = await getCoachAttendance(selectedCoachId, 0)
                      setAttendance(att)
                    })
                  }
                }}
                className="rounded-md border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted transition-colors"
              >
                This week
              </button>
            )}

            {/* Club filter */}
            {coachClubs.length > 1 && (
              <div className="flex flex-wrap items-center gap-2 ml-auto">
                <span className="text-xs font-semibold text-muted-foreground">Filter:</span>
                <button
                  onClick={() => setFilterClubId(null)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                    filterClubId === null
                      ? "border-navy bg-navy text-white"
                      : "border-border text-muted-foreground hover:border-navy hover:text-navy"
                  }`}
                >
                  All clubs
                </button>
                {coachClubs.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setFilterClubId(c.id)}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                      filterClubId === c.id
                        ? "border-navy bg-navy text-white"
                        : "border-border text-muted-foreground hover:border-navy hover:text-navy"
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {loading && (
            <div className="mb-4 rounded-lg bg-muted/50 px-4 py-2 text-sm text-muted-foreground">
              Loading...
            </div>
          )}

          {/* Week calendar grid */}
          <div className="space-y-6">
            {weekDays.map((day) => {
              const dateStr = toDateStr(day)
              const daySlots = daySlotMap.get(dateStr)
              const isToday = toDateStr(new Date()) === dateStr
              const slots = daySlots
                ? [...daySlots.values()].sort((a, b) => a.hour - b.hour)
                : []

              return (
                <div key={dateStr}>
                  {/* Day header */}
                  <div className={`mb-3 flex items-center gap-3 pb-2 border-b ${isToday ? "border-lime" : "border-border"}`}>
                    <div className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-extrabold ${isToday ? "bg-lime text-[#1a2a00]" : "bg-muted text-navy"}`}>
                      {day.getDate()}
                    </div>
                    <div>
                      <p className={`text-sm font-bold ${isToday ? "text-lime" : "text-navy"}`}>
                        {WEEKDAY_FULL[day.getDay()]}
                        {isToday && <span className="ml-2 text-xs font-semibold text-lime/80">(Today)</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">{formatDateShort(day)}</p>
                    </div>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {slots.length === 0 ? "No sessions" : `${slots.length} session${slots.length > 1 ? "s" : ""}`}
                    </span>
                  </div>

                  {slots.length === 0 ? (
                    <p className="pl-12 text-xs text-muted-foreground italic">No coaching sessions scheduled.</p>
                  ) : (
                    <div className="pl-12 space-y-3">
                      {slots.map((slot, idx) => (
                        <SessionCard
                          key={`${dateStr}-${idx}`}
                          slot={slot}
                          date={day}
                          coachId={selectedCoachId!}
                          attendance={attendance}
                          onAttendanceChange={handleAttendanceChange}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
