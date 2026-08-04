"use client"

import { useState, useTransition, useMemo, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import {
  FileText, Mail, RefreshCw, Check, X, Pencil,
  ChevronDown, ChevronUp, Plus, Filter, Search, Link2, UserPlus, Eye,
  CreditCard, Building2, Landmark, Tag, PowerOff, RotateCcw, Trash2,
} from "lucide-react"
import {
  type AdminSignup,
  type UpdateSignupInput,
  type CreateSignupInput,
  type UserSearchResult,
  regenerateContract,
  resendWelcome,
  updateSignup,
  deactivateSignup,
  reactivateSignup,
  createSignup,
  searchUsers,
  permanentlyDeleteSignup,
} from "@/app/actions/admin-signups"
import { markReferralDiscountApplied } from "@/app/actions/referrals"
import {
  getMonthsForEnrollment,
  updateMonthStatus,
  MONTH_NAMES,
  type SubscriptionMonthRow,
} from "@/app/actions/subscription-months"
import type { CoachRow } from "@/app/actions/coaches"
import type { PublicPackage } from "@/app/actions/packages"
import type { Club } from "@/lib/db/schema"
import { formatSlot } from "@/lib/slots"
import { PackageSlotPicker } from "@/components/package-slot-picker"
import type { SelectedSlot } from "@/components/slot-picker"

/** Compact slot label: "Monday at 13:30 – 14:30" → "Mon 13:30" */
function compactSlot(label: string | null | undefined): string | null {
  if (!label) return null
  // Extract day abbreviation and start time from "Weekday at HH:MM – HH:MM"
  const match = label.match(/^(\w+)\s+at\s+(\d{1,2}:\d{2})/)
  if (match) return `${match[1].slice(0, 3)} ${match[2]}`
  return label
}

/** Shorten verbose package names for display in the compact table. */
function pkgAbbr(name: string): string {
  // Map common long tokens to short forms
  return name
    .replace(/\bDevelopment\b/gi, "Dev")
    .replace(/\bBeginner\b/gi, "Begr")
    .replace(/\bAdvanced\b/gi, "Adv")
    .replace(/\bIntermediate\b/gi, "Inter")
    .replace(/\bPackage\b/gi, "Pkg")
    .replace(/\bProgramme\b/gi, "Prog")
    .replace(/\bAcademy\b/gi, "Acad")
    .replace(/\bBootcamp\b/gi, "Boot")
    .trim()
}

/** Derive an age-group bucket from a numeric age, matching enrollment wizard logic. */
function ageGroupFromAge(age: number | string | null | undefined): string {
  const n = Number(age)
  if (!n) return "5-8"
  if (n <= 8) return "5-8"
  if (n <= 13) return "9-13"
  return "14-17"
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const HOURS = Array.from({ length: 11 }, (_, i) => i + 8)
const STATUS_OPTIONS = ["active", "pending", "cancelled", "on-hold", "inactive"]

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AdminSignupsManager({
  initialSignups,
  allCoaches,
  allPackages,
  allClubs,
}: {
  initialSignups: AdminSignup[]
  allCoaches: CoachRow[]
  allPackages: PublicPackage[]
  allClubs: Club[]
}) {
  const router = useRouter()
  const [signups, setSignups] = useState(initialSignups)
  const [pending, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<number | null>(null)
  const [toast, setToast] = useState<{ id: number; ok: boolean; msg: string } | null>(null)
  const [editing, setEditing] = useState<AdminSignup | null>(null)
  const [viewing, setViewing] = useState<AdminSignup | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<number | null>(null)
  const [confirmReactivateId, setConfirmReactivateId] = useState<number | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)

  // Filters
  const [filterEnrollmentState, setFilterEnrollmentState] = useState<"active" | "inactive" | "all">("active")
  const [filterCoach, setFilterCoach] = useState("")
  const [filterPackage, setFilterPackage] = useState("")
  const [filterClub, setFilterClub] = useState("")
  const [filterStatus, setFilterStatus] = useState("")

  function flash(id: number, ok: boolean, msg: string) {
    setToast({ id, ok, msg })
    setTimeout(() => setToast((t) => (t?.id === id ? null : t)), 4000)
  }

  function openContract(pathname: string) {
    window.open(`/api/admin/contract?pathname=${encodeURIComponent(pathname)}`, "_blank")
  }

  function handleContract(s: AdminSignup) {
    if (s.contractUrl) { openContract(s.contractUrl); return }
    setBusyId(s.id)
    startTransition(async () => {
      try {
        const { pathname } = await regenerateContract(s.id)
        setSignups((prev) => prev.map((p) => (p.id === s.id ? { ...p, contractUrl: pathname } : p)))
        openContract(pathname)
      } catch {
        flash(s.id, false, "Could not generate contract")
      } finally {
        setBusyId(null)
      }
    })
  }

  function handleResend(s: AdminSignup) {
    setBusyId(s.id)
    startTransition(async () => {
      const res = await resendWelcome(s.id)
      flash(s.id, res.ok, res.ok ? "Welcome email sent" : (res.error ?? "Email failed"))
      setBusyId(null)
    })
  }

  function handleSaveEdit(updated: AdminSignup, input: UpdateSignupInput) {
    startTransition(async () => {
      const res = await updateSignup(updated.id, input)
      if (res.ok) {
        const slotLabel =
          input.slotWeekday != null && input.slotHour != null
            ? formatSlot(input.slotWeekday, input.slotHour)
            : updated.slotLabel
        setSignups((prev) =>
          prev.map((p) =>
            p.id === updated.id
              ? {
                  ...p,
                  parentName: input.parentName,
                  parentEmail: input.parentEmail,
                  parentMobile: input.parentMobile,
                  childName: input.childName,
                  childDob: input.childDob,
                  childAge: input.childAge,
                  packageName: input.packageName,
                  club: input.club,
                  clubId: input.clubId ?? p.clubId,
                  coachName: input.coachName,
                  coachId: input.coachId ?? p.coachId,
                  slotWeekday: input.slotWeekday,
                  slotHour: input.slotHour != null ? String(input.slotHour) : null,
                  slotLabel: slotLabel ?? null,
                  emergencyContactName: input.emergencyContactName,
                  emergencyContactPhone: input.emergencyContactPhone,
                  status: input.status,
                }
              : p,
          ),
        )
        flash(updated.id, true, "Details saved")
        setEditing(null)
        router.refresh()
      } else {
        flash(updated.id, false, res.error ?? "Save failed")
      }
    })
  }

  function handleDeactivate(id: number) {
    startTransition(async () => {
      const res = await deactivateSignup(id)
      if (res.ok) {
        setSignups((prev) => prev.map((s) => s.id === id ? { ...s, status: "inactive" } : s))
        setConfirmDeactivateId(null)
        router.refresh()
      } else {
        flash(id, false, res.error ?? "Failed to deactivate")
        setConfirmDeactivateId(null)
      }
    })
  }

  function handleReactivate(id: number) {
    startTransition(async () => {
      const res = await reactivateSignup(id)
      if (res.ok) {
        setSignups((prev) => prev.map((s) => s.id === id ? { ...s, status: "active" } : s))
        setConfirmReactivateId(null)
        router.refresh()
      } else {
        flash(id, false, res.error ?? "Failed to reactivate")
        setConfirmReactivateId(null)
      }
    })
  }

  function handlePermanentDelete(id: number) {
    startTransition(async () => {
      const res = await permanentlyDeleteSignup(id)
      if (res.ok) {
        setSignups((prev) => prev.filter((s) => s.id !== id))
        setConfirmDeleteId(null)
        router.refresh()
      } else {
        flash(id, false, res.error ?? "Delete failed")
        setConfirmDeleteId(null)
      }
    })
  }

  function handleCreate(input: CreateSignupInput) {
    startTransition(async () => {
      const res = await createSignup(input)
      if (res.ok && res.id && res.referenceNumber) {
        const newSignup: AdminSignup = {
          id: res.id,
          referenceNumber: res.referenceNumber,
          parentName: input.parentName,
          parentEmail: input.parentEmail,
          parentMobile: input.parentMobile,
          childName: input.childName,
          childDob: input.childDob,
          childAge: input.childAge,
          packageName: input.packageName,
          club: input.club,
          clubId: input.clubId ?? null,
          coachId: input.coachId ?? null,
          coachName: input.coachName || null,
          slotWeekday: input.slotWeekday,
          slotHour: input.slotHour != null ? String(input.slotHour) : null,
          slotLabel:
            input.slotWeekday != null && input.slotHour != null
              ? formatSlot(input.slotWeekday, input.slotHour)
              : null,
          slotWeekday2: input.slotWeekday2,
          slotHour2: input.slotHour2 != null ? String(input.slotHour2) : null,
          slotLabel2:
            input.slotWeekday2 != null && input.slotHour2 != null
              ? formatSlot(input.slotWeekday2, input.slotHour2)
              : null,
          emergencyContactName: input.emergencyContactName || null,
          emergencyContactPhone: input.emergencyContactPhone || null,
          debitAccountHolder: null,
          debitBankName: null,
          debitAccountNumber: null,
          debitAccountType: null,
          debitDay: null,
          agreedTerms: false,
          consentMedia: false,
          contractUrl: null,
          status: input.status,
          paymentType: "monthly",
          paymentStatus: "pending",
          payfastPaymentId: null,
          signedAt: null,
          createdAt: new Date().toISOString(),
          pendingDiscountPercent: 0,
        }
        setSignups((prev) => [newSignup, ...prev])
        setShowAddModal(false)
        router.refresh()
      } else {
        alert(res.error ?? "Could not create sign-up")
      }
    })
  }

  // Derive unique option lists from live signups data
  const coachOptions = useMemo(() => {
    const names = Array.from(new Set(signups.map((s) => s.coachName).filter(Boolean) as string[]))
    return names.sort()
  }, [signups])

  const packageOptions = useMemo(() => {
    const names = Array.from(new Set(signups.map((s) => s.packageName).filter(Boolean)))
    return names.sort()
  }, [signups])

  const clubOptions = useMemo(() => {
    const names = Array.from(new Set(signups.map((s) => s.club).filter(Boolean) as string[]))
    return names.sort()
  }, [signups])

  const filtered = useMemo(() => {
    return signups.filter((s) => {
      // Enrollment state tab filter
      if (filterEnrollmentState === "active" && s.status === "inactive") return false
      if (filterEnrollmentState === "inactive" && s.status !== "inactive") return false
      // Sub-filters
      if (filterCoach && s.coachName !== filterCoach) return false
      if (filterPackage && s.packageName !== filterPackage) return false
      if (filterClub && s.club !== filterClub) return false
      if (filterStatus && s.status !== filterStatus) return false
      return true
    })
  }, [signups, filterEnrollmentState, filterCoach, filterPackage, filterClub, filterStatus])

  const hasFilters = filterCoach || filterPackage || filterClub || filterStatus
  const activeCount = signups.filter((s) => s.status !== "inactive").length
  const inactiveCount = signups.filter((s) => s.status === "inactive").length

  function statusColor(status: string) {
    switch (status) {
      case "active": return "bg-lime/20 text-navy"
      case "pending": return "bg-amber-100 text-amber-800"
      case "cancelled": return "bg-red-100 text-red-700"
      case "on-hold": return "bg-gray-100 text-gray-600"
      case "inactive": return "bg-muted/60 text-muted-foreground line-through"
      default: return "bg-muted text-muted-foreground"
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-navy">
            Sign-ups ({filtered.length}{hasFilters ? ` of ${signups.length}` : ""})
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every enrollment with its signed contract. Edit details, download the PDF, or resend the welcome email.
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center gap-2 rounded-md bg-lime px-4 py-2 text-sm font-bold text-lime-foreground hover:bg-lime/90"
        >
          <Plus className="h-4 w-4" />
          Add sign-up
        </button>
      </div>

      {/* Active / Inactive tabs */}
      <div className="mt-4 flex gap-1 rounded-lg border border-border bg-muted/40 p-1 w-fit">
        {(["active", "inactive", "all"] as const).map((f) => {
          const count = f === "active" ? activeCount : f === "inactive" ? inactiveCount : signups.length
          return (
            <button
              key={f}
              onClick={() => { setFilterEnrollmentState(f); setFilterStatus("") }}
              className={`rounded-md px-4 py-1.5 text-sm font-semibold transition-colors ${filterEnrollmentState === f ? "bg-card text-navy shadow-sm" : "text-muted-foreground hover:text-navy"}`}
            >
              {f === "active" ? "Active" : f === "inactive" ? "Inactive" : "All"} ({count})
            </button>
          )
        })}
      </div>

      {/* Filters */}
      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Filter className="h-3.5 w-3.5" />
          Filter
        </span>

        <FilterSelect
          label="Coach"
          value={filterCoach}
          onChange={setFilterCoach}
          options={coachOptions}
          placeholder="All coaches"
        />
        <FilterSelect
          label="Package"
          value={filterPackage}
          onChange={setFilterPackage}
          options={packageOptions}
          placeholder="All packages"
        />
        <FilterSelect
          label="Club"
          value={filterClub}
          onChange={setFilterClub}
          options={clubOptions}
          placeholder="All clubs"
        />
        <FilterSelect
          label="Status"
          value={filterStatus}
          onChange={setFilterStatus}
          options={STATUS_OPTIONS}
          placeholder="All statuses"
        />

        {hasFilters && (
          <button
            onClick={() => { setFilterCoach(""); setFilterPackage(""); setFilterClub(""); setFilterStatus("") }}
            className="ml-auto text-xs font-semibold text-muted-foreground underline-offset-2 hover:text-navy hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* List */}
      <div className="mt-4 rounded-card border border-border bg-card shadow-sm">
        <table className="w-full table-fixed text-left text-xs">
          <colgroup>
            <col style={{ width: "5%" }} />{/* ID */}
            <col style={{ width: "13%" }} />{/* Child */}
            <col style={{ width: "5%" }} />{/* Age */}
            <col style={{ width: "11%" }} />{/* Parent */}
            <col style={{ width: "9%" }} />{/* Package */}
            <col style={{ width: "8%" }} />{/* Club */}
            <col style={{ width: "9%" }} />{/* Slot */}
            <col style={{ width: "8%" }} />{/* Coach */}
            <col style={{ width: "7%" }} />{/* Status */}
            <col style={{ width: "9%" }} />{/* Payment */}
            <col style={{ width: "8%" }} />{/* Actions */}
          </colgroup>
          <thead className="border-b border-border bg-muted/40">
            <tr>
              <th className="px-2 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">ID</th>
              <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Child</th>
              <th className="px-2 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Age</th>
              <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Parent</th>
              <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Package</th>
              <th className="px-2 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Club</th>
              <th className="px-2 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Slot</th>
              <th className="px-2 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Coach</th>
              <th className="px-2 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
              <th className="px-2 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Payment</th>
              <th className="px-2 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((s) => {
              const clubData = allClubs.find((c) => c.name === s.club)
              const clubImg = clubData ? (clubData.imageUrl || clubData.image) : null
              const coachData = allCoaches.find((c) => c.name === s.coachName)
              const coachImg = coachData?.imageUrl ?? null
              return (
                <tr key={s.id} className="hover:bg-muted/20 align-middle">
                  {/* Enrollment ID */}
                  <td className="px-2 py-2">
                    <span className="inline-block rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground">
                      #{s.id}
                    </span>
                  </td>
                  {/* Child name */}
                  <td className="truncate px-3 py-2">
                    <span className="font-semibold text-navy">{s.childName}</span>
                  </td>
                  {/* Age — own compact column */}
                  <td className="px-2 py-2 text-center">
                    {s.childAge != null ? (
                      <span className="inline-block rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                        {s.childAge}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  {/* Parent name only */}
                  <td className="truncate px-3 py-2 text-navy">{s.parentName}</td>
                  {/* Package — abbreviated to fit */}
                  <td className="px-3 py-2" title={s.packageName}>
                    <span className="block truncate text-navy">{pkgAbbr(s.packageName)}</span>
                  </td>
                  {/* Club: small avatar + name */}
                  <td className="px-2 py-2">
                    <div className="flex flex-col items-center gap-0.5 text-center">
                      {clubImg ? (
                        <img
                          src={`/api/blob?p=${encodeURIComponent(clubImg)}`}
                          alt={s.club ?? ""}
                          className="h-7 w-7 rounded-md object-cover"
                        />
                      ) : (
                        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted">
                          <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                      )}
                      <span className="max-w-[72px] truncate text-[10px] text-muted-foreground leading-tight">{s.club ?? "—"}</span>
                    </div>
                  </td>
                  {/* Slot — compact "Mon 13:30" */}
                  <td className="px-2 py-2 font-medium text-navy">
                    <div className="flex flex-col gap-0.5">
                      <span title={s.slotLabel ?? undefined}>
                        {compactSlot(s.slotLabel) ?? <span className="text-muted-foreground">TBC</span>}
                      </span>
                      {s.slotLabel2 && (
                        <span className="text-[10px] text-muted-foreground" title={s.slotLabel2}>
                          {compactSlot(s.slotLabel2)}
                        </span>
                      )}
                    </div>
                  </td>
                  {/* Coach: small avatar + name */}
                  <td className="px-2 py-2">
                    {s.coachName ? (
                      <div className="flex flex-col items-center gap-0.5 text-center">
                        {coachImg ? (
                          <img
                            src={`/api/blob?p=${encodeURIComponent(coachImg)}`}
                            alt={s.coachName}
                            className="h-7 w-7 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted font-bold text-[10px] text-muted-foreground uppercase">
                            {s.coachName.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                          </div>
                        )}
                        <span className="max-w-[64px] truncate text-[10px] text-muted-foreground leading-tight">{s.coachName}</span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  {/* Status */}
                  <td className="px-2 py-2">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${statusColor(s.status)}`}>
                      {s.status}
                    </span>
                  </td>
                  {/* Payment */}
                  <td className="px-2 py-2">
                    <PaymentBadge status={s.paymentStatus} />
                    {(s.pendingDiscountPercent ?? 0) > 0 && (
                      <span
                        className="mt-0.5 flex items-center gap-0.5 rounded-full bg-lime/20 px-1.5 py-0.5 text-[9px] font-bold text-lime-foreground"
                        title="Referral discount pending on next debit order"
                      >
                        <Tag className="h-2.5 w-2.5" />
                        {s.pendingDiscountPercent}% off next month
                      </span>
                    )}
                  </td>
                  {/* Actions — icon-only with title tooltips */}
                  <td className="px-2 py-2">
                    <div className="flex items-center justify-end gap-0.5">
                      <IconBtn title="Edit sign-up" onClick={() => setEditing(s)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </IconBtn>
                      {(s.pendingDiscountPercent ?? 0) > 0 && (
                        <IconBtn
                          title={`Mark ${s.pendingDiscountPercent}% referral discount as applied to debit order`}
                          onClick={async () => {
                            startTransition(async () => {
                              await markReferralDiscountApplied(s.id)
                            })
                          }}
                          variant="success"
                        >
                          <Tag className="h-3.5 w-3.5" />
                        </IconBtn>
                      )}
                      <IconBtn
                        title={s.contractUrl ? "View contract" : "Generate PDF"}
                        onClick={() => handleContract(s)}
                        disabled={pending && busyId === s.id}
                      >
                        {busyId === s.id && pending
                          ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          : <FileText className="h-3.5 w-3.5" />}
                      </IconBtn>
                      <IconBtn
                        title="Resend welcome email"
                        onClick={() => handleResend(s)}
                        disabled={pending && busyId === s.id}
                      >
                        {busyId === s.id && pending
                          ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          : <Mail className="h-3.5 w-3.5" />}
                      </IconBtn>
                      {s.status !== "inactive" ? (
                        <IconBtn title="Make Inactive" onClick={() => setConfirmDeactivateId(s.id)} variant="warning">
                          <PowerOff className="h-3.5 w-3.5" />
                        </IconBtn>
                      ) : (
                        <>
                          <IconBtn title="Reactivate" onClick={() => setConfirmReactivateId(s.id)} variant="success">
                            <RotateCcw className="h-3.5 w-3.5" />
                          </IconBtn>
                          <IconBtn title="Delete permanently" onClick={() => setConfirmDeleteId(s.id)} variant="danger">
                            <Trash2 className="h-3.5 w-3.5" />
                          </IconBtn>
                        </>
                      )}
                    </div>
                    {toast?.id === s.id && (
                      <p className={`mt-0.5 text-right text-[10px] font-semibold ${toast.ok ? "text-lime-foreground" : "text-destructive"}`}>
                        {toast.msg}
                      </p>
                    )}
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-muted-foreground">
                  {hasFilters ? "No sign-ups match the current filters." : "No sign-ups yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Edit modal */}
      {editing && (
        <EditModal
          signup={editing}
          pending={pending}
          allCoaches={allCoaches}
          allPackages={allPackages}
          allClubs={allClubs}
          onSave={(input) => handleSaveEdit(editing, input)}
          onClose={() => setEditing(null)}
        />
      )}

      {/* Add modal */}
      {showAddModal && (
        <AddModal
          pending={pending}
          allCoaches={allCoaches}
          allPackages={allPackages}
          allClubs={allClubs}
          onCreate={handleCreate}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {/* Deactivate confirmation dialog */}
      {confirmDeactivateId != null && (
        <ConfirmDialog
          message="Make this enrolment Inactive? The player will be hidden from the coaching portal and attendance registers. All data is preserved and can be restored at any time."
          confirmLabel="Yes, make Inactive"
          pending={pending}
          onConfirm={() => handleDeactivate(confirmDeactivateId)}
          onCancel={() => setConfirmDeactivateId(null)}
          variant="warning"
        />
      )}

      {/* Reactivate confirmation dialog */}
      {confirmReactivateId != null && (
        <ConfirmDialog
          message="Reactivate this enrolment? The player will reappear in the coaching portal and attendance registers."
          confirmLabel="Yes, reactivate"
          pending={pending}
          onConfirm={() => handleReactivate(confirmReactivateId)}
          onCancel={() => setConfirmReactivateId(null)}
          variant="success"
        />
      )}

      {/* Permanent delete confirmation dialog */}
      {confirmDeleteId != null && (
        <ConfirmDialog
          message="Permanently delete this enrolment? This action cannot be undone — all data including the parent record, child details, and payment history will be erased forever. Only inactive enrolments can be deleted."
          confirmLabel="Yes, delete permanently"
          pending={pending}
          onConfirm={() => handlePermanentDelete(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
          variant="danger"
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// PaymentBadge
// ---------------------------------------------------------------------------

function PaymentBadge({
  status,
}: {
  status: string           // paymentStatus from DB
}) {
  const paid = status === "paid" || status === "complete" || status === "completed"
  const failed = status === "failed"
  const pending = !paid && !failed

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
      paid ? "bg-lime/20 text-navy" : failed ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-700"
    }`}>
      <CreditCard className="h-2.5 w-2.5 shrink-0" />
      {paid ? "Paid" : failed ? "Failed" : "Pending"}
    </span>
  )
}

// ---------------------------------------------------------------------------
// ActionBtn (kept for backward compatibility — modals still use it)
// ---------------------------------------------------------------------------

function ActionBtn({
  icon,
  label,
  title,
  onClick,
  disabled,
  variant = "ghost",
}: {
  icon: React.ReactNode
  label: string
  title: string
  onClick: () => void
  disabled?: boolean
  variant?: "ghost" | "danger"
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
        variant === "danger"
          ? "border-red-200 text-red-600 hover:bg-red-50"
          : "border-border text-navy hover:bg-muted"
      }`}
    >
      {icon}
      <span className="hidden lg:inline">{label}</span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// IconBtn — icon-only button with native tooltip via title attr
// ---------------------------------------------------------------------------

function IconBtn({
  children,
  title,
  onClick,
  disabled,
  variant = "ghost",
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "ghost" | "danger" | "success" | "warning"
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:opacity-40 ${
        variant === "danger"
          ? "text-red-500 hover:bg-red-50 hover:text-red-600"
          : variant === "success"
          ? "text-lime-foreground hover:bg-lime/20"
          : variant === "warning"
          ? "text-amber-600 hover:bg-amber-50 hover:text-amber-700"
          : "text-muted-foreground hover:bg-muted hover:text-navy"
      }`}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// View detail modal
// ---------------------------------------------------------------------------

function ViewModal({
  signup: s,
  packagePeriod,
  onClose,
  onEdit,
}: {
  signup: AdminSignup
  packagePeriod: string
  onClose: () => void
  onEdit: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-10">
      <div className="w-full max-w-2xl rounded-xl bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div>
            <h2 className="text-base font-bold text-navy">{s.childName}</h2>
            <p className="text-xs text-muted-foreground">{s.referenceNumber}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onEdit}
              className="inline-flex items-center gap-1.5 rounded-md bg-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy/90"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </button>
            <button onClick={onClose} className="rounded-md p-1.5 hover:bg-muted">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        <div className="space-y-5 px-6 py-5 text-sm">
          {/* Status row */}
          <div className="flex flex-wrap items-center gap-3">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${
              s.status === "active" ? "bg-lime/20 text-navy"
              : s.status === "pending" ? "bg-amber-100 text-amber-800"
              : s.status === "cancelled" ? "bg-red-100 text-red-700"
              : "bg-muted text-muted-foreground"
            }`}>
              {s.status}
            </span>
            <PaymentBadge status={s.paymentStatus} />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            {/* Child */}
            <DetailSection title="Child">
              <DetailRow label="Name" value={s.childName} />
              <DetailRow label="Age" value={s.childAge != null ? String(s.childAge) : "—"} />
              <DetailRow label="DOB" value={s.childDob || "—"} />
            </DetailSection>
            {/* Parent */}
            <DetailSection title="Parent / Guardian">
              <DetailRow label="Name" value={s.parentName} />
              <DetailRow label="Email" value={s.parentEmail} />
              <DetailRow label="Mobile" value={s.parentMobile} />
            </DetailSection>
            {/* Programme */}
            <DetailSection title="Programme">
              <DetailRow label="Package" value={s.packageName} />
              <DetailRow label="Club" value={s.club || "—"} />
              <DetailRow label="Session 1" value={s.slotLabel || "TBC"} />
              {s.slotLabel2 && <DetailRow label="Session 2" value={s.slotLabel2} />}
              <DetailRow label="Coach" value={s.coachName || "—"} />
            </DetailSection>
            {/* Payment */}
            <DetailSection title="Payment">
              <DetailRow label="Type" value={s.paymentType || "—"} />
              <DetailRow label="Status" value={s.paymentStatus || "—"} />
              {(s.paymentType === "debit_order" || s.paymentType === "debit") && (
                <>
                  <DetailRow label="Account holder" value={s.debitAccountHolder || "—"} />
                  <DetailRow label="Bank" value={s.debitBankName || "—"} />
                  <DetailRow label="Account no." value={s.debitAccountNumber ? `****${s.debitAccountNumber.slice(-4)}` : "—"} />
                  <DetailRow label="Account type" value={s.debitAccountType || "—"} />
                  <DetailRow label="Debit day" value={s.debitDay != null ? String(s.debitDay) : "—"} />
                </>
              )}
            </DetailSection>
            {/* Emergency */}
            <DetailSection title="Emergency contact">
              <DetailRow label="Name" value={s.emergencyContactName || "—"} />
              <DetailRow label="Phone" value={s.emergencyContactPhone || "—"} />
            </DetailSection>
            {/* Consents & dates */}
            <DetailSection title="Consents &amp; dates">
              <DetailRow label="Terms agreed" value={s.agreedTerms ? "Yes" : "No"} />
              <DetailRow label="Media consent" value={s.consentMedia ? "Yes" : "No"} />
              <DetailRow label="Signed at" value={s.signedAt ? new Date(s.signedAt).toLocaleDateString("en-ZA") : "—"} />
              <DetailRow label="Created" value={s.createdAt ? new Date(s.createdAt).toLocaleDateString("en-ZA") : "—"} />
            </DetailSection>
          </div>

          {/* Inline billing ledger */}
          <InlineBillingPanel enrollmentId={s.id} />
        </div>
      </div>
    </div>
  )
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <dl className="space-y-1">{children}</dl>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-sm">
      <dt className="w-32 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="font-medium text-navy">{value}</dd>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline billing panel (used inside ViewModal)
// ---------------------------------------------------------------------------

function InlineBillingPanel({ enrollmentId }: { enrollmentId: number }) {
  const [months, setMonths] = useState<SubscriptionMonthRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState<number | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    getMonthsForEnrollment(enrollmentId)
      .then(setMonths)
      .finally(() => setLoading(false))
  }, [enrollmentId])

  function handleChange(id: number, status: "outstanding" | "paid" | "waived" | "deferred") {
    setUpdating(id)
    startTransition(async () => {
      const res = await updateMonthStatus(id, status)
      setUpdating(null)
      if (res.ok) {
        setMonths((prev) =>
          prev
            ? prev.map((m) =>
                m.id === id ? { ...m, status, paidAt: status === "paid" ? new Date() : null } : m,
              )
            : prev,
        )
      }
    })
  }

  return (
    <div className="border-t border-border pt-5">
      <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        Monthly Billing — 2026
      </h3>
      {loading && (
        <p className="text-xs text-muted-foreground">Loading billing months…</p>
      )}
      {!loading && (!months || months.length === 0) && (
        <p className="rounded-lg border border-dashed border-border py-4 text-center text-xs text-muted-foreground">
          No billing months generated yet. Visit the Billing tab and click &ldquo;Sync Months&rdquo;.
        </p>
      )}
      {months && months.length > 0 && (
        <div className="grid grid-cols-5 gap-2">
          {months.map((m) => (
            <div
              key={m.id}
              className={`rounded-lg border p-2 text-center transition-colors ${
                m.status === "paid" ? "border-lime/40 bg-lime/5" :
                m.status === "outstanding" ? "border-amber-200 bg-amber-50" :
                m.status === "waived" ? "border-sky-200 bg-sky-50" :
                "border-border bg-card"
              }`}
            >
              <p className="text-xs font-bold text-navy">{MONTH_NAMES[m.month - 1]}</p>
              <p className="text-[10px] text-muted-foreground">
                R {(m.amountCents / 100).toFixed(0)}
              </p>
              <div className="mt-1">
                <span className={`inline-block rounded-full px-1.5 py-0.5 text-[9px] font-semibold capitalize ${
                  m.status === "paid" ? "bg-lime/20 text-navy" :
                  m.status === "outstanding" ? "bg-amber-100 text-amber-800" :
                  "bg-muted text-muted-foreground"
                }`}>
                  {m.status}
                </span>
              </div>
              <select
                disabled={updating === m.id || pending}
                value={m.status}
                onChange={(e) =>
                  handleChange(m.id, e.target.value as "outstanding" | "paid" | "waived" | "deferred")
                }
                className="mt-1 w-full rounded border border-border bg-background px-1 py-0.5 text-[10px] focus:outline-none focus:ring-1 focus:ring-navy/30 disabled:opacity-50"
              >
                <option value="outstanding">Outstanding</option>
                <option value="paid">Paid</option>
                <option value="partial">Partial</option>
                <option value="waived">Waived</option>
                <option value="deferred">Deferred</option>
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Filter select
// ---------------------------------------------------------------------------

function FilterSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: string[]
  placeholder: string
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`rounded-md border px-2 py-1 text-xs font-medium outline-none focus:border-lime ${
          value ? "border-lime bg-lime/10 text-navy" : "border-border bg-background text-muted-foreground"
        }`}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Confirm dialog
// ---------------------------------------------------------------------------

function ConfirmDialog({
  message,
  confirmLabel,
  pending,
  onConfirm,
  onCancel,
  variant = "danger",
}: {
  message: string
  confirmLabel: string
  pending: boolean
  onConfirm: () => void
  onCancel: () => void
  variant?: "danger" | "warning" | "success"
}) {
  const btnClass =
    variant === "warning"
      ? "bg-amber-600 hover:bg-amber-700"
      : variant === "success"
      ? "bg-lime hover:bg-lime/90 text-lime-foreground"
      : "bg-red-600 hover:bg-red-700"
  const title =
    variant === "warning" ? "Make Inactive" : variant === "success" ? "Reactivate" : "Confirm"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-xl bg-card p-6 shadow-2xl">
        <h3 className="text-base font-bold text-navy">{title}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-navy hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={pending}
            className={`rounded-md px-4 py-2 text-sm font-bold text-white disabled:opacity-50 ${btnClass}`}
          >
            {pending ? "Saving…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared form sections (used in both Edit and Add modals)
// ---------------------------------------------------------------------------

const inputCls = "mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime"
const selectCls = "mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime"

// ---------------------------------------------------------------------------
// Edit modal
// ---------------------------------------------------------------------------

function EditModal({
  signup,
  pending,
  allCoaches,
  allPackages,
  allClubs,
  onSave,
  onClose,
}: {
  signup: AdminSignup
  pending: boolean
  allCoaches: CoachRow[]
  allPackages: PublicPackage[]
  allClubs: Club[]
  onSave: (input: UpdateSignupInput) => void
  onClose: () => void
}) {
  const [parentName, setParentName] = useState(signup.parentName)
  const [parentEmail, setParentEmail] = useState(signup.parentEmail)
  const [parentMobile, setParentMobile] = useState(signup.parentMobile)
  const [childName, setChildName] = useState(signup.childName)
  const [childDob, setChildDob] = useState(signup.childDob ?? "")
  const [childAge, setChildAge] = useState(String(signup.childAge ?? ""))
  const [packageName, setPackageName] = useState(signup.packageName)
  const [club, setClub] = useState(signup.club ?? "")
  const [clubId, setClubId] = useState<number | null>(signup.clubId ?? null)
  const [coachName, setCoachName] = useState(signup.coachName ?? "")
  const [coachId, setCoachId] = useState<number | null>(signup.coachId ?? null)
  const [slotWeekday, setSlotWeekday] = useState<string>(
    signup.slotWeekday != null ? String(signup.slotWeekday) : "",
  )
  const [slotHour, setSlotHour] = useState<string>(
    signup.slotHour != null ? String(signup.slotHour) : "",
  )
  const [slotWeekday2, setSlotWeekday2] = useState<string>(
    signup.slotWeekday2 != null ? String(signup.slotWeekday2) : "",
  )
  const [slotHour2, setSlotHour2] = useState<string>(
    signup.slotHour2 != null ? String(signup.slotHour2) : "",
  )
  const [emergencyName, setEmergencyName] = useState(signup.emergencyContactName ?? "")
  const [emergencyPhone, setEmergencyPhone] = useState(signup.emergencyContactPhone ?? "")
  const [status, setStatus] = useState(signup.status)
  const [paymentStatus, setPaymentStatus] = useState(signup.paymentStatus)

  // Resolve whether the current package is once-off
  const selectedPkg = allPackages.find((p) => p.name === packageName)
  const isOnceOff = selectedPkg?.period === "once-off"

  function submit(e: React.FormEvent) {
    e.preventDefault()
    onSave({
      parentName, parentEmail, parentMobile,
      childName, childDob, childAge: Number(childAge) || 0,
      packageName, club, clubId, coachName, coachId,
      slotWeekday: slotWeekday !== "" ? Number(slotWeekday) : null,
      slotHour: slotHour !== "" ? Number(slotHour) : null,
      slotWeekday2: slotWeekday2 !== "" ? Number(slotWeekday2) : null,
      slotHour2: slotHour2 !== "" ? Number(slotHour2) : null,
      emergencyContactName: emergencyName,
      emergencyContactPhone: emergencyPhone,
      status,
      ...(isOnceOff && { paymentStatus }),
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-10">
      <div className="w-full max-w-2xl rounded-xl bg-card shadow-2xl">
        <ModalHeader title="Edit Sign-up" subtitle={signup.referenceNumber} onClose={onClose} />
        <form onSubmit={submit} className="space-y-5 px-6 py-5">
          <ParentFields
            parentName={parentName} setParentName={setParentName}
            parentEmail={parentEmail} setParentEmail={setParentEmail}
            parentMobile={parentMobile} setParentMobile={setParentMobile}
          />
          <ChildFields
            childName={childName} setChildName={setChildName}
            childDob={childDob} setChildDob={setChildDob}
            childAge={childAge} setChildAge={setChildAge}
          />
          <ProgrammeFields
            packageName={packageName} setPackageName={setPackageName}
            club={club} setClub={setClub} setClubId={setClubId}
            coachName={coachName} setCoachName={setCoachName} setCoachId={setCoachId}
            slotWeekday={slotWeekday} setSlotWeekday={setSlotWeekday}
            slotHour={slotHour} setSlotHour={setSlotHour}
            slotWeekday2={slotWeekday2} setSlotWeekday2={setSlotWeekday2}
            slotHour2={slotHour2} setSlotHour2={setSlotHour2}
            childAge={childAge}
            allPackages={allPackages} allClubs={allClubs} allCoaches={allCoaches}
          />
          <EmergencyFields
            emergencyName={emergencyName} setEmergencyName={setEmergencyName}
            emergencyPhone={emergencyPhone} setEmergencyPhone={setEmergencyPhone}
          />
          <Field label="Enrollment status">
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls}>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
            </select>
          </Field>

          {/* Payment status — only for once-off (PayFast) packages */}
          {isOnceOff && (
            <Field label="Payment status">
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentStatus("complete")}
                  className={`flex-1 rounded-md border-2 px-3 py-2 text-sm font-semibold transition-colors ${
                    paymentStatus === "complete" || paymentStatus === "paid"
                      ? "border-green-500 bg-green-50 text-green-700"
                      : "border-border bg-background text-muted-foreground hover:border-green-300"
                  }`}
                >
                  Paid
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentStatus("pending")}
                  className={`flex-1 rounded-md border-2 px-3 py-2 text-sm font-semibold transition-colors ${
                    paymentStatus !== "complete" && paymentStatus !== "paid"
                      ? "border-red-400 bg-red-50 text-red-600"
                      : "border-border bg-background text-muted-foreground hover:border-red-300"
                  }`}
                >
                  Unpaid
                </button>
              </div>
            </Field>
          )}

          <ModalFooter pending={pending} onClose={onClose} submitLabel="Save changes" />
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Add modal
// ---------------------------------------------------------------------------

function AddModal({
  pending,
  allCoaches,
  allPackages,
  allClubs,
  onCreate,
  onClose,
}: {
  pending: boolean
  allCoaches: CoachRow[]
  allPackages: PublicPackage[]
  allClubs: Club[]
  onCreate: (input: CreateSignupInput) => void
  onClose: () => void
}) {
  // --- Account link mode ---
  const [linkMode, setLinkMode] = useState<"link" | "new">("link")
  const [userQuery, setUserQuery] = useState("")
  const [userResults, setUserResults] = useState<UserSearchResult[]>([])
  const [linkedUser, setLinkedUser] = useState<UserSearchResult | null>(null)
  const [searching, setSearching] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // --- Enrollment fields ---
  const [parentName, setParentName] = useState("")
  const [parentEmail, setParentEmail] = useState("")
  const [parentMobile, setParentMobile] = useState("")
  const [childName, setChildName] = useState("")
  const [childDob, setChildDob] = useState("")
  const [childAge, setChildAge] = useState("")
  const [packageName, setPackageName] = useState(allPackages[0]?.name ?? "")
  const [club, setClub] = useState(allClubs[0]?.name ?? "")
  const [clubId, setClubId] = useState<number | null>(allClubs[0]?.id ?? null)
  const [coachName, setCoachName] = useState("")
  const [coachId, setCoachId] = useState<number | null>(null)
  const [slotWeekday, setSlotWeekday] = useState("")
  const [slotHour, setSlotHour] = useState("")
  const [slotWeekday2, setSlotWeekday2] = useState("")
  const [slotHour2, setSlotHour2] = useState("")
  const [emergencyName, setEmergencyName] = useState("")
  const [emergencyPhone, setEmergencyPhone] = useState("")
  const [status, setStatus] = useState("pending")

  // Debounced user search
  useEffect(() => {
    if (linkMode !== "link" || userQuery.trim().length < 2) {
      setUserResults([])
      return
    }
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(async () => {
      setSearching(true)
      try {
        const results = await searchUsers(userQuery)
        setUserResults(results)
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current) }
  }, [userQuery, linkMode])

  // When a user is selected, auto-fill parent name + email (read-only)
  function selectUser(u: UserSearchResult) {
    setLinkedUser(u)
    setParentName(u.name)
    setParentEmail(u.email)
    setUserResults([])
    setUserQuery("")
  }

  function clearLinkedUser() {
    setLinkedUser(null)
    setParentName("")
    setParentEmail("")
  }

  function switchMode(mode: "link" | "new") {
    setLinkMode(mode)
    setLinkedUser(null)
    setUserQuery("")
    setUserResults([])
    if (mode === "new") {
      setParentName("")
      setParentEmail("")
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    onCreate({
      parentName, parentEmail, parentMobile,
      childName, childDob, childAge: Number(childAge) || 0,
      packageName, club, clubId, coachName, coachId,
      slotWeekday: slotWeekday !== "" ? Number(slotWeekday) : null,
      slotHour: slotHour !== "" ? Number(slotHour) : null,
      slotWeekday2: slotWeekday2 !== "" ? Number(slotWeekday2) : null,
      slotHour2: slotHour2 !== "" ? Number(slotHour2) : null,
      emergencyContactName: emergencyName,
      emergencyContactPhone: emergencyPhone,
      status,
      linkUserId: linkMode === "link" && linkedUser ? linkedUser.id : undefined,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-10">
      <div className="w-full max-w-2xl rounded-xl bg-card shadow-2xl">
        <ModalHeader title="Add Sign-up" subtitle="Manually create a new enrollment record" onClose={onClose} />
        <form onSubmit={submit} className="space-y-5 px-6 py-5">

          {/* ── Account link mode toggle ── */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-bold text-navy">Link to account</legend>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => switchMode("link")}
                className={`flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-semibold transition-colors ${
                  linkMode === "link"
                    ? "border-lime bg-lime/10 text-navy"
                    : "border-border bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                <Link2 className="h-4 w-4" />
                Link existing account
              </button>
              <button
                type="button"
                onClick={() => switchMode("new")}
                className={`flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-semibold transition-colors ${
                  linkMode === "new"
                    ? "border-lime bg-lime/10 text-navy"
                    : "border-border bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                <UserPlus className="h-4 w-4" />
                New / no account
              </button>
            </div>

            {linkMode === "link" && (
              <div className="space-y-2">
                {linkedUser ? (
                  /* Linked account chip */
                  <div className="flex items-center justify-between rounded-lg border border-lime bg-lime/10 px-3 py-2.5">
                    <div>
                      <p className="text-sm font-bold text-navy">{linkedUser.name}</p>
                      <p className="text-xs text-muted-foreground">{linkedUser.email}</p>
                    </div>
                    <button
                      type="button"
                      onClick={clearLinkedUser}
                      className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-navy"
                      aria-label="Remove linked account"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  /* Search box */
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
                      <Search className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <input
                      type="text"
                      placeholder="Search by name or email…"
                      value={userQuery}
                      onChange={(e) => setUserQuery(e.target.value)}
                      className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-lime"
                    />
                    {searching && (
                      <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      </div>
                    )}
                    {userResults.length > 0 && (
                      <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg">
                        {userResults.map((u) => (
                          <li key={u.id}>
                            <button
                              type="button"
                              onClick={() => selectUser(u)}
                              className="flex w-full flex-col px-4 py-2.5 text-left hover:bg-muted"
                            >
                              <span className="text-sm font-semibold text-navy">{u.name}</span>
                              <span className="text-xs text-muted-foreground">{u.email}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {userQuery.trim().length >= 2 && !searching && userResults.length === 0 && (
                      <p className="mt-1.5 text-xs text-muted-foreground">No accounts found — switch to &quot;New / no account&quot; to add manually.</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </fieldset>

          {/* ── Parent / Guardian ── */}
          <ParentFields
            parentName={parentName} setParentName={setParentName}
            parentEmail={parentEmail} setParentEmail={setParentEmail}
            parentMobile={parentMobile} setParentMobile={setParentMobile}
            readOnly={linkMode === "link" && linkedUser != null}
          />
          <ChildFields
            childName={childName} setChildName={setChildName}
            childDob={childDob} setChildDob={setChildDob}
            childAge={childAge} setChildAge={setChildAge}
          />
          <ProgrammeFields
            packageName={packageName} setPackageName={setPackageName}
            club={club} setClub={setClub} setClubId={setClubId}
            coachName={coachName} setCoachName={setCoachName} setCoachId={setCoachId}
            slotWeekday={slotWeekday} setSlotWeekday={setSlotWeekday}
            slotHour={slotHour} setSlotHour={setSlotHour}
            slotWeekday2={slotWeekday2} setSlotWeekday2={setSlotWeekday2}
            slotHour2={slotHour2} setSlotHour2={setSlotHour2}
            childAge={childAge}
            allPackages={allPackages} allClubs={allClubs} allCoaches={allCoaches}
          />
          <EmergencyFields
            emergencyName={emergencyName} setEmergencyName={setEmergencyName}
            emergencyPhone={emergencyPhone} setEmergencyPhone={setEmergencyPhone}
          />
          <Field label="Enrollment status">
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls}>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
            </select>
          </Field>
          <ModalFooter pending={pending} onClose={onClose} submitLabel="Create sign-up" />
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared form sub-components
// ---------------------------------------------------------------------------

function ModalHeader({ title, subtitle, onClose }: { title: string; subtitle: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between border-b border-border px-6 py-4">
      <div>
        <h2 className="text-lg font-bold text-navy">{title}</h2>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-navy" aria-label="Close">
        <X className="h-5 w-5" />
      </button>
    </div>
  )
}

function ModalFooter({ pending, onClose, submitLabel }: { pending: boolean; onClose: () => void; submitLabel: string }) {
  return (
    <div className="flex justify-end gap-2 border-t border-border pt-4">
      <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-navy hover:bg-muted">
        Cancel
      </button>
      <button type="submit" disabled={pending} className="rounded-md bg-lime px-5 py-2 text-sm font-bold text-lime-foreground hover:bg-lime/90 disabled:opacity-50">
        {pending ? "Saving…" : submitLabel}
      </button>
    </div>
  )
}

function ParentFields({ parentName, setParentName, parentEmail, setParentEmail, parentMobile, setParentMobile, readOnly = false }: {
  parentName: string; setParentName: (v: string) => void
  parentEmail: string; setParentEmail: (v: string) => void
  parentMobile: string; setParentMobile: (v: string) => void
  readOnly?: boolean
}) {
  const roClass = readOnly ? "opacity-60 cursor-not-allowed bg-muted" : ""
  return (
    <fieldset className="space-y-3">
      <legend className="flex items-center gap-2 text-sm font-bold text-navy">
        Parent / Guardian
        {readOnly && <span className="rounded-full bg-lime/20 px-2 py-0.5 text-xs font-normal text-navy">auto-filled from account</span>}
      </legend>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Full name" required>
          <input type="text" required readOnly={readOnly} value={parentName} onChange={(e) => setParentName(e.target.value)} className={`${inputCls} ${roClass}`} />
        </Field>
        <Field label="Email" required>
          <input type="email" required readOnly={readOnly} value={parentEmail} onChange={(e) => setParentEmail(e.target.value)} className={`${inputCls} ${roClass}`} />
        </Field>
        <div className="flex flex-col gap-1">
          <Field label="Mobile" required>
            <input
              type="tel"
              required
              value={parentMobile}
              onChange={(e) => setParentMobile(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="0812345678"
              maxLength={10}
              className={inputCls}
            />
          </Field>
          <p className="text-xs text-muted-foreground">Start with 0, no +27 — e.g. 0812345678 (10 digits)</p>
          {parentMobile.length > 0 && !/^0\d{9}$/.test(parentMobile) && (
            <p className="text-xs font-semibold text-destructive">
              {!parentMobile.startsWith("0")
                ? "Must start with 0"
                : `${parentMobile.length}/10 digits`}
            </p>
          )}
        </div>
      </div>
    </fieldset>
  )
}

function ChildFields({ childName, setChildName, childDob, setChildDob, childAge, setChildAge }: {
  childName: string; setChildName: (v: string) => void
  childDob: string; setChildDob: (v: string) => void
  childAge: string; setChildAge: (v: string) => void
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-bold text-navy">Child</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Full name" required>
          <input type="text" required value={childName} onChange={(e) => setChildName(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Date of birth">
          <input type="date" value={childDob} onChange={(e) => setChildDob(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Age">
          <input type="number" min={1} max={17} value={childAge} onChange={(e) => setChildAge(e.target.value)} className={inputCls} />
        </Field>
      </div>
    </fieldset>
  )
}

function ProgrammeFields({
  packageName, setPackageName,
  club, setClub, setClubId,
  coachName, setCoachName, setCoachId,
  slotWeekday, setSlotWeekday,
  slotHour, setSlotHour,
  slotWeekday2, setSlotWeekday2,
  slotHour2, setSlotHour2,
  childAge,
  allPackages, allClubs, allCoaches,
}: {
  packageName: string; setPackageName: (v: string) => void
  club: string; setClub: (v: string) => void
  setClubId?: (v: number | null) => void
  coachName: string; setCoachName: (v: string) => void
  setCoachId?: (v: number | null) => void
  slotWeekday: string; setSlotWeekday: (v: string) => void
  slotHour: string; setSlotHour: (v: string) => void
  slotWeekday2: string; setSlotWeekday2: (v: string) => void
  slotHour2: string; setSlotHour2: (v: string) => void
  childAge?: string | number | null
  allPackages: PublicPackage[]
  allClubs: Club[]
  allCoaches: CoachRow[]
}) {
  // Resolve whether the selected package uses custom slots
  const selectedPkg = allPackages.find((p) => p.name === packageName) ?? null
  const isCustom = selectedPkg?.slotType === "custom"
  // Advanced package = two sessions per week on different days
  const isAdvanced = /advanced/i.test(packageName)

  // Resolve the clubId from the selected club name
  const selectedClub = allClubs.find((c) => c.name === club) ?? null
  const clubId = selectedClub?.id ?? undefined

  // When club changes, update the clubId state and auto-assign first matching coach
  function handleClubChange(newClubName: string) {
    setClub(newClubName)
    const newClub = allClubs.find((c) => c.name === newClubName) ?? null
    setClubId?.(newClub?.id ?? null)
    // Auto-set coach to the first coach assigned to this club (if not already manually set)
    if (newClub) {
      const firstCoach = allCoaches.find((c) => c.clubIds.includes(newClub.id))
      if (firstCoach) {
        setCoachName(firstCoach.name)
        setCoachId?.(firstCoach.id)
      }
    }
  }

  function handleCoachChange(newCoachName: string) {
    setCoachName(newCoachName)
    const coach = allCoaches.find((c) => c.name === newCoachName) ?? null
    setCoachId?.(coach?.id ?? null)
  }

  // Derive age group from child's age for the slot picker
  const ageGroup = ageGroupFromAge(childAge)

  // Map current string state back to a SelectedSlot for the picker
  const selectedSlot: SelectedSlot | null =
    slotWeekday !== "" && slotHour !== ""
      ? { weekday: Number(slotWeekday), hour: Number(slotHour) }
      : null

  function handleSlotSelect(slot: SelectedSlot) {
    setSlotWeekday(String(slot.weekday))
    setSlotHour(String(slot.hour))
  }

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-bold text-navy">Programme</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Package">
          <select value={packageName} onChange={(e) => setPackageName(e.target.value)} className={selectCls}>
            {allPackages.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
            {packageName && !allPackages.find((p) => p.name === packageName) && (
              <option value={packageName}>{packageName}</option>
            )}
          </select>
        </Field>
        <Field label="Club">
          <select value={club} onChange={(e) => handleClubChange(e.target.value)} className={selectCls}>
            {allClubs.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            {club && !allClubs.find((c) => c.name === club) && (
              <option value={club}>{club}</option>
            )}
          </select>
        </Field>
        <Field label="Coach">
          <select value={coachName} onChange={(e) => handleCoachChange(e.target.value)} className={selectCls}>
            <option value="">— not assigned —</option>
            {allCoaches.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
        </Field>
      </div>

      {isCustom && selectedPkg ? (
        /* Custom package — show the same slot picker customers see, filtered to this club */
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-semibold text-navy">Session 1{isAdvanced ? " (first coaching session)" : ""}</p>
            {!isAdvanced && (
              <p className="mb-3 text-xs text-muted-foreground">
                Only the slots configured for this package{clubId ? " at this venue" : ""} are shown. Select one to assign it.
              </p>
            )}
            <PackageSlotPicker
              packageId={selectedPkg.id}
              packageName={selectedPkg.name}
              ageGroup={ageGroup}
              clubId={clubId}
              selected={selectedSlot}
              onSelect={handleSlotSelect}
            />
            {selectedSlot && (
              <p className="mt-2 text-xs text-muted-foreground">
                Selected: <span className="font-semibold text-navy">{formatSlot(selectedSlot.weekday, selectedSlot.hour)}</span>
                {" · "}
                <button type="button" onClick={() => { setSlotWeekday(""); setSlotHour("") }} className="text-destructive hover:underline">
                  Clear
                </button>
              </p>
            )}
          </div>

          {isAdvanced && (
            <div>
              <p className="mb-2 text-xs font-semibold text-navy">Session 2 (second coaching session — different day)</p>
              <PackageSlotPicker
                packageId={selectedPkg.id}
                packageName={selectedPkg.name}
                ageGroup={ageGroup}
                clubId={clubId}
                selected={slotWeekday2 !== "" && slotHour2 !== "" ? { weekday: Number(slotWeekday2), hour: Number(slotHour2) } : null}
                onSelect={(slot) => { setSlotWeekday2(String(slot.weekday)); setSlotHour2(String(slot.hour)) }}
              />
              {slotWeekday2 !== "" && slotHour2 !== "" && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Selected: <span className="font-semibold text-navy">{formatSlot(Number(slotWeekday2), Number(slotHour2))}</span>
                  {" · "}
                  <button type="button" onClick={() => { setSlotWeekday2(""); setSlotHour2("") }} className="text-destructive hover:underline">
                    Clear
                  </button>
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
        /* Standard package — free day + time selects */
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={isAdvanced ? "Session 1 — day" : "Session day"}>
              <select value={slotWeekday} onChange={(e) => setSlotWeekday(e.target.value)} className={selectCls}>
                <option value="">— not set —</option>
                {WEEKDAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
            </Field>
            <Field label={isAdvanced ? "Session 1 — time" : "Session time"}>
              <select value={slotHour} onChange={(e) => setSlotHour(e.target.value)} className={selectCls}>
                <option value="">— not set —</option>
                {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
              </select>
            </Field>
          </div>
          {isAdvanced && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Session 2 — day">
                <select value={slotWeekday2} onChange={(e) => setSlotWeekday2(e.target.value)} className={selectCls}>
                  <option value="">— not set —</option>
                  {WEEKDAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                </select>
              </Field>
              <Field label="Session 2 — time">
                <select value={slotHour2} onChange={(e) => setSlotHour2(e.target.value)} className={selectCls}>
                  <option value="">— not set —</option>
                  {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
                </select>
              </Field>
            </div>
          )}
        </div>
      )}
    </fieldset>
  )
}

function EmergencyFields({ emergencyName, setEmergencyName, emergencyPhone, setEmergencyPhone }: {
  emergencyName: string; setEmergencyName: (v: string) => void
  emergencyPhone: string; setEmergencyPhone: (v: string) => void
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-bold text-navy">Emergency Contact</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input type="text" value={emergencyName} onChange={(e) => setEmergencyName(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Phone">
          <input type="tel" value={emergencyPhone} onChange={(e) => setEmergencyPhone(e.target.value)} className={inputCls} />
        </Field>
      </div>
    </fieldset>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <span className="block text-xs font-semibold text-navy">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </span>
      {children}
    </div>
  )
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`mr-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${ok ? "bg-lime/15 text-navy" : "bg-muted text-muted-foreground"}`}>
      {ok ? <Check className="h-3 w-3 text-lime" /> : <X className="h-3 w-3" />}
      {label}
    </span>
  )
}
