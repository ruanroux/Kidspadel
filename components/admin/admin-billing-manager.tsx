"use client"

import { useState, useTransition, useMemo } from "react"
import {
  CheckCircle2,
  AlertCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  Search,
  BarChart2,
  Users,
  RefreshCw,
  X,
  Check,
} from "lucide-react"
import {
  getBillingLedger,
  getOutstandingReport,
  getRevenueReport,
  backfillAllEnrollments,
  updateMonthStatus,
  bulkMarkPaid,
  type BillingLedgerEntry,
  type OutstandingEntry,
  type RevenueMonthSummary,
} from "@/app/actions/subscription-months"
import {
  BILLING_START_YEAR,
  BILLING_START_MONTH,
  BILLING_END_MONTH,
  MONTH_NAMES,
} from "@/lib/billing-utils"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ZAR = (cents: number) =>
  `R ${(cents / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const BILLING_MONTHS = Array.from(
  { length: BILLING_END_MONTH - BILLING_START_MONTH + 1 },
  (_, i) => BILLING_START_MONTH + i,
)

function statusColor(status: string) {
  switch (status) {
    case "paid":        return "bg-lime/20 text-navy"
    case "outstanding": return "bg-amber-100 text-amber-800"
    case "partial":     return "bg-orange-100 text-orange-700"
    default:            return "bg-muted text-muted-foreground"
  }
}

function StatusDot({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${statusColor(status)}`}
    >
      {status === "paid" && <Check className="mr-0.5 h-2.5 w-2.5" />}
      {status === "outstanding" && <AlertCircle className="mr-0.5 h-2.5 w-2.5" />}
      {status}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type SubView = "ledger" | "outstanding" | "revenue"

