"use client"

import { useState, useTransition, useMemo, useCallback } from "react"
import {
  ChevronLeft, ChevronRight, Check, X, Clock, Users, Calendar,
  LogOut, Building2, AlertTriangle, RotateCcw, CheckCircle2,
  XCircle, MinusCircle, Pencil,
} from "lucide-react"
import {
  selfGetAttendance, selfGetEnrollments, selfGetAttendanceHistory,
  selfMarkAttendance, selfCorrectAttendance,
} from "@/app/actions/coach-portal-self"
import { logoutCoach } from "@/app/actions/coach-auth"
import type { CoachingEnrollment, AttendanceRecord } from "@/app/actions/coaching-portal"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function getWeekMonday(offset: number): Date {
  const now = new Date()
  const day = now.getDay()
  const diffToMon = day === 0 ? -6 : 1 - day
  const mon = new Date(now)
  mon.setDate(now.getDate() + diffToMon + offset * 7)
  mon.setHours(0, 0, 0, 0)
  return mon
}

function getWeekDays(offset: number): Date[] {
  const mon = getWeekMonday(offset)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon)
    d.setDate(mon.getDate() + i)
    return d
  })
}

function formatWeekLabel(offset: number): string {
  const mon = getWeekMonday(offset)
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
  const fmt = (d: Date) => d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" })
  return `${fmt(mon)} – ${fmt(sun)}, ${sun.getFullYear()}`
}

