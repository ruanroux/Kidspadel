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
  Pencil,
  CheckCircle2,
  XCircle,
  MinusCircle,
  ExternalLink,
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

const WEEKDAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

function formatHour(h: number): string {
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`
}

/** Format a Date as "YYYY-MM-DD" using local time (avoids UTC midnight rollover). */
function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
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

function formatDateFull(d: Date): string {
  return d.toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" })
}

// ---------------------------------------------------------------------------
// Attendance status badge
// ---------------------------------------------------------------------------

const STATUS_CONFIG = {
  present: {
    label: "Present",
    classes: "bg-lime/20 text-[#2d4800] border-lime/40",
    dot: "bg-lime",
    icon: CheckCircle2,
  },
  absent: {
    label: "Absent",
    classes: "bg-red-50 text-red-700 border-red-200",
    dot: "bg-red-500",
    icon: XCircle,
  },
  excused: {
    label: "Excused",
    classes: "bg-amber-50 text-amber-700 border-amber-200",
    dot: "bg-amber-400",
    icon: MinusCircle,
  },
} as const

function StatusBadge({
  status,
  onClick,
}: {
  status: "present" | "absent" | "excused" | null
  onClick?: () => void
}) {
  if (!status)
    return (
      <span className="text-xs text-muted-foreground italic">Not marked</span>
    )
  const cfg = STATUS_CONFIG[status]
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors hover:opacity-80 ${cfg.classes} ${onClick ? "cursor-pointer" : "cursor-default"}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
      {onClick && <Pencil className="h-2.5 w-2.5 opacity-60" />}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Session Card — one card per unique time slot on a day for a coach
// ---------------------------------------------------------------------------

type SessionSlot = {
  weekday: number
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
  // Track which enrollment is open for inline correction
  const [correctingId, setCorrectingId] = useState<number | null>(null)
  const [correctionStatus, setCorrectionStatus] = useState<"present" | "absent" | "excused">("present")
  const [correctionNote, setCorrectionNote] = useState("")

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

  function openCorrection(enrollmentId: number, currentStatus: "present" | "absent" | "excused") {
    setCorrectingId(enrollmentId)
    setCorrectionStatus(currentStatus)
    setCorrectionNote("")
  }

  function handleCorrect(att: AttendanceRecord) {
    startTransition(async () => {
      const res = await correctAttendance({
        attendanceId: att.id,
        status: correctionStatus,
        note: correctionNote || undefined,
      })
      if (res.ok) {
        onAttendanceChange({ ...att, status: correctionStatus, note: correctionNote || null })
        setCorrectingId(null)
      }
    })
  }

  function handleMarkAll(status: "present" | "absent") {
    const unmarked = slot.enrollments.filter((e) => !getAttendance(e.enrollmentId))
    if (unmarked.length === 0) return
    startTransition(async () => {
      for (const enr of unmarked) {
        const res = await markAttendance({ coachId, enrollmentId: enr.enrollmentId, sessionDate: dateStr, status })
        if (res.ok && res.id) {
          onAttendanceChange({ id: res.id, enrollmentId: enr.enrollmentId, sessionDate: dateStr, status, note: null })
        }
      }
    })
  }

  const markedCount = slot.enrollments.filter((e) => getAttendance(e.enrollmentId) !== null).length
  const allMarked = markedCount === slot.enrollments.length
  const presentCount = slot.enrollments.filter(
    (e) => getAttendance(e.enrollmentId)?.status === "present"
  ).length

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {/* Card header */}
      <div className="flex items-center justify-between gap-3 bg-navy px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-lime" />
            <span className="text-sm font-bold text-white">{formatHour(slot.hour)}</span>
          </div>
          <span className="text-white/30">|</span>
          <div className="flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5 text-white/50" />
            <span className="text-sm font-semibold text-white/80">{slot.club}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {allMarked ? (
            <span className="flex items-center gap-1 rounded-full bg-lime px-2.5 py-0.5 text-xs font-bold text-[#1a2a00]">
              <Check className="h-3 w-3" />
              All marked
            </span>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                disabled={pending || allMarked}
                onClick={() => handleMarkAll("present")}
                className="rounded-md bg-lime/20 px-2.5 py-1 text-xs font-semibold text-lime hover:bg-lime/30 disabled:opacity-40 transition-colors"
              >
                Mark all present
              </button>
            </div>
          )}
          <div className="flex items-center gap-1 text-white/70">
            <Users className="h-3.5 w-3.5" />
            <span className="text-xs font-semibold">{presentCount}/{slot.enrollments.length}</span>
          </div>
        </div>
      </div>

      {/* Roster */}
      <div className="divide-y divide-border/60">
        {slot.enrollments.map((enr) => {
          const att = getAttendance(enr.enrollmentId)
          const isCorrectingThis = correctingId === enr.enrollmentId

          return (
            <div key={enr.enrollmentId}>
              {/* Main row */}
              <div className="flex items-center gap-3 px-4 py-3">
                {/* Avatar initial */}
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy/10 text-xs font-bold text-navy">
                  {enr.childName.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-navy">{enr.childName}</p>
                  <p className="text-xs text-muted-foreground">{enr.parentName} · {enr.packageName}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {att ? (
                    <StatusBadge
                      status={att.status}
                      onClick={() => {
                        if (isCorrectingThis) {
                          setCorrectingId(null)
                        } else {
                          openCorrection(enr.enrollmentId, att.status)
                        }
                      }}
                    />
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <button
                        disabled={pending}
                        onClick={() => handleMark(enr.enrollmentId, "present")}
                        className="flex items-center gap-1 rounded-md border border-lime/60 bg-lime/10 px-2.5 py-1.5 text-xs font-semibold text-[#2d4800] hover:bg-lime/25 transition-colors disabled:opacity-50"
                      >
                        <Check className="h-3 w-3" />
                        Present
                      </button>
                      <button
                        disabled={pending}
                        onClick={() => handleMark(enr.enrollmentId, "absent")}
                        className="flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50"
                      >
                        <X className="h-3 w-3" />
                        Absent
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Inline correction panel */}
              {isCorrectingThis && att && (
                <div className="border-t border-lime/30 bg-lime/5 px-4 py-3">
                  <p className="mb-2 text-xs font-semibold text-navy">
                    Correct attendance for {enr.childName}
                  </p>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {(["present", "absent", "excused"] as const).map((s) => {
                      const cfg = STATUS_CONFIG[s]
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setCorrectionStatus(s)}
                          className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                            correctionStatus === s
                              ? `${cfg.classes} shadow-sm`
                              : "border-border bg-background text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
                          {cfg.label}
                        </button>
                      )
                    })}
                  </div>
                  <input
                    type="text"
                    placeholder="Optional note (e.g. late arrival, injury...)"
                    value={correctionNote}
                    onChange={(e) => setCorrectionNote(e.target.value)}
                    className="mb-2.5 w-full rounded-md border border-border bg-background px-3 py-2 text-xs outline-none focus:border-lime"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      disabled={pending}
                      onClick={() => handleCorrect(att)}
                      className="flex items-center gap-1.5 rounded-md bg-lime px-3 py-1.5 text-xs font-bold text-[#1a2a00] hover:bg-lime/90 disabled:opacity-50 transition-colors"
                    >
                      <Check className="h-3 w-3" />
                      {pending ? "Saving…" : "Save"}
                    </button>
                    <button
                      onClick={() => setCorrectingId(null)}
                      className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Correction History Panel — review & fix past attendance records
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
  const [editing, setEditing] = useState<number | null>(null)
  const [newStatus, setNewStatus] = useState<"present" | "absent" | "excused">("present")
  const [newNote, setNewNote] = useState("")
  const [filterChild, setFilterChild] = useState("")

  const enrollmentMap = useMemo(
    () => new Map(enrollments.map((e) => [e.enrollmentId, e])),
    [enrollments]
  )

  const filtered = useMemo(() => {
    const sorted = [...history].sort(
      (a, b) => new Date(b.sessionDate).getTime() - new Date(a.sessionDate).getTime()
    )
    if (!filterChild.trim()) return sorted
    const q = filterChild.toLowerCase()
    return sorted.filter((r) => {
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
      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
          <p className="text-sm font-semibold text-amber-800">Attendance corrections — last 90 days</p>
        </div>
        <p className="mt-1 ml-6 text-xs text-amber-700">
          All past attendance records for this coach. Click "Correct" to fix any errors. Changes save immediately.
        </p>
      </div>

      <div className="mb-4 flex items-center gap-3">
        <input
          type="text"
          placeholder="Search by child name..."
          value={filterChild}
          onChange={(e) => setFilterChild(e.target.value)}
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime"
        />
        <span className="text-sm text-muted-foreground shrink-0">{filtered.length} records</span>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-muted-foreground/30" />
          <p className="mt-2 text-sm text-muted-foreground">No attendance records found.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((record) => {
            const enr = enrollmentMap.get(record.enrollmentId)
            const isEditing = editing === record.id
            return (
              <div
                key={record.id}
                className={`rounded-xl border bg-card transition-shadow ${isEditing ? "border-lime shadow-sm" : "border-border"}`}
              >
                <div className="flex items-start justify-between gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy/10 text-xs font-bold text-navy">
                        {enr?.childName.charAt(0).toUpperCase() ?? "?"}
                      </div>
                      <span className="font-semibold text-navy text-sm">
                        {enr?.childName ?? `Enrollment #${record.enrollmentId}`}
                      </span>
                      <StatusBadge status={record.status} />
                    </div>
                    <div className="mt-1 ml-9 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span>
                        {new Date(record.sessionDate + "T00:00:00").toLocaleDateString("en-ZA", {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                      {enr && <span>{enr.club}</span>}
                      {enr && <span className="text-muted-foreground/60">{enr.packageName}</span>}
                    </div>
                    {record.note && (
                      <p className="mt-1 ml-9 text-xs italic text-muted-foreground">{record.note}</p>
                    )}
                  </div>
                  {!isEditing && (
                    <button
                      onClick={() => startEdit(record)}
                      className="flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-navy hover:bg-muted transition-colors"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Correct
                    </button>
                  )}
                </div>

                {isEditing && (
                  <div className="border-t border-border bg-muted/30 px-4 py-3 space-y-3">
                    <p className="text-xs font-semibold text-navy">
                      Correcting attendance for {enr?.childName}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(["present", "absent", "excused"] as const).map((s) => {
                        const cfg = STATUS_CONFIG[s]
                        return (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setNewStatus(s)}
                            className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                              newStatus === s
                                ? `${cfg.classes} shadow-sm`
                                : "border-border bg-background text-muted-foreground hover:bg-muted"
                            }`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
                            {cfg.label}
                          </button>
                        )
                      })}
                    </div>
                    <input
                      type="text"
                      placeholder="Optional note (e.g. late arrival, injury...)"
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        disabled={pending}
                        onClick={() => handleSave(record.id)}
                        className="flex items-center gap-1.5 rounded-md bg-lime px-3 py-1.5 text-xs font-bold text-[#1a2a00] hover:bg-lime/90 disabled:opacity-50 transition-colors"
                      >
                        <Check className="h-3 w-3" />
                        {pending ? "Saving…" : "Save correction"}
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
                        className="ml-auto flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors"
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
    if (coachId === selectedCoachId) return
    setSelectedCoachId(coachId)
    setFilterClubId(null)
    setWeekOffset(0)
    startLoading(async () => {
      const [enrs, att, hist] = await Promise.all([
        getCoachEnrollments(coachId),
        getCoachAttendance(coachId, 0),
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

  function handleJumpToThisWeek() {
    setWeekOffset(0)
    if (selectedCoachId) {
      startLoading(async () => {
        const att = await getCoachAttendance(selectedCoachId, 0)
        setAttendance(att)
      })
    }
  }

  function handleAttendanceChange(record: AttendanceRecord) {
    setAttendance((prev) => {
      const idx = prev.findIndex(
        (a) => a.enrollmentId === record.enrollmentId && a.sessionDate === record.sessionDate
      )
      return idx >= 0
        ? prev.map((a, i) => (i === idx ? record : a))
        : [...prev, record]
    })
    setHistory((prev) => {
      const idx = prev.findIndex((a) => a.id === record.id)
      return idx >= 0
        ? prev.map((a, i) => (i === idx ? record : a))
        : [...prev, record]
    })
  }

  // Build session slots for the current week
  const weekDays = getWeekDays(weekOffset)

  type DaySlots = Map<string, SessionSlot>

  const daySlotMap = useMemo<Map<string, DaySlots>>(() => {
    const result = new Map<string, DaySlots>()
    for (const day of weekDays) {
      const dateStr = toDateStr(day)
      const weekdayNum = day.getDay()
      const daySlots: DaySlots = new Map()

      for (const enr of enrollments) {
        if (!filterClubId || enr.clubId === filterClubId) {
          if (enr.slotWeekday === weekdayNum && enr.slotHour !== null) {
            const key = `${enr.clubId ?? "null"}-${enr.slotHour}`
            if (!daySlots.has(key)) {
              daySlots.set(key, { weekday: weekdayNum, hour: enr.slotHour, club: enr.club, clubId: enr.clubId, enrollments: [] })
            }
            daySlots.get(key)!.enrollments.push(enr)
          }
          if (enr.slotWeekday2 === weekdayNum && enr.slotHour2 !== null) {
            const key = `${enr.clubId ?? "null"}-${enr.slotHour2}-s2`
            if (!daySlots.has(key)) {
              daySlots.set(key, { weekday: weekdayNum, hour: enr.slotHour2, club: enr.club, clubId: enr.clubId, enrollments: [] })
            }
            daySlots.get(key)!.enrollments.push(enr)
          }
        }
      }
      if (daySlots.size > 0) result.set(dateStr, daySlots)
    }
    return result
  }, [enrollments, weekDays, filterClubId])

  const coachClubs = useMemo(() => {
    const seen = new Map<number, string>()
    for (const enr of enrollments) {
      if (enr.clubId != null && !seen.has(enr.clubId)) seen.set(enr.clubId, enr.club)
    }
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [enrollments])

  const selectedCoach = initialCoaches.find((c) => c.id === selectedCoachId)
  const totalSessions = [...daySlotMap.values()].reduce((s, m) => s + m.size, 0)
  const markedThisWeek = attendance.length

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-navy">Coaching Portal</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            View schedules, mark attendance, and correct errors for each coach.
          </p>
        </div>
        {/* View toggle */}
        <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
          <button
            onClick={() => setView("calendar")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
              view === "calendar"
                ? "bg-white text-navy shadow-sm"
                : "text-muted-foreground hover:text-navy"
            }`}
          >
            <Calendar className="h-4 w-4" />
            Calendar
          </button>
          <button
            onClick={() => setView("corrections")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
              view === "corrections"
                ? "bg-white text-navy shadow-sm"
                : "text-muted-foreground hover:text-navy"
            }`}
          >
            <RotateCcw className="h-4 w-4" />
            Correct Errors
          </button>
        </div>
      </div>

      {/* Coach selector cards */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Select coach
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {initialCoaches.map((coach) => {
            const isSelected = selectedCoachId === coach.id
            const coachEnrCount = isSelected ? enrollments.length : coach.studentCount
            return (
              <button
                key={coach.id}
                onClick={() => handleCoachChange(coach.id)}
                disabled={loading}
                className={`group relative overflow-hidden rounded-xl border-2 p-4 text-left transition-all disabled:opacity-60 ${
                  isSelected
                    ? "border-navy bg-navy text-white shadow-md"
                    : "border-border bg-card hover:border-navy/50 hover:shadow-sm"
                }`}
              >
                {/* Avatar + name */}
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                      isSelected ? "bg-lime text-[#1a2a00]" : "bg-navy/10 text-navy"
                    }`}
                  >
                    {coach.name
                      .split(" ")
                      .slice(0, 2)
                      .map((n) => n[0])
                      .join("")
                      .toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className={`font-bold text-sm truncate ${isSelected ? "text-white" : "text-navy"}`}>
                      {coach.name}
                    </p>
                    {isSelected && (
                      <div className="flex items-center gap-2">
                        <p className="text-xs text-lime font-semibold">Active</p>
                        <a
                          href="/coach/login"
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-0.5 text-xs text-white/50 hover:text-lime transition-colors"
                          title="Open coach login page"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Portal
                        </a>
                      </div>
                    )}
                  </div>
                </div>
                {/* Stats */}
                <div className="flex items-center gap-4">
                  <div>
                    <p className={`text-xl font-extrabold ${isSelected ? "text-white" : "text-navy"}`}>
                      {coachEnrCount}
                    </p>
                    <p className={`text-xs ${isSelected ? "text-white/60" : "text-muted-foreground"}`}>
                      Students
                    </p>
                  </div>
                  <div>
                    <p className={`text-xl font-extrabold ${isSelected ? "text-lime" : "text-navy"}`}>
                      {coach.clubCount}
                    </p>
                    <p className={`text-xs ${isSelected ? "text-white/60" : "text-muted-foreground"}`}>
                      Clubs
                    </p>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {!selectedCoachId ? (
        <div className="rounded-xl border border-dashed border-border py-20 text-center">
          <UserCheck className="mx-auto h-10 w-10 text-muted-foreground/30" />
          <p className="mt-3 text-muted-foreground">Select a coach above to view their schedule.</p>
        </div>
      ) : view === "corrections" ? (
        <CorrectionPanel
          coachId={selectedCoachId}
          enrollments={enrollments}
          history={history}
          onHistoryChange={setHistory}
        />
      ) : (
        <>
          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-border bg-card px-4 py-4 text-center">
              <p className="text-3xl font-extrabold text-navy">{enrollments.length}</p>
              <p className="mt-0.5 text-xs font-medium text-muted-foreground">Active students</p>
            </div>
            <div className="rounded-xl border border-border bg-card px-4 py-4 text-center">
              <p className="text-3xl font-extrabold text-navy">{totalSessions}</p>
              <p className="mt-0.5 text-xs font-medium text-muted-foreground">Sessions this week</p>
            </div>
            <div className="rounded-xl border border-border bg-card px-4 py-4 text-center">
              <p className={`text-3xl font-extrabold ${markedThisWeek > 0 ? "text-lime" : "text-muted-foreground/40"}`}>
                {markedThisWeek}
              </p>
              <p className="mt-0.5 text-xs font-medium text-muted-foreground">Marked this week</p>
            </div>
          </div>

          {/* Week navigation + club filter */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Week nav */}
            <div className="flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1.5">
              <button
                onClick={() => handleWeekChange(-1)}
                disabled={loading}
                className="rounded-md p-1.5 hover:bg-muted transition-colors disabled:opacity-50"
              >
                <ChevronLeft className="h-4 w-4 text-navy" />
              </button>
              <span className="min-w-[190px] text-center text-sm font-semibold text-navy">
                {formatWeekLabel(weekOffset)}
              </span>
              <button
                onClick={() => handleWeekChange(1)}
                disabled={loading}
                className="rounded-md p-1.5 hover:bg-muted transition-colors disabled:opacity-50"
              >
                <ChevronRight className="h-4 w-4 text-navy" />
              </button>
            </div>
            {weekOffset !== 0 && (
              <button
                onClick={handleJumpToThisWeek}
                className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted transition-colors"
              >
                This week
              </button>
            )}
            {/* Club filter */}
            {coachClubs.length > 1 && (
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium text-muted-foreground mr-1">Filter:</span>
                <button
                  onClick={() => setFilterClubId(null)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    filterClubId === null
                      ? "border-navy bg-navy text-white"
                      : "border-border text-muted-foreground hover:border-navy/60 hover:text-navy"
                  }`}
                >
                  All clubs
                </button>
                {coachClubs.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setFilterClubId(c.id)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                      filterClubId === c.id
                        ? "border-navy bg-navy text-white"
                        : "border-border text-muted-foreground hover:border-navy/60 hover:text-navy"
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {loading && (
            <div className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
              Loading schedule…
            </div>
          )}

          {/* Week calendar */}
          <div className="space-y-8">
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
                  <div
                    className={`mb-4 flex items-center gap-3 rounded-lg px-4 py-2.5 ${
                      isToday ? "bg-lime/10 border border-lime/30" : "bg-muted/40 border border-border"
                    }`}
                  >
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${
                        isToday ? "bg-lime text-[#1a2a00]" : "bg-navy/10 text-navy"
                      }`}
                    >
                      {day.getDate()}
                    </div>
                    <div>
                      <p className={`text-sm font-bold ${isToday ? "text-navy" : "text-navy"}`}>
                        {WEEKDAY_FULL[day.getDay()]}
                        {isToday && (
                          <span className="ml-2 rounded-full bg-lime/30 px-2 py-0.5 text-xs font-semibold text-[#2d4800]">
                            Today
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">{formatDateFull(day)}</p>
                    </div>
                    <div className="ml-auto">
                      {slots.length === 0 ? (
                        <span className="text-xs text-muted-foreground">No sessions</span>
                      ) : (
                        <span className="rounded-full bg-navy/10 px-2.5 py-1 text-xs font-semibold text-navy">
                          {slots.length} session{slots.length > 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  </div>

                  {slots.length === 0 ? (
                    <p className="pl-4 text-xs italic text-muted-foreground">
                      No coaching sessions scheduled for this day.
                    </p>
                  ) : (
                    <div className="space-y-3 pl-0 lg:pl-4">
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