export function AdminBillingManager({
  initialLedger,
  initialOutstanding,
  initialRevenue,
}: {
  initialLedger: BillingLedgerEntry[]
  initialOutstanding: OutstandingEntry[]
  initialRevenue: RevenueMonthSummary[]
}) {
  const [subView, setSubView] = useState<SubView>("ledger")
  const [ledger, setLedger] = useState(initialLedger)
  const [outstanding, setOutstanding] = useState(initialOutstanding)
  const [revenue, setRevenue] = useState(initialRevenue)
  const [backfilling, startBackfill] = useTransition()
  const [backfillMsg, setBackfillMsg] = useState<string | null>(null)

  function handleBackfill() {
    startBackfill(async () => {
      const res = await backfillAllEnrollments()
      setBackfillMsg(`Generated ${res.generated} new month records`)
      // Refresh all views
      const [newLedger, newOutstanding, newRevenue] = await Promise.all([
        getBillingLedger(BILLING_START_YEAR),
        getOutstandingReport(BILLING_START_YEAR),
        getRevenueReport(BILLING_START_YEAR),
      ])
      setLedger(newLedger)
      setOutstanding(newOutstanding)
      setRevenue(newRevenue)
      setTimeout(() => setBackfillMsg(null), 4000)
    })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-navy">Billing Ledger</h2>
          <p className="text-sm text-muted-foreground">
            Track monthly payment status for every active enrollment — Aug–Dec {BILLING_START_YEAR}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {backfillMsg && (
            <span className="rounded-md bg-lime/20 px-3 py-1.5 text-xs font-semibold text-navy">
              {backfillMsg}
            </span>
          )}
          <button
            onClick={handleBackfill}
            disabled={backfilling}
            className="flex items-center gap-1.5 rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy/80 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${backfilling ? "animate-spin" : ""}`} />
            Sync Months
          </button>
        </div>
      </div>

      {/* Sub-nav */}
      <div className="flex gap-1 rounded-lg bg-muted/50 p-1">
        {([
          { id: "ledger" as SubView, label: "Ledger", icon: <Users className="h-3.5 w-3.5" /> },
          { id: "outstanding" as SubView, label: "Outstanding", icon: <AlertCircle className="h-3.5 w-3.5" /> },
          { id: "revenue" as SubView, label: "Revenue", icon: <BarChart2 className="h-3.5 w-3.5" /> },
        ]).map((v) => (
          <button
            key={v.id}
            onClick={() => setSubView(v.id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
              subView === v.id
                ? "bg-white text-navy shadow-sm"
                : "text-muted-foreground hover:text-navy"
            }`}
          >
            {v.icon}
            {v.label}
            {v.id === "outstanding" && outstanding.length > 0 && (
              <span className="ml-1 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white leading-none">
                {outstanding.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Views */}
      {subView === "ledger" && (
        <LedgerView
          ledger={ledger}
          onLedgerChange={setLedger}
        />
      )}
      {subView === "outstanding" && (
        <OutstandingView
          outstanding={outstanding}
          onOutstandingChange={setOutstanding}
          onLedgerRefresh={async () => {
            const newLedger = await getBillingLedger(BILLING_START_YEAR)
            setLedger(newLedger)
          }}
        />
      )}
      {subView === "revenue" && <RevenueView revenue={revenue} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ledger view — per-enrollment month grid
// ---------------------------------------------------------------------------

function LedgerView({
  ledger,
  onLedgerChange,
}: {
  ledger: BillingLedgerEntry[]
  onLedgerChange: (l: BillingLedgerEntry[]) => void
}) {
  const [search, setSearch] = useState("")
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [pending, startTransition] = useTransition()
  const [updating, setUpdating] = useState<number | null>(null)
  const [flash, setFlash] = useState<Record<number, "ok" | "err">>({})
  // Per-month draft state — nothing commits until Save is clicked
  const [pendingStatus, setPendingStatus] = useState<Record<number, string>>({})
  const [discountInputs, setDiscountInputs] = useState<Record<number, string>>({})
  const [discountReasons, setDiscountReasons] = useState<Record<number, string>>({})
  const [partialInputs, setPartialInputs] = useState<Record<number, string>>({})

  // Group ledger rows by enrollmentId
  const grouped = useMemo(() => {
    const map = new Map<
      number,
      {
        enrollmentId: number
        childName: string
        parentName: string
        parentEmail: string
        parentMobile: string
        packageName: string
        club: string
        referenceNumber: string
        months: BillingLedgerEntry[]
      }
    >()
    for (const row of ledger) {
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
          months: [],
        })
      }
      map.get(row.enrollmentId)!.months.push(row)
    }
    return [...map.values()].sort((a, b) => a.childName.localeCompare(b.childName))
  }, [ledger])

  const filtered = useMemo(() => {
    if (!search.trim()) return grouped
    const q = search.toLowerCase()
    return grouped.filter(
      (g) =>
        g.childName.toLowerCase().includes(q) ||
        g.parentName.toLowerCase().includes(q) ||
        g.club.toLowerCase().includes(q) ||
        g.packageName.toLowerCase().includes(q) ||
        g.referenceNumber.toLowerCase().includes(q),
    )
  }, [grouped, search])

  function handleApply(rowId: number) {
    const dbRow = ledger.find((r) => r.id === rowId)
    const newStatus = (pendingStatus[rowId] ?? dbRow?.status ?? "outstanding") as "outstanding" | "paid" | "partial"
    const discountPct = discountInputs[rowId] !== undefined
      ? Math.min(100, Math.max(0, parseInt(discountInputs[rowId]) || 0))
      : (dbRow?.discountPct ?? 0)
    const discountReason = discountReasons[rowId] !== undefined
      ? discountReasons[rowId].trim() || undefined
      : (dbRow?.discountReason ?? undefined)
    const partialRaw = partialInputs[rowId] !== undefined
      ? parseFloat(partialInputs[rowId]) || 0
      : (dbRow?.paidCents != null ? dbRow.paidCents / 100 : 0)
    const paidCents = newStatus === "partial" ? Math.round(partialRaw * 100) : undefined

    setUpdating(rowId)
    startTransition(async () => {
      const res = await updateMonthStatus(rowId, newStatus, { discountPct, discountReason, paidCents })
      setUpdating(null)
      if (res.ok) {
        // Clear draft state — now committed to DB
        setPendingStatus((p) => { const n = { ...p }; delete n[rowId]; return n })
        setDiscountInputs((p) => { const n = { ...p }; delete n[rowId]; return n })
        setDiscountReasons((p) => { const n = { ...p }; delete n[rowId]; return n })
        setPartialInputs((p) => { const n = { ...p }; delete n[rowId]; return n })
        onLedgerChange(
          ledger.map((r) =>
            r.id === rowId
              ? { ...r, status: newStatus, discountPct, discountReason: discountReason ?? null, paidCents: paidCents ?? null, paidAt: newStatus === "paid" ? new Date() : null }
              : r,
          ),
        )
        setFlash((f) => ({ ...f, [rowId]: "ok" }))
      } else {
        setFlash((f) => ({ ...f, [rowId]: "err" }))
      }
      setTimeout(() => setFlash((f) => { const n = { ...f }; delete n[rowId]; return n }), 2000)
    })
  }

  if (grouped.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border py-16 text-center">
        <Clock className="mx-auto h-8 w-8 text-muted-foreground/30" />
        <p className="mt-3 text-sm text-muted-foreground">
          No billing months generated yet. Click &ldquo;Sync Months&rdquo; to generate Aug–Dec records for all active enrollments.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by child, parent, club, package or reference..."
          className="w-full rounded-lg border border-border bg-background pl-9 pr-4 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-navy/30"
        />
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-3 gap-3">
        {(() => {
          const total = ledger.length
          const paid = ledger.filter((r) => r.status === "paid").length
          const outstanding = ledger.filter((r) => r.status === "outstanding" || r.status === "partial").length
          const paidR = ledger.filter((r) => r.status === "paid").reduce((s, r) => {
            const disc = Math.round(r.amountCents * (1 - (r.discountPct ?? 0) / 100))
            return s + disc
          }, 0)
          const outR = ledger.reduce((s, r) => {
            if (r.status === "outstanding") return s + Math.round(r.amountCents * (1 - (r.discountPct ?? 0) / 100))
            if (r.status === "partial") {
              const disc = Math.round(r.amountCents * (1 - (r.discountPct ?? 0) / 100))
              return s + Math.max(0, disc - (r.paidCents ?? 0))
            }
            return s
          }, 0)
          return (
            <>
              <StatCard label="Paid" value={`${paid} / ${total}`} sub={ZAR(paidR)} color="text-lime" />
              <StatCard label="Outstanding" value={String(outstanding)} sub={ZAR(outR)} color="text-amber-600" />
              <StatCard label="Total Enrolled" value={String(filtered.length)} sub="students" color="text-navy" />
            </>
          )
        })()}
      </div>

      {/* Enrollment cards */}
      {filtered.map((group) => {
        const isExpanded = expandedId === group.enrollmentId
        const paidCount = group.months.filter((m) => m.status === "paid").length
        const totalCount = group.months.length
        const allPaid = paidCount === totalCount && totalCount > 0
        const hasOutstanding = group.months.some((m) => m.status === "outstanding")

        return (
          <div
            key={group.enrollmentId}
            className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
          >
            {/* Card header */}
            <button
              onClick={() => setExpandedId(isExpanded ? null : group.enrollmentId)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
            >
              {/* Avatar */}
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy/10 text-xs font-bold text-navy">
                {group.childName.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-navy text-sm">{group.childName}</span>
                  <span className="text-xs text-muted-foreground">{group.club}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {group.referenceNumber}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{group.parentName} · {group.packageName}</p>
              </div>
              {/* Progress */}
              <div className="shrink-0 flex items-center gap-3">
                <div className="flex gap-0.5">
                  {group.months.map((m) => (
                    <div
                      key={m.id}
                      title={`${MONTH_NAMES[m.month - 1]}: ${m.status}`}
                      className={`h-2 w-2 rounded-sm ${
                        m.status === "paid" ? "bg-lime" :
                        m.status === "outstanding" ? "bg-amber-400" :
                        m.status === "partial" ? "bg-orange-400" :
                        "bg-muted"
                      }`}
                    />
                  ))}
                </div>
                <span className={`text-xs font-semibold ${allPaid ? "text-lime" : hasOutstanding ? "text-amber-600" : "text-muted-foreground"}`}>
                  {paidCount}/{totalCount}
                </span>
                {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </div>
            </button>

            {/* Expanded month grid */}
            {isExpanded && (
              <div className="border-t border-border bg-muted/20 px-4 py-3">
                <div className="grid grid-cols-5 gap-2">
                  {group.months.map((m) => {
                    const isUpdating = updating === m.id
                    const flashState = flash[m.id]
                    const displayStatus = pendingStatus[m.id] ?? m.status
                    const discountVal = discountInputs[m.id] ?? String(m.discountPct ?? 0)
                    const discountNum = Math.min(100, Math.max(0, parseInt(discountVal) || 0))
                    const reasonVal = discountReasons[m.id] ?? (m.discountReason ?? "")
                    const effectiveCents = Math.round(m.amountCents * (1 - discountNum / 100))
                    const partialVal = partialInputs[m.id] ?? (m.paidCents != null ? String((m.paidCents / 100).toFixed(2)) : "")
                    const partialPaid = parseFloat(partialVal) || 0
                    const remainingCents = Math.max(0, effectiveCents - Math.round(partialPaid * 100))
                    const hasDraft =
                      (pendingStatus[m.id] !== undefined && pendingStatus[m.id] !== m.status) ||
                      discountInputs[m.id] !== undefined ||
                      discountReasons[m.id] !== undefined ||
                      partialInputs[m.id] !== undefined

                    return (
                      <div key={m.id} className={`rounded-lg border p-2.5 transition-colors ${
                        displayStatus === "paid" ? "border-lime/40 bg-lime/5" :
                        displayStatus === "partial" ? "border-orange-200 bg-orange-50" :
                        "border-amber-200 bg-amber-50"
                      }`}>
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-bold text-navy">{MONTH_NAMES[m.month - 1]}</p>
                          {flashState === "ok" && <Check className="h-3.5 w-3.5 text-lime" />}
                          {flashState === "err" && <X className="h-3.5 w-3.5 text-red-500" />}
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          {discountNum > 0 ? (
                            <>
                              <span className="line-through">{ZAR(m.amountCents)}</span>{" "}
                              <span className="font-semibold text-navy">{ZAR(effectiveCents)}</span>
                              <span className="ml-1 text-lime font-bold">-{discountNum}%</span>
                            </>
                          ) : ZAR(m.amountCents)}
                        </p>
                        <div className="mt-1.5">
                          <StatusDot status={displayStatus} />
                        </div>

                        {/* Status dropdown — only updates draft, never auto-saves */}
                        <select
                          disabled={isUpdating || pending}
                          value={displayStatus}
                          onChange={(e) => setPendingStatus((p) => ({ ...p, [m.id]: e.target.value }))}
                          className="mt-2 w-full rounded border border-border bg-background px-1 py-0.5 text-[10px] focus:outline-none focus:ring-1 focus:ring-navy/30 disabled:opacity-50"
                        >
                          <option value="outstanding">Outstanding</option>
                          <option value="paid">Paid</option>
                          <option value="partial">Partial</option>
                        </select>

                        {/* Discount % */}
                        <div className="mt-2">
                          <label className="block text-[9px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                            Discount %
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={discountVal}
                            onChange={(e) => setDiscountInputs((p) => ({ ...p, [m.id]: e.target.value }))}
                            placeholder="0"
                            className="w-full rounded border border-border bg-background px-1.5 py-0.5 text-[10px] focus:outline-none focus:ring-1 focus:ring-navy/30"
                          />
                        </div>

                        {/* Discount reason — shown when discount > 0 */}
                        {discountNum > 0 && (
                          <div className="mt-1.5">
                            <label className="block text-[9px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                              Reason
                            </label>
                            <input
                              type="text"
                              value={reasonVal}
                              onChange={(e) => setDiscountReasons((p) => ({ ...p, [m.id]: e.target.value }))}
                              placeholder="e.g. Sibling discount"
                              className="w-full rounded border border-border bg-background px-1.5 py-0.5 text-[10px] focus:outline-none focus:ring-1 focus:ring-navy/30"
                            />
                          </div>
                        )}

                        {/* Partial amount — shown when draft or saved status is partial */}
                        {displayStatus === "partial" && (
                          <div className="mt-1.5">
                            <label className="block text-[9px] font-semibold uppercase tracking-wide text-orange-700 mb-0.5">
                              Paid (R)
                            </label>
                            <input
                              type="number"
                              min={0}
                              step={0.01}
                              value={partialVal}
                              onChange={(e) => setPartialInputs((p) => ({ ...p, [m.id]: e.target.value }))}
                              placeholder="0.00"
                              className="w-full rounded border border-orange-200 bg-background px-1.5 py-0.5 text-[10px] focus:outline-none focus:ring-1 focus:ring-orange-300"
                            />
                            {remainingCents > 0 && (
                              <p className="mt-0.5 text-[9px] font-semibold text-amber-700">
                                Balance: {ZAR(remainingCents)}
                              </p>
                            )}
                          </div>
                        )}

                        {/* Saved discount reason shown when not editing */}
                        {discountInputs[m.id] === undefined && !discountNum && m.discountReason && (
                          <p className="mt-1 text-[9px] italic text-muted-foreground truncate" title={m.discountReason}>
                            {m.discountReason}
                          </p>
                        )}

                        {/* Save button — always visible, highlighted when unsaved draft */}
                        <button
                          type="button"
                          disabled={isUpdating || pending}
                          onClick={() => handleApply(m.id)}
                          className={`mt-2 w-full rounded px-1 py-0.5 text-[9px] font-bold text-white transition-colors disabled:opacity-50 ${
                            hasDraft ? "bg-navy hover:bg-navy/80 ring-1 ring-navy/40" : "bg-navy/50 hover:bg-navy/70"
                          }`}
                        >
                          {isUpdating ? "Saving..." : hasDraft ? "Apply changes" : "Save"}
                        </button>
                      </div>
                    )
                  })}
                </div>
                {/* Contact info */}
                <div className="mt-3 flex gap-4 text-xs text-muted-foreground border-t border-border/60 pt-3">
                  <span>{group.parentEmail}</span>
                  <span>{group.parentMobile}</span>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Outstanding view
// ---------------------------------------------------------------------------

function OutstandingView({
  outstanding,
  onOutstandingChange,
  onLedgerRefresh,
}: {
  outstanding: OutstandingEntry[]
  onOutstandingChange: (o: OutstandingEntry[]) => void
  onLedgerRefresh: () => Promise<void>
}) {
  const [search, setSearch] = useState("")
  const [pending, startTransition] = useTransition()
  const [markingId, setMarkingId] = useState<number | null>(null)
  const [flash, setFlash] = useState<Record<number, "ok" | "err">>({})

  const filtered = useMemo(() => {
    if (!search.trim()) return outstanding
    const q = search.toLowerCase()
    return outstanding.filter(
      (e) =>
        e.childName.toLowerCase().includes(q) ||
        e.parentName.toLowerCase().includes(q) ||
        e.club.toLowerCase().includes(q),
    )
  }, [outstanding, search])

  const totalOutstanding = outstanding.reduce((s, e) => s + e.totalOutstandingCents, 0)

  function handleMarkAllPaid(entry: OutstandingEntry) {
    const ids = entry.outstandingMonths.map((m) => m.id)
    setMarkingId(entry.enrollmentId)
    startTransition(async () => {
      const res = await bulkMarkPaid(ids)
      setMarkingId(null)
      if (res.ok) {
        onOutstandingChange(outstanding.filter((e) => e.enrollmentId !== entry.enrollmentId))
        await onLedgerRefresh()
        setFlash((f) => ({ ...f, [entry.enrollmentId]: "ok" }))
      } else {
        setFlash((f) => ({ ...f, [entry.enrollmentId]: "err" }))
      }
      setTimeout(() => setFlash((f) => { const n = { ...f }; delete n[entry.enrollmentId]; return n }), 2500)
    })
  }

  return (
    <div className="space-y-4">
      {/* Summary banner */}
      <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
        <div>
          <p className="text-sm font-bold text-amber-900">
            {outstanding.length} student{outstanding.length !== 1 ? "s" : ""} with outstanding months
          </p>
          <p className="text-xs text-amber-700">Total outstanding: {ZAR(totalOutstanding)}</p>
        </div>
        <AlertCircle className="h-7 w-7 text-amber-500" />
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by child, parent or club..."
          className="w-full rounded-lg border border-border bg-background pl-9 pr-4 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-navy/30"
        />
      </div>

      {filtered.length === 0 && (
        <div className="rounded-xl border border-dashed border-border py-12 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-lime/50" />
          <p className="mt-3 text-sm font-semibold text-muted-foreground">All students are up to date</p>
        </div>
      )}

      {filtered.map((entry) => {
        const isMarking = markingId === entry.enrollmentId
        const flashState = flash[entry.enrollmentId]
        return (
          <div key={entry.enrollmentId} className="overflow-hidden rounded-xl border border-amber-200 bg-card shadow-sm">
            {/* Header */}
            <div className="flex items-center gap-3 bg-amber-50 px-4 py-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-200 text-xs font-bold text-amber-900">
                {entry.childName.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-navy">{entry.childName}</p>
                <p className="text-xs text-muted-foreground">{entry.parentName} · {entry.club} · {entry.packageName}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-bold text-amber-800">{ZAR(entry.totalOutstandingCents)}</p>
                <p className="text-[10px] text-muted-foreground">{entry.outstandingMonths.length} month{entry.outstandingMonths.length !== 1 ? "s" : ""}</p>
              </div>
            </div>
            {/* Months row */}
            <div className="flex flex-wrap gap-2 px-4 py-3">
              {entry.outstandingMonths.map((m) => (
                <span
                  key={m.id}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    m.status === "partial"
                      ? "bg-orange-100 text-orange-800"
                      : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {m.label}
                  {m.status === "partial" ? ` — balance ${ZAR(m.remainingCents)}` : ` — ${ZAR(m.remainingCents)}`}
                </span>
              ))}
            </div>
            {/* Action row */}
            <div className="flex items-center justify-between border-t border-amber-100 px-4 py-3">
              <div className="text-xs text-muted-foreground">
                <span>{entry.parentEmail}</span>
                <span className="mx-2">·</span>
                <span>{entry.parentMobile}</span>
              </div>
              <div className="flex items-center gap-2">
                {flashState === "ok" && <span className="text-xs font-semibold text-lime">Marked paid</span>}
                {flashState === "err" && <span className="text-xs font-semibold text-red-500">Failed</span>}
                <button
                  disabled={isMarking || pending}
                  onClick={() => handleMarkAllPaid(entry)}
                  className="flex items-center gap-1.5 rounded-md bg-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy/80 disabled:opacity-50 transition-colors"
                >
                  <Check className="h-3 w-3" />
                  {isMarking ? "Marking..." : "Mark all paid"}
                </button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Revenue view
// ---------------------------------------------------------------------------

function RevenueView({ revenue }: { revenue: RevenueMonthSummary[] }) {
  const totalPaid = revenue.reduce((s, r) => s + r.paidCents, 0)
  const totalOutstanding = revenue.reduce((s, r) => s + r.outstandingCents, 0)
  const totalBilled = revenue.reduce((s, r) => s + r.totalCents, 0)

  const maxCents = Math.max(...revenue.map((r) => r.totalCents), 1)

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total Billed" value={ZAR(totalBilled)} sub={`${BILLING_END_MONTH - BILLING_START_MONTH + 1} months`} color="text-navy" />
        <StatCard label="Collected" value={ZAR(totalPaid)} sub="paid" color="text-lime" />
        <StatCard label="Outstanding" value={ZAR(totalOutstanding)} sub="to collect" color="text-amber-600" />
      </div>

      {/* Month bars */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="mb-4 text-sm font-bold text-navy">Monthly Breakdown — {BILLING_START_YEAR}</h3>
        <div className="space-y-3">
          {revenue.map((r) => {
            const paidPct = maxCents > 0 ? (r.paidCents / maxCents) * 100 : 0
            const outPct = maxCents > 0 ? (r.outstandingCents / maxCents) * 100 : 0
            return (
              <div key={`${r.year}-${r.month}`} className="flex items-center gap-3">
                <span className="w-8 text-xs font-semibold text-muted-foreground text-right shrink-0">
                  {r.label.slice(0, 3)}
                </span>
                <div className="relative flex-1 h-6 rounded-md bg-muted overflow-hidden">
                  <div
                    className="absolute left-0 top-0 h-full bg-lime/70 rounded-md transition-all"
                    style={{ width: `${paidPct}%` }}
                  />
                  <div
                    className="absolute top-0 h-full bg-amber-300/70 rounded-md transition-all"
                    style={{ left: `${paidPct}%`, width: `${outPct}%` }}
                  />
                </div>
                <div className="w-36 shrink-0 text-right">
                  <span className="text-xs font-semibold text-navy">{ZAR(r.paidCents)}</span>
                  <span className="mx-1 text-xs text-muted-foreground">/</span>
                  <span className="text-xs text-muted-foreground">{ZAR(r.totalCents)}</span>
                </div>
                <div className="w-16 shrink-0 text-right">
                  <span className={`text-[10px] font-semibold ${r.outstandingCount > 0 ? "text-amber-600" : "text-lime"}`}>
                    {r.outstandingCount > 0 ? `${r.outstandingCount} due` : "all paid"}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
        <div className="mt-4 flex gap-4 border-t border-border pt-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="h-2.5 w-4 rounded-sm bg-lime/70" />
            Paid
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="h-2.5 w-4 rounded-sm bg-amber-300/70" />
            Outstanding
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared small components
// ---------------------------------------------------------------------------

function StatCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-extrabold ${color}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </div>
  )
}