function formatHour(h: number): string {
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`
}

function initials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_CONFIG = {
  present:  { label: "Present",  classes: "bg-lime/20 text-[#2d4800] border-lime/40", dot: "bg-lime",      Icon: CheckCircle2 },
  absent:   { label: "Absent",   classes: "bg-red-50 text-red-700 border-red-200",    dot: "bg-red-500",   Icon: XCircle },
  excused:  { label: "Excused",  classes: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-400", Icon: MinusCircle },
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG]
  if (!cfg) return null
  const { Icon } = cfg
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${cfg.classes}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Session Card
// ---------------------------------------------------------------------------

function SessionCard({
  date, weekday, hour, club, enrollments, attendanceMap,
  onMark, onCorrect,
}: {
  date: Date
  weekday: number
  hour: number
  club: string
  clubId: number | null
  enrollments: CoachingEnrollment[]
  attendanceMap: Map<string, AttendanceRecord>
  onMark: (enrollmentId: number, dateStr: string, status: "present" | "absent" | "excused") => void
  onCorrect: (record: AttendanceRecord, status: "present" | "absent" | "excused", note?: string) => void
}) {
  const dateStr = toDateStr(date)
  const [correcting, setCorrecting] = useState<number | null>(null)
  const [correctStatus, setCorrectStatus] = useState<"present" | "absent" | "excused">("present")
  const [correctNote, setCorrectNote] = useState("")
  const [, startTrans] = useTransition()

  const allMarked = enrollments.every((e) => attendanceMap.has(`${e.enrollmentId}:${dateStr}`))
  const markedCount = enrollments.filter((e) => attendanceMap.has(`${e.enrollmentId}:${dateStr}`)).length

  function markAll() {
    enrollments.forEach((e) => {
      if (!attendanceMap.has(`${e.enrollmentId}:${dateStr}`)) {
        onMark(e.enrollmentId, dateStr, "present")
      }
    })
  }

  function startCorrect(record: AttendanceRecord) {
    setCorrecting(record.id)
    setCorrectStatus(record.status)
    setCorrectNote(record.note ?? "")
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between bg-navy px-4 py-3">
        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-lime" />
          <span className="text-xs font-bold text-white">{formatHour(hour)}</span>
          <span className="text-white/40">·</span>
          <Building2 className="h-3.5 w-3.5 text-white/60" />
          <span className="text-xs font-semibold text-white/80 truncate max-w-[140px]">{club}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/50">{markedCount}/{enrollments.length}</span>
          {!allMarked && (
            <button
              onClick={markAll}
              className="flex items-center gap-1 rounded-md bg-lime/20 px-2.5 py-1 text-xs font-bold text-lime hover:bg-lime/30 transition-colors"
            >
              <Check className="h-3 w-3" />
              Mark all present
            </button>
          )}
        </div>
      </div>

      {/* Student list */}
      <div className="divide-y divide-border">
        {enrollments.length === 0 && (
          <p className="px-4 py-5 text-center text-xs text-muted-foreground">No students enrolled.</p>
        )}
        {enrollments.map((enr) => {
          const key = `${enr.enrollmentId}:${dateStr}`
          const record = attendanceMap.get(key)
          const isCorr = correcting === record?.id

          return (
            <div key={enr.enrollmentId} className="px-4 py-3">
              <div className="flex items-center gap-3">
                {/* Avatar */}
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy/10 text-xs font-bold text-navy">
                  {initials(enr.childName)}
                </div>
                {/* Info */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-navy">{enr.childName}</p>
                  <p className="truncate text-xs text-muted-foreground">{enr.parentName} · {enr.packageName}</p>
                </div>
                {/* Attendance controls */}
                {record ? (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <StatusBadge status={record.status} />
                    {!isCorr && (
                      <button
                        onClick={() => startCorrect(record)}
                        title="Correct attendance"
                        className="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground hover:bg-muted transition-colors"
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      onClick={() => onMark(enr.enrollmentId, dateStr, "present")}
                      className="flex items-center gap-1 rounded-md bg-lime/15 border border-lime/30 px-2.5 py-1.5 text-xs font-bold text-[#2d4800] hover:bg-lime/25 transition-colors"
                    >
                      <Check className="h-3 w-3" />
                      Present
                    </button>
                    <button
                      onClick={() => onMark(enr.enrollmentId, dateStr, "absent")}
                      className="flex items-center gap-1 rounded-md bg-red-50 border border-red-200 px-2.5 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 transition-colors"
                    >
                      <X className="h-3 w-3" />
                      Absent
                    </button>
                  </div>
                )}
              </div>

              {/* Inline correction panel */}
              {isCorr && record && (
                <div className="mt-3 ml-11 rounded-xl border border-lime/30 bg-lime/5 p-3 space-y-2">
                  <p className="text-xs font-semibold text-navy">Correct attendance for {enr.childName}</p>
                  <div className="flex flex-wrap gap-2">
                    {(["present", "absent", "excused"] as const).map((s) => {
                      const cfg = STATUS_CONFIG[s]
                      return (
                        <button
                          key={s}
                          onClick={() => setCorrectStatus(s)}
                          className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                            correctStatus === s ? `${cfg.classes} shadow-sm` : "border-border bg-background text-muted-foreground hover:bg-muted"
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
                    placeholder="Optional note…"
                    value={correctNote}
                    onChange={(e) => setCorrectNote(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs outline-none focus:border-lime"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => { onCorrect(record, correctStatus, correctNote || undefined); setCorrecting(null) }}
                      className="flex items-center gap-1 rounded-md bg-lime px-3 py-1.5 text-xs font-bold text-[#1a2a00] hover:bg-lime/90 transition-colors"
                    >
                      <Check className="h-3 w-3" />
                      Save
                    </button>
                    <button
                      onClick={() => setCorrecting(null)}
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
// Main CoachPortalView
// ---------------------------------------------------------------------------

export function CoachPortalView({
  coachId, coachName, coachEmail,
  initialEnrollments, initialAttendance, initialHistory,
}: {
  coachId: number
  coachName: string
  coachEmail: string
  initialEnrollments: CoachingEnrollment[]
  initialAttendance: AttendanceRecord[]
  initialHistory: AttendanceRecord[]
}) {
  const [weekOffset, setWeekOffset] = useState(0)
  const [filterClubId, setFilterClubId] = useState<number | null>(null)
  const [view, setView] = useState<"calendar" | "corrections">("calendar")
  const [enrollments, setEnrollments] = useState(initialEnrollments)
  const [attendance, setAttendance] = useState(initialAttendance)
  const [history, setHistory] = useState(initialHistory)
  const [loading, startLoading] = useTransition()
  const [loggingOut, startLogout] = useTransition()

  // Unique clubs
  const clubs = useMemo(() => {
    const seen = new Map<number, string>()
    for (const e of enrollments) {
      if (e.clubId != null && !seen.has(e.clubId)) seen.set(e.clubId, e.club)
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [enrollments])

  // Attendance lookup
  const attendanceMap = useMemo(() => {
    const map = new Map<string, AttendanceRecord>()
    for (const a of attendance) map.set(`${a.enrollmentId}:${a.sessionDate}`, a)
    return map
  }, [attendance])

  // Week days
  const weekDays = useMemo(() => getWeekDays(weekOffset), [weekOffset])
  const todayStr = toDateStr(new Date())

  // Build session slots per day
  const sessionSlots = useMemo(() => {
    const active = enrollments.filter(
      (e) => e.status === "active" || e.status === "pending"
    ).filter((e) => filterClubId == null || e.clubId === filterClubId)

    type Slot = { hour: number; club: string; clubId: number | null; enrollments: CoachingEnrollment[] }
    const daySlots = weekDays.map((d) => {
      const wd = d.getDay() // 0=Sun,1=Mon...
      const slotMap = new Map<string, Slot>()
      for (const e of active) {
        if (e.slotWeekday === wd && e.slotHour != null) {
          const k = `${e.slotHour}:${e.clubId ?? e.club}`
          if (!slotMap.has(k)) slotMap.set(k, { hour: e.slotHour, club: e.club, clubId: e.clubId, enrollments: [] })
          const slot = slotMap.get(k)!
          if (!slot.enrollments.some((x) => x.enrollmentId === e.enrollmentId)) {
            slot.enrollments.push(e)
          }
        }
        if (e.slotWeekday2 === wd && e.slotHour2 != null) {
          const k = `${e.slotHour2}:${e.clubId ?? e.club}`
          if (!slotMap.has(k)) slotMap.set(k, { hour: e.slotHour2, club: e.club, clubId: e.clubId, enrollments: [] })
          const slot = slotMap.get(k)!
          // Only add if this student isn't already in this slot (via slot 1)
          if (!slot.enrollments.some((x) => x.enrollmentId === e.enrollmentId)) {
            slot.enrollments.push(e)
          }
        }
      }
      return { date: d, slots: Array.from(slotMap.values()).sort((a, b) => a.hour - b.hour) }
    })
    return daySlots
  }, [enrollments, weekDays, filterClubId])

  // Stats
  const totalStudents = useMemo(() => new Set(enrollments.filter(e => e.status === "active" || e.status === "pending").map(e => e.enrollmentId)).size, [enrollments])
  const sessionsThisWeek = useMemo(() => sessionSlots.reduce((n, d) => n + d.slots.length, 0), [sessionSlots])
  const markedThisWeek = useMemo(() => attendance.length, [attendance])

  function handleWeekChange(delta: number) {
    const next = weekOffset + delta
    setWeekOffset(next)
    startLoading(async () => {
      const att = await selfGetAttendance(next)
      setAttendance(att)
    })
  }

  function handleMark(enrollmentId: number, dateStr: string, status: "present" | "absent" | "excused") {
    startLoading(async () => {
      const res = await selfMarkAttendance({ enrollmentId, sessionDate: dateStr, status })
      if (res.ok && res.id) {
        const key = `${enrollmentId}:${dateStr}`
        setAttendance((prev) => {
          const existing = prev.find((a) => `${a.enrollmentId}:${a.sessionDate}` === key)
          if (existing) return prev.map((a) => a.id === existing.id ? { ...a, status, note: null } : a)
          return [...prev, { id: res.id!, enrollmentId, sessionDate: dateStr, status, note: null }]
        })
        setHistory((prev) => {
          const existing = prev.find((a) => a.id === res.id)
          if (existing) return prev.map((a) => a.id === res.id ? { ...a, status, note: null } : a)
          return [...prev, { id: res.id!, enrollmentId, sessionDate: dateStr, status, note: null }]
        })
      }
    })
  }

  function handleCorrect(record: AttendanceRecord, status: "present" | "absent" | "excused", note?: string) {
    startLoading(async () => {
      const res = await selfCorrectAttendance(record.id, status, note)
      if (res.ok) {
        const update = (a: AttendanceRecord) => a.id === record.id ? { ...a, status, note: note ?? null } : a
        setAttendance((prev) => prev.map(update))
        setHistory((prev) => prev.map(update))
      }
    })
  }

  function handleLogout() {
    startLogout(async () => { await logoutCoach() })
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Top nav */}
      <header className="sticky top-0 z-30 border-b border-border bg-navy shadow-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-lime text-navy">
              <Calendar className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-semibold text-white/60 leading-none">Next Gen Padel Academy</p>
              <p className="text-sm font-bold text-white leading-none mt-0.5">Coach Portal</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex h-8 w-8 items-center justify-center rounded-full bg-lime/20 text-sm font-bold text-lime">
              {initials(coachName)}
            </div>
            <div className="hidden sm:block text-right">
              <p className="text-xs font-bold text-white leading-none">{coachName}</p>
              <p className="text-xs text-white/50 leading-none mt-0.5">{coachEmail}</p>
            </div>
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-1.5 text-xs font-semibold text-white/70 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50"
            >
              <LogOut className="h-3.5 w-3.5" />
              {loggingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          {[
            { icon: Users, label: "My Students", value: totalStudents, color: "text-lime" },
            { icon: Calendar, label: "Sessions This Week", value: sessionsThisWeek, color: "text-blue-500" },
            { icon: CheckCircle2, label: "Marked This Week", value: markedThisWeek, color: "text-emerald-500" },
          ].map(({ icon: Icon, label, value, color }) => (
            <div key={label} className="rounded-2xl border border-border bg-card p-4">
              <div className={`mb-1 ${color}`}><Icon className="h-5 w-5" /></div>
              <p className="text-2xl font-black text-navy">{value}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>

        {/* View toggle */}
        <div className="flex items-center gap-2 border-b border-border">
          {(["calendar", "corrections"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-4 py-2.5 text-sm font-semibold capitalize border-b-2 transition-colors ${
                view === v
                  ? "border-lime text-navy"
                  : "border-transparent text-muted-foreground hover:text-navy"
              }`}
            >
              {v === "calendar" ? "Session Calendar" : "Correct Errors"}
            </button>
          ))}
          {loading && <span className="ml-2 text-xs text-muted-foreground animate-pulse">Saving…</span>}
        </div>

        {view === "calendar" && (
          <>
            {/* Week nav + club filter */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1 rounded-xl border border-border bg-card p-1">
                <button onClick={() => handleWeekChange(-1)} className="rounded-lg p-2 hover:bg-muted transition-colors" aria-label="Previous week">
                  <ChevronLeft className="h-4 w-4 text-navy" />
                </button>
                <span className="min-w-[170px] text-center text-sm font-semibold text-navy px-2">{formatWeekLabel(weekOffset)}</span>
                <button onClick={() => handleWeekChange(1)} className="rounded-lg p-2 hover:bg-muted transition-colors" aria-label="Next week">
                  <ChevronRight className="h-4 w-4 text-navy" />
                </button>
              </div>
              {weekOffset !== 0 && (
                <button
                  onClick={() => {
                    setWeekOffset(0)
                    startLoading(async () => { const att = await selfGetAttendance(0); setAttendance(att) })
                  }}
                  className="rounded-xl border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted transition-colors"
                >
                  This week
                </button>
              )}
              <div className="flex flex-wrap gap-1.5 ml-auto">
                <button
                  onClick={() => setFilterClubId(null)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${filterClubId == null ? "bg-navy text-white" : "bg-muted text-muted-foreground hover:text-navy"}`}
                >
                  All clubs
                </button>
                {clubs.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setFilterClubId(filterClubId === c.id ? null : c.id)}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${filterClubId === c.id ? "bg-navy text-white" : "bg-muted text-muted-foreground hover:text-navy"}`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Calendar */}
            <div className="space-y-6">
              {sessionSlots.map(({ date, slots }) => {
                const dateStr = toDateStr(date)
                const isToday = dateStr === todayStr
                if (slots.length === 0) return null
                return (
                  <div key={dateStr}>
                    <div className="mb-3 flex items-center gap-3">
                      <h3 className="text-base font-bold text-navy">
                        {date.toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" })}
                      </h3>
                      {isToday && (
                        <span className="rounded-full bg-lime px-2.5 py-0.5 text-xs font-bold text-[#1a2a00]">Today</span>
                      )}
                      <span className="text-xs text-muted-foreground">{slots.length} session{slots.length !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {slots.map((slot, i) => (
                        <SessionCard
                          key={`${dateStr}-${slot.hour}-${slot.clubId}-${i}`}
                          date={date}
                          weekday={date.getDay()}
                          hour={slot.hour}
                          club={slot.club}
                          clubId={slot.clubId}
                          enrollments={slot.enrollments}
                          attendanceMap={attendanceMap}
                          onMark={handleMark}
                          onCorrect={handleCorrect}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
              {sessionSlots.every(({ slots }) => slots.length === 0) && (
                <div className="rounded-2xl border border-dashed border-border py-20 text-center">
                  <Calendar className="mx-auto h-10 w-10 text-muted-foreground/30" />
                  <p className="mt-3 text-sm font-semibold text-muted-foreground">No sessions this week</p>
                  <p className="mt-1 text-xs text-muted-foreground/60">
                    {filterClubId != null ? "Try switching to 'All clubs'" : "No enrollments with slots assigned for this week."}
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        {view === "corrections" && (
          <CorrectionsPanel
            history={history}
            enrollments={enrollments}
            onHistoryChange={setHistory}
            onAttendanceChange={setAttendance}
          />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Corrections panel
// ---------------------------------------------------------------------------

function CorrectionsPanel({
  history, enrollments, onHistoryChange, onAttendanceChange,
}: {
  history: AttendanceRecord[]
  enrollments: CoachingEnrollment[]
  onHistoryChange: (h: AttendanceRecord[]) => void
  onAttendanceChange: (fn: (a: AttendanceRecord[]) => AttendanceRecord[]) => void
}) {
  const [editing, setEditing] = useState<number | null>(null)
  const [newStatus, setNewStatus] = useState<"present" | "absent" | "excused">("present")
  const [newNote, setNewNote] = useState("")
  const [filterChild, setFilterChild] = useState("")
  const [pending, startTransition] = useTransition()

  const enrollmentMap = useMemo(() => new Map(enrollments.map((e) => [e.enrollmentId, e])), [enrollments])

  const filtered = useMemo(() => {
    const sorted = [...history].sort((a, b) => new Date(b.sessionDate).getTime() - new Date(a.sessionDate).getTime())
    if (!filterChild.trim()) return sorted
    const q = filterChild.toLowerCase()
    return sorted.filter((r) => enrollmentMap.get(r.enrollmentId)?.childName.toLowerCase().includes(q))
  }, [history, enrollmentMap, filterChild])

  function startEdit(record: AttendanceRecord) {
    setEditing(record.id); setNewStatus(record.status); setNewNote(record.note ?? "")
  }

  function handleSave(recordId: number) {
    startTransition(async () => {
      const res = await selfCorrectAttendance(recordId, newStatus, newNote || undefined)
      if (res.ok) {
        const update = (r: AttendanceRecord) => r.id === recordId ? { ...r, status: newStatus, note: newNote || null } : r
        onHistoryChange(history.map(update))
        onAttendanceChange((prev) => prev.map(update))
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
        <p className="mt-1 ml-6 text-xs text-amber-700">Find and fix any attendance records you have marked incorrectly.</p>
      </div>
      <div className="mb-4 flex items-center gap-3">
        <input
          type="text" placeholder="Search by child name…"
          value={filterChild} onChange={(e) => setFilterChild(e.target.value)}
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime"
        />
        <span className="text-sm text-muted-foreground shrink-0">{filtered.length} records</span>
      </div>
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-16 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-muted-foreground/30" />
          <p className="mt-2 text-sm text-muted-foreground">No records found.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((record) => {
            const enr = enrollmentMap.get(record.enrollmentId)
            const isEditing = editing === record.id
            return (
              <div key={record.id} className={`rounded-xl border bg-card transition-shadow ${isEditing ? "border-lime shadow-sm" : "border-border"}`}>
                <div className="flex items-start justify-between gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy/10 text-xs font-bold text-navy">
                        {enr?.childName.charAt(0).toUpperCase() ?? "?"}
                      </div>
                      <span className="font-semibold text-navy text-sm">{enr?.childName ?? `#${record.enrollmentId}`}</span>
                      <StatusBadge status={record.status} />
                    </div>
                    <div className="mt-1 ml-9 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      <span>{new Date(record.sessionDate + "T00:00:00").toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</span>
                      {enr && <span>{enr.club}</span>}
                    </div>
                    {record.note && <p className="mt-1 ml-9 text-xs italic text-muted-foreground">{record.note}</p>}
                  </div>
                  {!isEditing && (
                    <button onClick={() => startEdit(record)} className="flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-navy hover:bg-muted transition-colors">
                      <RotateCcw className="h-3 w-3" />
                      Correct
                    </button>
                  )}
                </div>
                {isEditing && (
                  <div className="border-t border-border bg-muted/30 px-4 py-3 space-y-3">
                    <p className="text-xs font-semibold text-navy">Correcting: {enr?.childName}</p>
                    <div className="flex flex-wrap gap-2">
                      {(["present", "absent", "excused"] as const).map((s) => {
                        const cfg = STATUS_CONFIG[s]
                        return (
                          <button key={s} onClick={() => setNewStatus(s)} className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${newStatus === s ? `${cfg.classes} shadow-sm` : "border-border bg-background text-muted-foreground hover:bg-muted"}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
                            {cfg.label}
                          </button>
                        )
                      })}
                    </div>
                    <input type="text" placeholder="Optional note…" value={newNote} onChange={(e) => setNewNote(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime" />
                    <div className="flex gap-2">
                      <button disabled={pending} onClick={() => handleSave(record.id)} className="flex items-center gap-1.5 rounded-md bg-lime px-3 py-1.5 text-xs font-bold text-[#1a2a00] hover:bg-lime/90 disabled:opacity-50 transition-colors">
                        <Check className="h-3 w-3" />
                        {pending ? "Saving…" : "Save"}
                      </button>
                      <button disabled={pending} onClick={() => setEditing(null)} className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted transition-colors">
                        Cancel
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
