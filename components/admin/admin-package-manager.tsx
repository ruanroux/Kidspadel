"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Pencil, Plus, Check, X, PowerOff, RotateCcw } from "lucide-react"
import {
  createPackage,
  updatePackage,
  deactivatePackage,
  reactivatePackage,
  getPackageSlots,
  type PublicPackage,
  type PackageInput,
  type CustomSlot,
  type FeatureItem,
} from "@/app/actions/packages"
import { SLOT_HOURS, formatHour, formatEndHour } from "@/lib/slots"
import { AGE_GROUPS, type AgeGroup, type Club, type School } from "@/lib/db/schema"

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
// SLOT_HOURS is imported from lib/slots — half-hour increments 08:00–18:00

const AGE_GROUP_LABELS: Record<AgeGroup, string> = {
  "4-8": "Ages 4 – 8",
  "9-13": "Ages 9 – 13",
  "14-17": "Ages 14 – 17",
}

const EMPTY: PackageInput = {
  slug: "",
  name: "",
  price: 0,
  period: "monthly",
  tagline: "",
  features: [] as FeatureItem[],
  description: "",
  popular: false,
  published: true,
  slotType: "standard",
  sortOrder: 0,
  customSlots: [],
  isSchool: false,
}

export function AdminPackageManager({
  initialPackages,
  allClubs,
  allSchools,
}: {
  initialPackages: PublicPackage[]
  allClubs: Club[]
  allSchools: School[]
}) {
  const router = useRouter()
  const [editing, setEditing] = useState<{ pkg: PublicPackage; slots: CustomSlot[] } | null>(null)
  const [creating, setCreating] = useState(false)
  const [pending, startTransition] = useTransition()
  // Active/Inactive filter: "active" | "inactive" | "all"
  const [filter, setFilter] = useState<"active" | "inactive" | "all">("active")
  // Confirm deactivate: { id, name }
  const [confirmDeactivate, setConfirmDeactivate] = useState<{ id: number; name: string } | null>(null)
  // Confirm reactivate: { id, name }
  const [confirmReactivate, setConfirmReactivate] = useState<{ id: number; name: string; count?: number } | null>(null)
  const [reactivateEnrollments, setReactivateEnrollments] = useState(false)

  function openCreate() {
    setCreating(true)
    setEditing(null)
  }

  function openEdit(pkg: PublicPackage) {
    startTransition(async () => {
      const slots = pkg.slotType === "custom" ? await getPackageSlots(pkg.id) : []
      setEditing({ pkg, slots })
      setCreating(false)
    })
  }

  function closeModal() {
    setCreating(false)
    setEditing(null)
  }

  function handleSave(input: PackageInput) {
    startTransition(async () => {
      if (editing) await updatePackage(editing.pkg.id, input)
      else await createPackage(input)
      closeModal()
      router.refresh()
    })
  }

  function handleDeactivate(id: number) {
    startTransition(async () => {
      await deactivatePackage(id)
      setConfirmDeactivate(null)
      router.refresh()
    })
  }

  function handleReactivate(id: number) {
    startTransition(async () => {
      await reactivatePackage(id, reactivateEnrollments)
      setConfirmReactivate(null)
      setReactivateEnrollments(false)
      router.refresh()
    })
  }

  function periodLabel(p: string) {
    return p === "once-off" ? "once off" : "/month"
  }

  const activePackages = initialPackages.filter((p) => p.published)
  const inactivePackages = initialPackages.filter((p) => !p.published)
  const visiblePackages =
    filter === "active" ? activePackages : filter === "inactive" ? inactivePackages : initialPackages

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-navy">Packages</h2>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-md bg-lime px-4 py-2 text-sm font-bold text-lime-foreground transition-colors hover:bg-lime/90"
        >
          <Plus className="h-4 w-4" />
          Add Package
        </button>
      </div>

      {/* Filter tabs */}
      <div className="mt-4 flex gap-1 rounded-lg border border-border bg-muted/40 p-1 w-fit">
        {(["active", "inactive", "all"] as const).map((f) => {
          const count = f === "active" ? activePackages.length : f === "inactive" ? inactivePackages.length : initialPackages.length
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-4 py-1.5 text-sm font-semibold transition-colors ${filter === f ? "bg-card text-navy shadow-sm" : "text-muted-foreground hover:text-navy"}`}
            >
              {f === "active" ? "Active" : f === "inactive" ? "Inactive" : "All"} ({count})
            </button>
          )
        })}
      </div>

      <div className="mt-4 grid gap-4">
        {visiblePackages.map((pkg) => (
          <article key={pkg.id} className={`rounded-card border bg-card p-5 shadow-sm ${!pkg.published ? "border-dashed border-muted-foreground/30 opacity-80" : "border-border"}`}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-bold text-navy">{pkg.name}</h3>
                  {pkg.published ? (
                    <span className="rounded-full bg-lime/20 border border-lime/40 px-2 py-0.5 text-xs font-bold text-lime-800">Active</span>
                  ) : (
                    <span className="rounded-full bg-muted border border-muted-foreground/20 px-2 py-0.5 text-xs font-semibold text-muted-foreground">Inactive</span>
                  )}
                  {pkg.popular && (
                    <span className="rounded-full bg-lime px-2 py-0.5 text-xs font-bold text-lime-foreground">Popular</span>
                  )}
                  <span className="rounded-full border border-border px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                    {pkg.slotType === "custom" ? "Custom slots" : "Standard slots"}
                  </span>
                  {pkg.clubIds.length > 0 && (
                    <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                      {pkg.clubIds.length} venue{pkg.clubIds.length !== 1 ? "s" : ""} only
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm font-semibold text-lime">
                  R{pkg.price.toLocaleString()}{" "}
                  <span className="font-normal text-muted-foreground">{periodLabel(pkg.period)}</span>
                </p>
                <p className="text-sm text-muted-foreground">{pkg.tagline}</p>
                {pkg.features.length > 0 && (
                  <div className="mt-2 space-y-0.5">
                    {pkg.features.map((item, idx) => (
                      <div key={idx}>
                        {item.type === "heading" ? (
                          <p className="text-sm font-semibold text-navy">{item.text}</p>
                        ) : (
                          <div className="flex items-start gap-2 text-sm text-navy">
                            <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-lime" />
                            {item.text}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {pkg.description && (
                  <p className="mt-2 text-sm text-muted-foreground">{pkg.description}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => openEdit(pkg)}
                  disabled={pending}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-navy transition-colors hover:bg-muted disabled:opacity-50"
                >
                  <Pencil className="h-4 w-4 text-lime" />
                  Edit
                </button>
                {pkg.published ? (
                  <button
                    onClick={() => setConfirmDeactivate({ id: pkg.id, name: pkg.name })}
                    disabled={pending}
                    className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-50"
                  >
                    <PowerOff className="h-4 w-4" />
                    Make Inactive
                  </button>
                ) : (
                  <button
                    onClick={() => setConfirmReactivate({ id: pkg.id, name: pkg.name })}
                    disabled={pending}
                    className="inline-flex items-center gap-1.5 rounded-md border border-lime/40 bg-lime/10 px-3 py-1.5 text-sm font-semibold text-lime-800 transition-colors hover:bg-lime/20 disabled:opacity-50"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Reactivate
                  </button>
                )}
              </div>
            </div>

            {/* Deactivate confirmation */}
            {confirmDeactivate?.id === pkg.id && (
              <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-800">
                  Make <strong>{pkg.name}</strong> Inactive? All active and pending enrollments on this package will also be made Inactive. No data will be deleted.
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => handleDeactivate(pkg.id)}
                    disabled={pending}
                    className="rounded-md bg-amber-600 px-4 py-1.5 text-sm font-bold text-white disabled:opacity-50 hover:bg-amber-700"
                  >
                    {pending ? "Saving…" : "Yes, make Inactive"}
                  </button>
                  <button
                    onClick={() => setConfirmDeactivate(null)}
                    className="rounded-md border border-border px-4 py-1.5 text-sm font-semibold text-navy hover:bg-muted"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Reactivate confirmation */}
            {confirmReactivate?.id === pkg.id && (
              <div className="mt-4 rounded-md border border-lime/30 bg-lime/5 p-4">
                <p className="text-sm font-semibold text-navy">
                  Reactivate <strong>{pkg.name}</strong>? The package will become available again for new registrations.
                </p>
                <label className="mt-3 flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={reactivateEnrollments}
                    onChange={(e) => setReactivateEnrollments(e.target.checked)}
                    className="h-4 w-4 accent-lime"
                  />
                  <span className="text-sm text-navy">Also reactivate all inactive enrollments on this package</span>
                </label>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => handleReactivate(pkg.id)}
                    disabled={pending}
                    className="rounded-md bg-lime px-4 py-1.5 text-sm font-bold text-lime-foreground disabled:opacity-50 hover:bg-lime/90"
                  >
                    {pending ? "Saving…" : "Yes, reactivate"}
                  </button>
                  <button
                    onClick={() => { setConfirmReactivate(null); setReactivateEnrollments(false) }}
                    className="rounded-md border border-border px-4 py-1.5 text-sm font-semibold text-navy hover:bg-muted"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </article>
        ))}

        {visiblePackages.length === 0 && (
          <p className="rounded-card border border-dashed border-border bg-card p-8 text-center text-muted-foreground">
            {filter === "inactive" ? "No inactive packages." : filter === "active" ? "No active packages yet. Click \"Add Package\" to create your first one." : "No packages yet."}
          </p>
        )}
      </div>

      {(creating || editing) && (
        <Modal
          title={editing ? `Edit ${editing.pkg.name}` : "Add New Package"}
          onClose={closeModal}
        >
          <PackageForm
            pkg={editing?.pkg ?? null}
            initialSlots={editing?.slots ?? []}
            allClubs={allClubs}
            allSchools={allSchools}
            pending={pending}
            onSubmit={handleSave}
            onCancel={closeModal}
          />
        </Modal>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Package form
// ---------------------------------------------------------------------------

// Key is "clubId-ageGroup-weekday-hour"
type SlotKey = `${number}-${string}-${number}-${number}`

function slotKey(clubId: number, ageGroup: string, weekday: number, hour: number): SlotKey {
  return `${clubId}-${ageGroup}-${weekday}-${hour}`
}

function PackageForm({
  pkg,
  initialSlots,
  allClubs,
  allSchools,
  pending,
  onSubmit,
  onCancel,
}: {
  pkg: PublicPackage | null
  initialSlots: CustomSlot[]
  allClubs: Club[]
  allSchools: School[]
  pending: boolean
  onSubmit: (input: PackageInput) => void
  onCancel: () => void
}) {
  const [slug, setSlug] = useState(pkg?.slug ?? "")
  const [name, setName] = useState(pkg?.name ?? "")
  const [price, setPrice] = useState(String(pkg?.price ?? 0))
  const [period, setPeriod] = useState(pkg?.period ?? "monthly")
  const [tagline, setTagline] = useState(pkg?.tagline ?? "")
  const [features, setFeatures] = useState<FeatureItem[]>(pkg?.features ?? [])
  const [description, setDescription] = useState(pkg?.description ?? "")
  const [popular, setPopular] = useState(pkg?.popular ?? false)
  const [published, setPublished] = useState(pkg?.published ?? true)
  const [isSchool, setIsSchool] = useState(pkg?.isSchool ?? false)
  const [slotType, setSlotType] = useState(pkg?.slotType ?? "standard")
  const [sortOrder, setSortOrder] = useState(String(pkg?.sortOrder ?? 0))
  const [activeAgeGroup, setActiveAgeGroup] = useState<AgeGroup>("4-8")
  // Club restrictions (only used when isSchool is false)
  const [selectedClubIds, setSelectedClubIds] = useState<number[]>(pkg?.clubIds ?? [])
  // School restrictions (only used when isSchool is true)
  const [selectedSchoolIds, setSelectedSchoolIds] = useState<number[]>(pkg?.schoolIds ?? [])
  // Which club's slot grid is currently visible (defaults to first selected club, or first available)
  const [activeSlotClubId, setActiveSlotClubId] = useState<number>(() => pkg?.clubIds?.[0] ?? allClubs.find((c) => c.published)?.id ?? 0)

  // Custom slots: map of "clubId-ageGroup-weekday-hour" -> capacity
  const [customSlots, setCustomSlots] = useState<Record<SlotKey, number>>(() => {
    const m: Record<SlotKey, number> = {}
    for (const s of initialSlots) {
      m[slotKey(s.clubId ?? 0, s.ageGroup, s.weekday, parseFloat(String(s.hour)))] = s.capacity
    }
    return m
  })

  // Ensure activeSlotClubId stays in sync when selectedClubIds changes
  function handleClubToggle(clubId: number, checked: boolean) {
    setSelectedClubIds((prev) => {
      const next = checked ? prev.filter((id) => id !== clubId) : [...prev, clubId]
      // Switch active slot club to a still-selected one
      if (checked && activeSlotClubId === clubId) {
        const remaining = next.filter((id) => id !== clubId)
        if (remaining.length > 0) setActiveSlotClubId(remaining[0])
      } else if (!checked) {
        setActiveSlotClubId(clubId)
      }
      return next
    })
  }

  function toggleSlot(clubId: number, ageGroup: string, weekday: number, hour: number) {
    const k = slotKey(clubId, ageGroup, weekday, hour)
    setCustomSlots((prev) => {
      const next = { ...prev }
      if (k in next) {
        delete next[k]
      } else {
        // School packages: enforce one slot per week — clear all others first
        if (isSchool) {
          for (const existingKey of Object.keys(next)) delete next[existingKey as SlotKey]
        }
        next[k] = 10
      }
      return next
    })
  }

  function setCapacity(clubId: number, ageGroup: string, weekday: number, hour: number, cap: number) {
    const k = slotKey(clubId, ageGroup, weekday, hour)
    setCustomSlots((prev) => ({ ...prev, [k]: Math.max(1, Math.round(cap)) }))
  }

  // Count slots active for current club + age group
  const activeCount = Object.keys(customSlots).filter(
    (k) => k.startsWith(`${activeSlotClubId}-${activeAgeGroup}-`)
  ).length
  const totalCount = Object.keys(customSlots).length

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const customSlotList = Object.entries(customSlots).map(([k, capacity]) => {
      // key format: "clubId-ageGroup-weekday-hour"
      // clubId is always a plain integer, ageGroup can contain "-" (e.g. "5-8")
      // Split from the right: last two segments are hour and weekday
      const parts = k.split("-")
      const hour = Number(parts[parts.length - 1])
      const weekday = Number(parts[parts.length - 2])
      // ageGroup is everything between clubId (index 0) and weekday
      const ag = parts.slice(1, parts.length - 2).join("-")
      const clubId = Number(parts[0])
      return { clubId, ageGroup: ag, weekday, hour, capacity }
    })
    onSubmit({
      slug,
      name,
      price: Math.max(0, Number(price)),
      period,
      tagline,
      features,
      description,
      popular,
      published,
      slotType,
      isSchool,
      sortOrder: Number(sortOrder),
      customSlots: slotType !== "custom" ? [] : customSlotList,
      clubIds: isSchool ? [] : selectedClubIds,
      schoolIds: isSchool ? selectedSchoolIds : [],
    })
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required>
          <input
            type="text"
            value={name}
            required
            onChange={(e) => setName(e.target.value)}
            className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 outline-none focus:border-lime"
          />
        </Field>
        <Field label="Slug (URL id)" required>
          <input
            type="text"
            value={slug}
            required
            placeholder="beginner"
            onChange={(e) => setSlug(e.target.value)}
            className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 outline-none focus:border-lime"
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Price (R)" required>
          <input
            type="number"
            min={0}
            value={price}
            required
            onChange={(e) => setPrice(e.target.value)}
            className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 outline-none focus:border-lime"
          />
        </Field>
        <Field label="Period">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 outline-none focus:border-lime"
          >
            <option value="monthly">Monthly</option>
            <option value="once-off">Once-off</option>
          </select>
        </Field>
      </div>

      <Field label="Tagline">
        <input
          type="text"
          value={tagline}
          onChange={(e) => setTagline(e.target.value)}
          className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 outline-none focus:border-lime"
        />
      </Field>

      <Field label="Features (add headings and bullets)">
        <div className="mt-2 space-y-2">
          {features.map((item, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <select
                value={item.type}
                onChange={(e) => {
                  const next = [...features]
                  next[idx] = { ...item, type: e.target.value as "heading" | "bullet" }
                  setFeatures(next)
                }}
                className="w-24 rounded-md border border-border bg-background px-2 py-2 text-sm outline-none focus:border-lime"
              >
                <option value="bullet">Bullet</option>
                <option value="heading">Heading</option>
              </select>
              <input
                type="text"
                value={item.text}
                onChange={(e) => {
                  const next = [...features]
                  next[idx] = { ...item, text: e.target.value }
                  setFeatures(next)
                }}
                placeholder={item.type === "heading" ? "Section title..." : "Bullet text..."}
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime"
              />
              <button
                type="button"
                onClick={() => setFeatures(features.filter((_, i) => i !== idx))}
                className="text-muted-foreground hover:text-red-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setFeatures([...features, { type: "bullet", text: "" }])}
            className="flex items-center gap-2 text-sm text-lime-foreground hover:text-lime"
          >
            <Plus className="h-4 w-4" /> Add Item
          </button>
        </div>
      </Field>

      <Field label="Additional description (free text — displayed below features)">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Add any extra detail, terms, or notes."
          className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime"
        />
      </Field>

      {/* School package toggle */}
      <div className={`flex items-center gap-3 rounded-md border px-4 py-3 ${isSchool ? "border-lime bg-lime/10" : "border-border bg-card"}`}>
        <input
          type="checkbox"
          id="isSchool"
          checked={isSchool}
          onChange={(e) => setIsSchool(e.target.checked)}
          className="h-5 w-5 accent-lime"
        />
        <label htmlFor="isSchool" className="cursor-pointer">
          <p className="text-sm font-semibold text-navy">School package</p>
          <p className="text-xs text-muted-foreground">
            {isSchool
              ? "This package is for schools — one coaching slot per week. Slot and coach settings apply."
              : "Tick this if the package is for schools, not clubs."}
          </p>
        </label>
      </div>

      {/* Slot type toggle — shown for all packages */}
      <Field label="Booking slot type">
        <div className="mt-2 flex gap-3">
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-4 py-2 has-[:checked]:border-lime has-[:checked]:bg-lime/10">
            <input
              type="radio"
              name="slotType"
              value="standard"
              checked={slotType === "standard"}
              onChange={() => setSlotType("standard")}
              className="accent-lime"
            />
            <span className="text-sm font-medium text-navy">Standard (school availability)</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-4 py-2 has-[:checked]:border-lime has-[:checked]:bg-lime/10">
            <input
              type="radio"
              name="slotType"
              value="custom"
              checked={slotType === "custom"}
              onChange={() => setSlotType("custom")}
              className="accent-lime"
            />
            <span className="text-sm font-medium text-navy">Custom (specific days &amp; times)</span>
          </label>
        </div>
        {isSchool && slotType === "custom" && (
          <p className="mt-2 text-xs text-amber-700 font-semibold">
            School packages allow one slot per week. Only one day &amp; time can be active at a time.
          </p>
        )}
      </Field>

      {/* Custom slots — tabbed by club (or direct grid for school packages), then by age group */}
      {slotType === "custom" && (
        <div className="rounded-lg border border-border bg-muted/30 p-4">
          {isSchool ? (
            <>
              <p className="mb-1 text-sm font-semibold text-navy">Set weekly coaching slot</p>
              <p className="mb-4 text-xs text-muted-foreground">
                Toggle one day &amp; time. School packages allow one slot per week — selecting a new slot automatically clears the previous one.
              </p>
            </>
          ) : (
            <>
              <p className="mb-1 text-sm font-semibold text-navy">Set available slots per venue per age group</p>
              <p className="mb-4 text-xs text-muted-foreground">
                Select a venue tab, then toggle days &amp; times for each age group. Each venue has its own independent slot grid and capacity numbers. Only venues selected above appear here.
              </p>
            </>
          )}

          {/* School packages: direct grid using virtual clubId=0, no venue tab needed */}
          {isSchool ? (
            <>
              {/* Slot grid — day x time, one selection at a time */}
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="px-3 py-2 text-left font-semibold text-navy">Time</th>
                      {WEEKDAYS.map((d) => (
                        <th key={d} className="px-3 py-2 text-center font-semibold text-navy">{d}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {SLOT_HOURS.map((hour) => (
                      <tr key={hour} className="border-b border-border last:border-0 odd:bg-muted/20">
                        <td className="whitespace-nowrap px-3 py-2 font-medium text-navy">
                          {formatHour(hour)} – {formatEndHour(hour)}
                        </td>
                        {WEEKDAYS.map((_, wd) => {
                          const k = slotKey(0, activeAgeGroup, wd, hour)
                          const isOn = k in customSlots
                          return (
                            <td key={wd} className="px-1.5 py-1.5 text-center">
                              <button
                                type="button"
                                onClick={() => toggleSlot(0, activeAgeGroup, wd, hour)}
                                className={isOn
                                  ? "rounded bg-lime px-2 py-0.5 text-xs font-bold text-lime-foreground"
                                  : "rounded border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:border-lime hover:text-navy"
                                }
                              >
                                {isOn ? "ON" : "+"}
                              </button>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {Object.keys(customSlots).length === 1
                  ? `1 slot selected — ${
                      Object.keys(customSlots).map((k) => {
                        const [,, wd, h] = k.split("-")
                        return `${WEEKDAYS[Number(wd)]} ${formatHour(Number(h))}`
                      })[0]
                    }`
                  : "No slot selected yet — click a cell to choose the weekly coaching time."}
              </p>
            </>
          ) : (
            /* Club packages: club tab bar + age group tabs + grid */
            <>
              {selectedClubIds.length === 0 ? (
                <p className="rounded-md border border-dashed border-border bg-card px-4 py-3 text-sm text-muted-foreground">
                  Select at least one venue above to configure per-venue slots.
                </p>
              ) : (
                <>
                  {/* Club tab bar */}
                  <div className="mb-3 flex flex-wrap gap-1 rounded-lg border border-border bg-muted p-1">
                    {allClubs.filter((c) => selectedClubIds.includes(c.id)).map((club) => {
                      const clubSlotCount = Object.keys(customSlots).filter((k) => k.startsWith(`${club.id}-`)).length
                      const isActive = activeSlotClubId === club.id
                      return (
                        <button
                          key={club.id}
                          type="button"
                          onClick={() => setActiveSlotClubId(club.id)}
                          className={`flex-1 rounded-md px-3 py-2 text-xs font-bold transition-colors ${
                            isActive ? "bg-navy text-navy-foreground shadow-sm" : "text-muted-foreground hover:text-navy"
                          }`}
                        >
                          {club.name}
                          {clubSlotCount > 0 && (
                            <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-black ${
                              isActive ? "bg-lime text-navy" : "bg-lime/30 text-navy"
                            }`}>
                              {clubSlotCount}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>

                  {/* Age group tab bar */}
                  <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
                    {AGE_GROUPS.map((ag) => {
                      const count = Object.keys(customSlots).filter((k) => k.startsWith(`${activeSlotClubId}-${ag}-`)).length
                      return (
                        <button
                          key={ag}
                          type="button"
                          onClick={() => setActiveAgeGroup(ag)}
                          className={`flex-1 rounded-md py-2 text-xs font-bold transition-colors ${
                            activeAgeGroup === ag ? "bg-lime text-lime-foreground shadow-sm" : "text-muted-foreground hover:text-navy"
                          }`}
                        >
                          {AGE_GROUP_LABELS[ag]}
                          {count > 0 && (
                            <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-black ${
                              activeAgeGroup === ag ? "bg-navy text-white" : "bg-lime/30 text-navy"
                            }`}>
                              {count}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>

                  {/* Slot grid */}
                  <div className="mt-3 overflow-x-auto rounded-md border border-border">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="border-b border-border bg-muted/50">
                          <th className="px-3 py-2 text-left font-semibold text-navy">Time</th>
                          {WEEKDAYS.map((d) => (
                            <th key={d} className="px-3 py-2 text-center font-semibold text-navy">{d}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {SLOT_HOURS.map((hour) => (
                          <tr key={hour} className="border-b border-border last:border-0 odd:bg-muted/20">
                            <td className="whitespace-nowrap px-3 py-2 font-medium text-navy">
                              {formatHour(hour)} – {formatEndHour(hour)}
                            </td>
                            {WEEKDAYS.map((_, wd) => {
                              const k = slotKey(activeSlotClubId, activeAgeGroup, wd, hour)
                              const isOn = k in customSlots
                              const cap = customSlots[k] ?? 10
                              return (
                                <td key={wd} className="px-1.5 py-1.5 text-center">
                                  {isOn ? (
                                    <div className="flex flex-col items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => toggleSlot(activeSlotClubId, activeAgeGroup, wd, hour)}
                                        className="rounded bg-lime px-2 py-0.5 text-xs font-bold text-lime-foreground"
                                      >
                                        ON
                                      </button>
                                      <input
                                        type="number"
                                        min={1}
                                        max={99}
                                        value={cap}
                                        onChange={(e) => setCapacity(activeSlotClubId, activeAgeGroup, wd, hour, Number(e.target.value))}
                                        aria-label={`Capacity for ${WEEKDAYS[wd]} ${formatHour(hour)} (${activeAgeGroup}) at club ${activeSlotClubId}`}
                                        className="w-12 rounded border border-border bg-background px-1 py-0.5 text-center text-xs outline-none focus:border-lime"
                                      />
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => toggleSlot(activeSlotClubId, activeAgeGroup, wd, hour)}
                                      className="rounded border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:border-lime hover:text-navy"
                                    >
                                      +
                                    </button>
                                  )}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {activeCount} slot{activeCount !== 1 ? "s" : ""} for {AGE_GROUP_LABELS[activeAgeGroup]} at this venue
                    {" · "}
                    {totalCount} total across all venues &amp; age groups
                  </p>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* School package: school selector only */}
      {isSchool && (
        <Field label="Available at schools (leave blank for all schools)">
          <p className="mb-3 mt-1 text-xs text-muted-foreground">
            Select the schools where this package is available. If nothing is selected, it will appear for every school.
          </p>
          {allSchools.length === 0 ? (
            <p className="rounded-md border border-dashed border-border bg-card px-4 py-3 text-sm text-muted-foreground">
              No schools configured yet. Add schools in the Schools tab first.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {allSchools.map((school) => {
                const checked = selectedSchoolIds.includes(school.id)
                return (
                  <label
                    key={school.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors ${
                      checked ? "border-lime bg-lime/10" : "border-border bg-card hover:border-lime/50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setSelectedSchoolIds((prev) =>
                          checked ? prev.filter((id) => id !== school.id) : [...prev, school.id]
                        )
                      }
                      className="h-4 w-4 accent-lime"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-navy">{school.name}</p>
                      {school.location && (
                        <p className="truncate text-xs text-muted-foreground">{school.location}</p>
                      )}
                    </div>
                  </label>
                )
              })}
            </div>
          )}
          {selectedSchoolIds.length > 0 && (
            <p className="mt-2 text-xs font-semibold text-amber-700">
              Restricted to {selectedSchoolIds.length} school{selectedSchoolIds.length !== 1 ? "s" : ""}.
            </p>
          )}
        </Field>
      )}

      {/* Club restrictions — only shown for non-school packages */}
      {!isSchool && allClubs.length > 0 && (
        <Field label="Available at (leave blank for all venues)">
          <p className="mb-3 mt-1 text-xs text-muted-foreground">
            Select specific clubs/venues where this package can be booked. If nothing is selected, it will appear at every venue.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {allClubs.filter((c) => c.published).map((club) => {
              const checked = selectedClubIds.includes(club.id)
              return (
                <label
                  key={club.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors ${
                    checked ? "border-lime bg-lime/10" : "border-border bg-card hover:border-lime/50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => handleClubToggle(club.id, checked)}
                    className="h-4 w-4 accent-lime"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-navy">{club.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{club.location}</p>
                  </div>
                </label>
              )
            })}
          </div>
          {selectedClubIds.length > 0 && (
            <p className="mt-2 text-xs font-semibold text-amber-700">
              Restricted to {selectedClubIds.length} venue{selectedClubIds.length !== 1 ? "s" : ""}.
              Customers signing up for other clubs will not see this package.
            </p>
          )}
        </Field>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Sort order">          <input
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 outline-none focus:border-lime"
          />
        </Field>
        <label className="flex items-center gap-2 pt-7">
          <input
            type="checkbox"
            checked={popular}
            onChange={(e) => setPopular(e.target.checked)}
            className="h-5 w-5 accent-lime"
          />
          <span className="text-sm font-medium text-navy">Most popular</span>
        </label>
        <label className="flex items-center gap-2 pt-7">
          <input
            type="checkbox"
            checked={published}
            onChange={(e) => setPublished(e.target.checked)}
            className="h-5 w-5 accent-lime"
          />
          <span className="text-sm font-medium text-navy">Published</span>
        </label>

      </div>

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-navy hover:bg-muted"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-lime px-5 py-2 text-sm font-bold text-lime-foreground hover:bg-lime/90 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save Package"}
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Field({
  label,
  children,
  required,
}: {
  label: string
  children: React.ReactNode
  required?: boolean
}) {
  return (
    <div>
      <span className="block text-sm font-semibold text-navy">
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </span>
      {children}
    </div>
  )
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string
  children: React.ReactNode
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-10">
      <div className="w-full max-w-3xl rounded-xl bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-bold text-navy">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-navy"
          >
            ✕
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  )
}

