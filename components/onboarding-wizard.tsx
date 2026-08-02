"use client"

import Image from "next/image"
import Link from "next/link"
import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Check, ChevronRight, Tag, X } from "lucide-react"
import { formatSlot } from "@/lib/slots"
import type { Club, School } from "@/lib/db/schema"
import type { AgeGroup } from "@/lib/db/schema"
import type { PublicPackage } from "@/app/actions/packages"
import { SlotPicker, type SelectedSlot } from "@/components/slot-picker"
import { PackageSlotPicker } from "@/components/package-slot-picker"
import { DobPicker } from "@/components/dob-picker"
import { SignaturePad } from "@/components/signature-pad"
import { CONSENT_TERMS_LABEL, CONSENT_MEDIA_LABEL, TERMS_TITLE, TERMS_SECTIONS } from "@/lib/terms"
import { authClient } from "@/lib/auth-client"
import { createCartEnrollments } from "@/app/actions/enrollment"
import type { CartItem } from "@/app/actions/enrollment"
import { blobUrl } from "@/lib/blob"
import { validateVoucherCode } from "@/app/actions/referrals"

// ---------------------------------------------------------------------------
// Step labels
// ---------------------------------------------------------------------------
const CLUB_STEPS   = ["Children", "Child Details", "Club & Schedule", "Parent Account", "Preferences", "Review"]
const SCHOOL_STEPS = ["Children", "Child Details", "School", "Parent Account", "Preferences", "Review"]

type Prefs = {
  prefEmail: boolean
  prefWhatsapp: boolean
  prefSessionReminders: boolean
  prefAnnouncements: boolean
  prefEvents: boolean
  prefHolidayClinics: boolean
}

// Per-child selection state held in the wizard before building CartItems
type ChildSchedule = {
  clubId: number | null
  schoolId: number | null
  ageGroup: AgeGroup | null
  slot: SelectedSlot | null
  slot2: SelectedSlot | null   // Advanced second session
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function OnboardingWizard({
  clubs,
  packages,
  schools,
}: {
  clubs: Club[]
  packages: PublicPackage[]
  schools: School[]
}) {
  useRouter()
  const searchParams = useSearchParams()
  const initialPackage = packages.find((p) => p.slug === searchParams.get("package")) ?? null
  const initialRefCode = searchParams.get("ref") ?? null

  const [selectedPackage, setSelectedPackage] = useState<PublicPackage | null>(initialPackage)
  const [step, setStep] = useState(0)

  const isOnceOff     = selectedPackage?.period === "once-off"
  const isAdvanced    = selectedPackage?.slug === "advanced"
  const isSchoolPkg   =
    selectedPackage?.isSchool === true ||
    (selectedPackage?.slug?.toLowerCase().includes("school") ?? false)
  const STEPS = isSchoolPkg ? SCHOOL_STEPS : CLUB_STEPS

  const availableClubs =
    selectedPackage && selectedPackage.clubIds.length > 0
      ? clubs.filter((c) => selectedPackage.clubIds.includes(c.id))
      : clubs

  // ── Step 0: How many children ───────────────────────────────────────────
  const [childCount, setChildCount] = useState<number>(1)

  // ── Step 1: Child details ────────────────────────────────────────────────
  const [children, setChildren] = useState<Array<{ firstName: string; lastName: string; dob: string }>>(
    [{ firstName: "", lastName: "", dob: "" }],
  )

  // ── Step 2: Per-child club/school + schedule ─────────────────────────────
  // One ChildSchedule per child — indexed by child position.
  const [schedules, setSchedules] = useState<ChildSchedule[]>(
    [{ clubId: null, schoolId: null, ageGroup: null, slot: null, slot2: null }],
  )
  // Which child is currently being configured in step 2
  const [scheduleChildIdx, setScheduleChildIdx] = useState(0)

  function currentSchedule(): ChildSchedule {
    return schedules[scheduleChildIdx] ?? { clubId: null, schoolId: null, ageGroup: null, slot: null, slot2: null }
  }

  function updateSchedule(idx: number, patch: Partial<ChildSchedule>) {
    setSchedules((prev) => {
      const next = [...prev]
      next[idx] = { ...(next[idx] ?? { clubId: null, schoolId: null, ageGroup: null, slot: null, slot2: null }), ...patch }
      return next
    })
  }

  // Whether all children have complete schedules
  function schedulesComplete(): boolean {
    return Array.from({ length: childCount }, (_, i) => i).every((i) => {
      const s = schedules[i]
      if (!s) return false
      if (isSchoolPkg) return !!s.schoolId
      return !!s.clubId && !!s.slot && !!s.ageGroup && (!isAdvanced || !!s.slot2)
    })
  }

  // ── Steps 3-5 ────────────────────────────────────────────────────────────
  const [parent, setParent] = useState({ firstName: "", lastName: "", email: "", mobile: "", password: "" })
  const [emergency, setEmergency] = useState({ name: "", phone: "" })
  const [prefs, setPrefs] = useState<Prefs>({
    prefEmail: true,
    prefWhatsapp: false,
    prefSessionReminders: true,
    prefAnnouncements: true,
    prefEvents: false,
    prefHolidayClinics: false,
  })

  // Voucher / referral
  const [voucherInput, setVoucherInput] = useState("")
  const [voucherValidating, setVoucherValidating] = useState(false)
  const [voucherError, setVoucherError] = useState<string | null>(null)
  const [appliedVoucher, setAppliedVoucher] = useState<{
    id: number; code: string; discountPercent: number; campaignName: string
  } | null>(null)

  // Terms, consent & signature
  const [agreedTerms, setAgreedTerms] = useState(false)
  const [consentMedia, setConsentMedia] = useState(false)
  const [signatureData, setSignatureData] = useState<string | null>(null)
  const [showTerms, setShowTerms] = useState(false)

  // Submit state
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [netcashUnavailable, setNetcashUnavailable] = useState(false)
  const [confirmedRef, setConfirmedRef] = useState<string | null>(null)

  // ── Package not yet selected ─────────────────────────────────────────────
  if (!selectedPackage) {
    return (
      <PackagePicker
        packages={packages}
        onSelect={(pkg) => {
          setSelectedPackage(pkg)
          if (pkg.clubIds.length > 0) {
            setSchedules((prev) =>
              prev.map((s) =>
                s.clubId && !pkg.clubIds.includes(s.clubId)
                  ? { ...s, clubId: null, slot: null, slot2: null }
                  : s,
              ),
            )
          }
        }}
      />
    )
  }

  // ── Confirmation screen ───────────────────────────────────────────────────
  if (confirmedRef) {
    return (
      <Confirmation
        packageName={selectedPackage.name}
        reference={confirmedRef}
        isEft={false}
        childNames={children.map((c) => `${c.firstName} ${c.lastName}`.trim())}
        packagePrice={computeTotal()}
      />
    )
  }

  // ---------------------------------------------------------------------------
  // Cart total
  // ---------------------------------------------------------------------------
  function computeTotal(): number {
    const disc = appliedVoucher?.discountPercent ?? 0
    const base = (selectedPackage?.price ?? 0) * childCount
    return disc > 0 ? base * (1 - disc / 100) : base
  }

  // ---------------------------------------------------------------------------
  // handleSubmit
  // ---------------------------------------------------------------------------
  async function handleSubmit() {
    if (!selectedPackage) return
    setError(null)
    setNetcashUnavailable(false)
    setSubmitting(true)

    let redirectingToNetcash = false

    try {
      // 1. Auth — sign up or sign in
      const { error: signUpError } = await authClient.signUp.email({
        email: parent.email,
        password: parent.password,
        name: `${parent.firstName} ${parent.lastName}`.trim(),
      })
      if (signUpError) {
        const isExisting =
          signUpError.code === "USER_ALREADY_EXISTS" ||
          (signUpError.message ?? "").toLowerCase().includes("already exists")
        if (isExisting) {
          const { error: signInError } = await authClient.signIn.email({
            email: parent.email,
            password: parent.password,
          })
          if (signInError) {
            setError("An account with this email already exists. Please sign in from the dashboard instead.")
            return
          }
        } else {
          setError(signUpError.message ?? "Could not create your account.")
          return
        }
      }

      // 2. Build CartItems — one per child
      const cartItems: CartItem[] = children.map((child, idx) => {
        const sched = schedules[idx] ?? { clubId: null, schoolId: null, ageGroup: null, slot: null, slot2: null }
        const clubObj = clubs.find((c) => c.id === sched.clubId) ?? null
        const schoolObj = schools.find((s) => s.id === sched.schoolId) ?? null
        return {
          child: { firstName: child.firstName, lastName: child.lastName, dob: child.dob },
          packageId: selectedPackage.id,
          packageName: selectedPackage.name,
          packagePrice: selectedPackage.price,
          packagePeriod: selectedPackage.period,
          clubId: isSchoolPkg ? null : (sched.clubId ?? null),
          clubName: isSchoolPkg ? (schoolObj?.name ?? "") : (clubObj?.name ?? ""),
          schoolId: isSchoolPkg ? (sched.schoolId ?? null) : null,
          schoolName: isSchoolPkg ? (schoolObj?.name ?? null) : null,
          slotWeekday: isSchoolPkg ? null : (sched.slot?.weekday ?? null),
          slotHour: isSchoolPkg ? null : (sched.slot?.hour ?? null),
          ageGroup: isSchoolPkg ? null : (sched.ageGroup ?? null),
        }
      })

      // 3. Create all enrollment records + order row in one server action
      const { orderReference, totalAmount } = await createCartEnrollments({
        parent: {
          firstName: parent.firstName,
          lastName: parent.lastName,
          email: parent.email,
          mobile: parent.mobile,
        },
        cartItems,
        prefs,
        emergencyContactName: emergency.name,
        emergencyContactPhone: emergency.phone,
        agreedTerms,
        consentMedia,
        signatureData,
        signedName: `${parent.firstName} ${parent.lastName}`.trim(),
        referralCode: initialRefCode ?? null,
        voucherId: appliedVoucher?.id ?? null,
        discountPercent: appliedVoucher?.discountPercent ?? undefined,
      })

      // 4. Build Netcash cart payment via API route
      const payResponse = await fetch("/api/netcash/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderReference,
          totalAmount,
          childCount,
          parentName: `${parent.firstName} ${parent.lastName}`.trim(),
          parentEmail: parent.email,
          paymentType: isOnceOff ? "once-off" : "monthly",
        }),
      })

      if (!payResponse.ok) {
        const body = await payResponse.json().catch(() => ({}))
        const msg: string = (body as { error?: string })?.error ?? `Payment gateway error (${payResponse.status})`
        setNetcashUnavailable(true)
        return
      }

      const { netcashUrl, formFields } = (await payResponse.json()) as {
        netcashUrl: string
        formFields: Record<string, string>
      }

      if (!netcashUrl || !formFields) {
        setNetcashUnavailable(true)
        return
      }

      // 5. POST to Netcash via a hidden form
      redirectingToNetcash = true
      const form = document.createElement("form")
      form.method = "POST"
      form.action = netcashUrl
      form.style.display = "none"
      Object.entries(formFields).forEach(([key, value]) => {
        const inp = document.createElement("input")
        inp.type = "hidden"
        inp.name = key
        inp.value = String(value)
        form.appendChild(inp)
      })
      document.body.appendChild(form)
      form.submit()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.")
    } finally {
      if (!redirectingToNetcash) {
        setSubmitting(false)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <section className="mx-auto max-w-3xl px-4 py-12">
      {/* Package banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-card p-4 shadow-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Selected Package</p>
          <p className="font-bold text-navy">
            {selectedPackage.name} — R{selectedPackage.price.toLocaleString()}
            {isOnceOff ? " (once off)" : "/month"} per child
            {childCount > 1 && (
              <span className="ml-2 text-lime-foreground">
                = R{computeTotal().toLocaleString()} total
                {!isOnceOff ? "/month" : ""}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => { setSelectedPackage(null); setStep(0) }}
          className="rounded-2xl border border-border px-4 py-2 text-sm font-bold text-navy transition-colors hover:bg-muted"
        >
          Change Package
        </button>
      </div>

      {/* Stepper */}
      <ol className="mt-8 flex items-center justify-between gap-1">
        {STEPS.map((label, i) => (
          <li key={label} className="flex flex-1 flex-col items-center text-center">
            <span
              className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${
                i <= step ? "bg-lime text-lime-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              {i + 1}
            </span>
            <span className={`mt-2 hidden text-xs font-semibold sm:block ${i <= step ? "text-navy" : "text-muted-foreground"}`}>
              {label}
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-10">{renderStep()}</div>

      <div className="relative mx-auto mt-12 aspect-[3/4] w-full max-w-xs overflow-hidden">
        <Image src="/images/mascots.png" alt="Next Gen Padel Academy Mascots" fill className="object-contain" />
      </div>
    </section>
  )

  // ---------------------------------------------------------------------------
  // renderStep
  // ---------------------------------------------------------------------------
  function renderStep() {
    // ── Step 0: How many children ──────────────────────────────���────────────
    if (step === 0)
      return (
        <div>
          <h2 className="text-xl font-bold text-navy">How many children are you enrolling?</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            You can enroll up to 5 children in one go. Each child picks their own club and schedule.
          </p>
          <div className="mt-6 grid grid-cols-5 gap-3">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  setChildCount(n)
                  setChildren((prev) => {
                    const updated = [...prev]
                    while (updated.length < n) updated.push({ firstName: "", lastName: "", dob: "" })
                    return updated.slice(0, n)
                  })
                  setSchedules((prev) => {
                    const updated = [...prev]
                    while (updated.length < n)
                      updated.push({ clubId: null, schoolId: null, ageGroup: null, slot: null, slot2: null })
                    return updated.slice(0, n)
                  })
                }}
                className={`flex flex-col items-center justify-center rounded-2xl border-2 py-5 font-black text-3xl transition-all ${
                  childCount === n
                    ? "scale-105 border-lime bg-lime/10 text-navy shadow-md"
                    : "border-border bg-card text-muted-foreground hover:border-lime/50"
                }`}
              >
                {n}
                <span className="mt-1 text-xs font-semibold">{n === 1 ? "child" : "children"}</span>
              </button>
            ))}
          </div>
          <StepNav onNext={() => setStep(1)} />
        </div>
      )

    // ── Step 1: Child details ────────────────────────────────────────────────
    if (step === 1)
      return (
        <div>
          <h2 className="text-xl font-bold text-navy">
            {childCount === 1 ? "Your Child's Details" : "Children's Details"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {childCount === 1
              ? "Tell us who will be joining the academy"
              : `Tell us about all ${childCount} children joining the academy`}
          </p>
          <div className="mt-6 space-y-6">
            {children.map((child, idx) => (
              <div key={idx} className="rounded-card border border-border bg-card p-5 shadow-sm">
                {childCount > 1 && (
                  <p className="mb-4 text-sm font-black text-navy">Child {idx + 1}</p>
                )}
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label={childCount > 1 ? `Child ${idx + 1} First Name` : "Child's First Name"}
                      value={child.firstName}
                      onChange={(v) =>
                        setChildren((prev) => prev.map((c, i) => (i === idx ? { ...c, firstName: v } : c)))
                      }
                      placeholder="First name"
                    />
                    <Field
                      label="Last Name / Surname"
                      value={child.lastName}
                      onChange={(v) =>
                        setChildren((prev) => prev.map((c, i) => (i === idx ? { ...c, lastName: v } : c)))
                      }
                      placeholder="Last name"
                    />
                  </div>
                  <div>
                    <p className="mb-2 text-sm font-semibold text-navy">Date of Birth</p>
                    <DobPicker
                      value={child.dob}
                      onChange={(v) =>
                        setChildren((prev) => prev.map((c, i) => (i === idx ? { ...c, dob: v } : c)))
                      }
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <StepNav
            onBack={() => setStep(0)}
            onNext={() => { setScheduleChildIdx(0); setStep(2) }}
            nextDisabled={children.some((c) => !c.firstName || !c.lastName || !c.dob)}
          />
        </div>
      )

    // ── Step 2: Per-child club / school + schedule ───────────────────────────
    if (step === 2) {
      const sched = currentSchedule()
      const childName = `${children[scheduleChildIdx]?.firstName ?? "Child"}`.trim()
      const selectedClubObj = availableClubs.find((c) => c.id === sched.clubId) ?? null
      const selectedSchoolObj = schools.find((s) => s.id === sched.schoolId) ?? null

      // Can we advance to the next child / finish step 2?
      const thisChildDone = isSchoolPkg
        ? !!sched.schoolId
        : !!sched.clubId && !!sched.slot && !!sched.ageGroup && (!isAdvanced || !!sched.slot2)

      const isLastChild = scheduleChildIdx === childCount - 1

      function advanceScheduleStep() {
        if (!isLastChild) {
          setScheduleChildIdx((i) => i + 1)
        } else {
          setStep(3)
        }
      }

      return (
        <div>
          {/* Child tabs — when multiple children */}
          {childCount > 1 && (
            <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
              {Array.from({ length: childCount }, (_, i) => {
                const s = schedules[i]
                const done = isSchoolPkg
                  ? !!s?.schoolId
                  : !!s?.clubId && !!s?.slot && !!s?.ageGroup && (!isAdvanced || !!s?.slot2)
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setScheduleChildIdx(i)}
                    className={`flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors ${
                      i === scheduleChildIdx
                        ? "border-navy bg-navy text-white"
                        : done
                          ? "border-lime bg-lime/10 text-navy"
                          : "border-border bg-card text-muted-foreground"
                    }`}
                  >
                    {done && i !== scheduleChildIdx && <Check className="h-3 w-3" />}
                    {children[i]?.firstName || `Child ${i + 1}`}
                  </button>
                )
              })}
            </div>
          )}

          {isSchoolPkg ? (
            <>
              <h2 className="text-xl font-bold text-navy">
                {childCount > 1 ? `${childName}'s School` : "Select Your School"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Choose the school where{" "}
                {childCount > 1 ? childName : "your child"} will attend Next Gen Padel lessons.
              </p>
              <div className="mt-6">
                <label htmlFor="school-select" className="mb-2 block text-sm font-semibold text-navy">
                  School
                </label>
                {schools.length === 0 ? (
                  <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
                    No schools are listed yet.{" "}
                    <a href="/contact" className="underline">Contact us</a>.
                  </p>
                ) : (
                  <select
                    id="school-select"
                    value={sched.schoolId ?? ""}
                    onChange={(e) =>
                      updateSchedule(scheduleChildIdx, {
                        schoolId: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                    className="w-full rounded-2xl border-2 border-border bg-card px-4 py-3 text-sm font-semibold text-navy shadow-sm transition-colors focus:border-lime focus:outline-none"
                  >
                    <option value="">— Select a school —</option>
                    {schools.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}{s.location ? ` — ${s.location}` : ""}
                      </option>
                    ))}
                  </select>
                )}
                {sched.schoolId && selectedSchoolObj && (
                  <div className="mt-4 flex items-center gap-3 rounded-2xl border-2 border-lime bg-lime/10 px-4 py-3">
                    {selectedSchoolObj.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={blobUrl(selectedSchoolObj.logoUrl) ?? selectedSchoolObj.logoUrl}
                        alt={selectedSchoolObj.name}
                        className="h-10 w-10 shrink-0 rounded-full border border-border bg-white object-contain p-0.5"
                      />
                    ) : (
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy/10 text-sm font-black text-navy">
                        {selectedSchoolObj.name[0]?.toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-black text-navy">{selectedSchoolObj.name}</p>
                      {selectedSchoolObj.location && (
                        <p className="text-xs text-muted-foreground">{selectedSchoolObj.location}</p>
                      )}
                    </div>
                    <Check className="h-5 w-5 shrink-0 text-lime-foreground" />
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <h2 className="text-xl font-bold text-navy">
                {childCount > 1 ? `${childName}'s Club & Schedule` : "Choose Your Club & Schedule"}
              </h2>
              {sched.ageGroup && (
                <p className="mt-1 text-sm text-muted-foreground">
                  Showing slots for ages{" "}
                  <span className="font-semibold text-navy">{sched.ageGroup}</span>
                </p>
              )}
              {availableClubs.length < clubs.length && (
                <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
                  The <strong>{selectedPackage!.name}</strong> package is only available at{" "}
                  {availableClubs.length === 1 ? "the venue below" : "the venues below"}.
                </p>
              )}

              {/* Age category */}
              <div className="mt-5">
                <p className="text-sm font-semibold text-navy">Age Category</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  This determines which time slots are available.
                </p>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  {(["4-8", "9-13", "14-17"] as const).map((ag) => (
                    <button
                      key={ag}
                      type="button"
                      onClick={() => updateSchedule(scheduleChildIdx, { ageGroup: ag, slot: null, slot2: null })}
                      className={`rounded-2xl border-2 p-4 text-center transition-all ${
                        sched.ageGroup === ag
                          ? "scale-105 border-lime bg-lime/10 shadow-md"
                          : "border-border bg-card hover:border-lime/50"
                      }`}
                    >
                      <span className="block text-2xl font-black text-navy">{ag}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">years old</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Club selection */}
              <div className="mt-5 space-y-3">
                {availableClubs.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() =>
                      updateSchedule(scheduleChildIdx, { clubId: c.id, slot: null, slot2: null })
                    }
                    className={`w-full rounded-card border p-4 text-left transition-colors ${
                      sched.clubId === c.id
                        ? "border-lime bg-lime/10"
                        : "border-border bg-card hover:border-lime/50"
                    }`}
                  >
                    <h3 className="font-bold text-navy">{c.name}</h3>
                    <p className="text-sm text-muted-foreground">{c.location}</p>
                  </button>
                ))}
              </div>

              {/* Time slots */}
              {sched.clubId && sched.ageGroup && (
                <div className="mt-6">
                  <p className="block text-sm font-semibold text-navy">Available Time Slots</p>
                  {selectedPackage!.slotType === "custom" ? (
                    <>
                      {isAdvanced ? (
                        <p className="mb-3 text-xs text-muted-foreground">
                          Select two coaching sessions on <strong>different days</strong> (2 sessions per week).
                        </p>
                      ) : (
                        <p className="mb-3 text-xs text-muted-foreground">
                          This package runs at fixed times. Pick a slot below.
                        </p>
                      )}
                      {isAdvanced && (
                        <p className="mb-2 text-sm font-semibold text-navy">First Coaching Session</p>
                      )}
                      <PackageSlotPicker
                        packageId={selectedPackage!.id}
                        packageName={selectedPackage!.name}
                        ageGroup={sched.ageGroup}
                        clubId={sched.clubId}
                        selected={sched.slot}
                        onSelect={(s) =>
                          updateSchedule(scheduleChildIdx, { slot: s, slot2: null })
                        }
                      />
                      {isAdvanced && (
                        <div className="mt-6">
                          <div className="mb-2 flex items-center gap-2">
                            <p className="text-sm font-semibold text-navy">Second Coaching Session</p>
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                              Different day required
                            </span>
                          </div>
                          <PackageSlotPicker
                            packageId={selectedPackage!.id}
                            packageName={selectedPackage!.name}
                            ageGroup={sched.ageGroup}
                            clubId={sched.clubId}
                            selected={sched.slot2}
                            disabledWeekday={sched.slot?.weekday}
                            onSelect={(s) => updateSchedule(scheduleChildIdx, { slot2: s })}
                          />
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="mb-3 text-xs text-muted-foreground">
                        Only times with open places for ages {sched.ageGroup} are shown.
                      </p>
                      <SlotPicker
                        clubId={sched.clubId}
                        ageGroup={sched.ageGroup}
                        selected={sched.slot}
                        onSelect={(s) => updateSchedule(scheduleChildIdx, { slot: s })}
                      />
                    </>
                  )}
                </div>
              )}
            </>
          )}

          <div className="mt-8 flex items-center justify-between gap-4">
            <button
              onClick={() => {
                if (scheduleChildIdx > 0) {
                  setScheduleChildIdx((i) => i - 1)
                } else {
                  setStep(1)
                }
              }}
              className="rounded-2xl border-2 border-border px-5 py-3 font-bold text-navy transition-all hover:bg-muted active:scale-95"
            >
              Back
            </button>
            <button
              disabled={!thisChildDone}
              onClick={advanceScheduleStep}
              className="rounded-2xl bg-lime px-6 py-3 font-black text-lime-foreground shadow-sm transition-all hover:scale-105 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40 active:scale-95"
            >
              {isLastChild
                ? schedulesComplete()
                  ? "Continue"
                  : "Continue"
                : `Next: ${children[scheduleChildIdx + 1]?.firstName || `Child ${scheduleChildIdx + 2}`}`}
            </button>
          </div>

          {/* Mini progress for multi-child */}
          {childCount > 1 && (
            <p className="mt-3 text-center text-xs text-muted-foreground">
              {scheduleChildIdx + 1} of {childCount} children configured
            </p>
          )}
        </div>
      )
    }

    // ── Step 3: Parent account ───────────────────────────────────────────────
    if (step === 3)
      return (
        <div>
          <h2 className="text-xl font-bold text-navy">Parent / Guardian Account</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            We&apos;ll create your account so you can track sessions and manage your enrollment.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <Field
              label="First Name"
              value={parent.firstName}
              onChange={(v) => setParent({ ...parent, firstName: v })}
              placeholder="First name"
            />
            <Field
              label="Last Name / Surname"
              value={parent.lastName}
              onChange={(v) => setParent({ ...parent, lastName: v })}
              placeholder="Last name"
            />
            <div className="flex flex-col gap-1">
              <Field
                label="Mobile Number"
                type="tel"
                value={parent.mobile}
                onChange={(v) => setParent({ ...parent, mobile: v.replace(/[^\d]/g, "") })}
                placeholder="0812345678"
              />
              <p className="text-xs text-muted-foreground">
                South African number — start with 0, no spaces or +27. e.g. 0812345678
              </p>
              {parent.mobile.length > 0 && !/^0\d{9}$/.test(parent.mobile) && (
                <p className="text-xs font-semibold text-destructive">
                  {!parent.mobile.startsWith("0")
                    ? "Must start with 0 — e.g. 0812345678"
                    : `Must be exactly 10 digits (${parent.mobile.length}/10)`}
                </p>
              )}
              {/^0\d{9}$/.test(parent.mobile) && (
                <p className="text-xs font-semibold text-lime-600">Looks good</p>
              )}
            </div>
            <Field
              label="Email"
              type="email"
              value={parent.email}
              onChange={(v) => setParent({ ...parent, email: v })}
            />
            <div className="space-y-1">
              <Field
                label="Password"
                type="password"
                value={parent.password}
                onChange={(v) => setParent({ ...parent, password: v })}
                placeholder="At least 8 characters"
              />
              {parent.password.length > 0 && parent.password.length < 8 && (
                <p className="text-xs font-semibold text-destructive">
                  Password is too short — must be at least 8 characters ({parent.password.length}/8)
                </p>
              )}
              {parent.password.length >= 8 && (
                <p className="text-xs font-semibold text-lime-600">Password looks good</p>
              )}
            </div>
          </div>
          <div className="mt-6 rounded-card border border-border bg-muted/40 p-4">
            <p className="text-sm font-semibold text-navy">Emergency Contact</p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field
                label="Contact Name"
                value={emergency.name}
                onChange={(v) => setEmergency({ ...emergency, name: v })}
              />
              <Field
                label="Contact Phone"
                type="tel"
                value={emergency.phone}
                onChange={(v) => setEmergency({ ...emergency, phone: v })}
              />
            </div>
          </div>
          <StepNav
            onBack={() => setStep(2)}
            onNext={() => setStep(4)}
            nextDisabled={
              !parent.firstName ||
              !parent.lastName ||
              !parent.email ||
              !/^0\d{9}$/.test(parent.mobile) ||
              parent.password.length < 8 ||
              !emergency.name ||
              !emergency.phone
            }
          />
        </div>
      )

    // ── Step 4: Communication preferences ───────────────────────────────────
    if (step === 4)
      return (
        <div>
          <h2 className="text-xl font-bold text-navy">Communication Preferences</h2>
          <p className="mt-1 text-sm text-muted-foreground">Choose how you&apos;d like to hear from us</p>
          <div className="mt-6 space-y-2">
            <PrefToggle label="Email updates" checked={prefs.prefEmail} onChange={(v) => setPrefs({ ...prefs, prefEmail: v })} />
            <PrefToggle label="WhatsApp messages" checked={prefs.prefWhatsapp} onChange={(v) => setPrefs({ ...prefs, prefWhatsapp: v })} />
            <PrefToggle label="Session reminders" checked={prefs.prefSessionReminders} onChange={(v) => setPrefs({ ...prefs, prefSessionReminders: v })} />
            <PrefToggle label="Academy announcements" checked={prefs.prefAnnouncements} onChange={(v) => setPrefs({ ...prefs, prefAnnouncements: v })} />
            <PrefToggle label="Events &amp; tournaments" checked={prefs.prefEvents} onChange={(v) => setPrefs({ ...prefs, prefEvents: v })} />
            <PrefToggle label="Holiday clinics" checked={prefs.prefHolidayClinics} onChange={(v) => setPrefs({ ...prefs, prefHolidayClinics: v })} />
          </div>
          <StepNav onBack={() => setStep(3)} onNext={() => setStep(5)} />
        </div>
      )

    // ── Step 5: Review & pay ─────────────────────────────────────────────────
    return (
      <div>
        <h2 className="text-xl font-bold text-navy">Review &amp; Confirm</h2>
        <p className="mt-1 text-sm text-muted-foreground">Check your details, then complete payment.</p>
        <dl className="mt-6 space-y-2 rounded-card border border-border bg-card p-5 text-sm shadow-sm">
          <Row
            label="Package"
            value={`${selectedPackage!.name} — R${selectedPackage!.price.toLocaleString()} ${
              isOnceOff ? "(once off)" : "/month"
            } per child`}
          />
          {childCount > 1 && (
            <Row
              label={`Total (${childCount} children)`}
              value={`R${computeTotal().toLocaleString()} ${isOnceOff ? "(once off)" : "/month"}`}
              bold
            />
          )}

          {/* Per-child summary */}
          {children.map((child, idx) => {
            const sched = schedules[idx]
            const clubObj = availableClubs.find((c) => c.id === sched?.clubId)
            const schoolObj = schools.find((s) => s.id === sched?.schoolId)
            return (
              <div key={idx} className={`${idx > 0 ? "mt-3 border-t border-border pt-3" : ""}`}>
                <Row
                  label={childCount > 1 ? `Child ${idx + 1}` : "Child"}
                  value={`${child.firstName} ${child.lastName}`.trim() + ` (born ${child.dob})`}
                />
                {isSchoolPkg ? (
                  <Row label="School" value={schoolObj?.name ?? ""} />
                ) : (
                  <>
                    <Row label="Club" value={clubObj?.name ?? ""} />
                    <Row
                      label={isAdvanced ? "First Session" : "Time Slot"}
                      value={sched?.slot ? formatSlot(sched.slot.weekday, sched.slot.hour) : ""}
                    />
                    {isAdvanced && sched?.slot2 && (
                      <Row label="Second Session" value={formatSlot(sched.slot2.weekday, sched.slot2.hour)} />
                    )}
                  </>
                )}
              </div>
            )
          })}

          <Row label="Parent" value={`${parent.firstName} ${parent.lastName}`.trim()} />
          <Row label="Email" value={parent.email} />
          <Row label="Mobile" value={parent.mobile} />
          <Row label="Emergency Contact" value={`${emergency.name} — ${emergency.phone}`} />
        </dl>

        {/* Voucher */}
        <div className="mt-5 rounded-card border border-border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Tag className="h-4 w-4 text-lime-foreground" />
            <p className="text-sm font-semibold text-navy">Have a voucher code?</p>
          </div>
          {appliedVoucher ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-lime/30 bg-lime/10 px-3 py-2">
              <div>
                <p className="text-sm font-bold text-navy">{appliedVoucher.code}</p>
                <p className="text-xs text-muted-foreground">
                  {appliedVoucher.campaignName} — {appliedVoucher.discountPercent}% off applied
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setAppliedVoucher(null); setVoucherInput(""); setVoucherError(null) }}
                className="text-muted-foreground hover:text-navy"
                aria-label="Remove voucher"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                value={voucherInput}
                onChange={(e) => { setVoucherInput(e.target.value.toUpperCase()); setVoucherError(null) }}
                placeholder="e.g. NGP-XXXXXXXX"
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime"
              />
              <button
                type="button"
                disabled={voucherInput.length < 4 || voucherValidating}
                onClick={async () => {
                  setVoucherValidating(true)
                  setVoucherError(null)
                  const result = await validateVoucherCode(
                    voucherInput,
                    isOnceOff ? "once-off" : "monthly",
                  )
                  setVoucherValidating(false)
                  if (result.valid) {
                    setAppliedVoucher(result.voucher)
                  } else {
                    setVoucherError(result.error)
                  }
                }}
                className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {voucherValidating ? "Checking..." : "Apply"}
              </button>
            </div>
          )}
          {voucherError && <p className="mt-2 text-xs text-red-600">{voucherError}</p>}
        </div>

        {/* Payment method badge */}
        <div className="mt-5 rounded-card border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-lime/20">
              <Check className="h-5 w-5 text-lime-foreground" />
            </div>
            <div>
              <p className="font-bold text-navy">Netcash Pay Now — Secure Online Payment</p>
              <p className="text-xs text-muted-foreground">
                {isOnceOff
                  ? "Pay securely via card or EFT. You will be redirected to Netcash after confirming."
                  : "Set up your monthly subscription securely via Netcash. You will be redirected to complete payment."}
              </p>
            </div>
          </div>
        </div>

        {/* Terms & consent */}
        <div className="mt-6 rounded-card border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-bold text-navy">Terms &amp; Indemnity</h3>
            <button
              type="button"
              onClick={() => setShowTerms((s) => !s)}
              className="text-sm font-semibold text-navy underline-offset-4 hover:underline"
            >
              {showTerms ? "Hide full terms" : "Read full terms"}
            </button>
          </div>
          {showTerms && (
            <div className="mt-3 max-h-56 overflow-y-auto rounded-md border border-border bg-muted/40 p-4 text-xs leading-relaxed text-muted-foreground">
              <p className="font-semibold text-navy">{TERMS_TITLE}</p>
              {TERMS_SECTIONS.map((s) => (
                <div key={s.heading} className="mt-3">
                  <p className="font-semibold text-navy">{s.heading}</p>
                  <p>{s.body}</p>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 space-y-3">
            <ConsentCheck label={CONSENT_TERMS_LABEL} checked={agreedTerms} onChange={setAgreedTerms} required />
            <ConsentCheck label={CONSENT_MEDIA_LABEL} checked={consentMedia} onChange={setConsentMedia} />
          </div>
          <div className="mt-5">
            <p className="text-sm font-semibold text-navy">Signature</p>
            <p className="mb-2 text-xs text-muted-foreground">
              Please sign below to confirm your agreement (
              {`${parent.firstName} ${parent.lastName}`.trim() || "parent/guardian"}).
            </p>
            <SignaturePad value={signatureData} onChange={setSignatureData} />
          </div>
        </div>

        {netcashUnavailable && (
          <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
            <p className="font-semibold">Your enrolment has been saved.</p>
            <p className="mt-1">
              We could not connect to NetCash at this moment. Please try again in a few minutes —
              your information will not be lost.
            </p>
          </div>
        )}

        {error && (
          <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <div className="mt-8 flex items-center justify-between gap-4">
          <button
            onClick={() => setStep(4)}
            className="rounded-2xl border-2 border-border px-5 py-3 font-bold text-navy transition-all hover:bg-muted active:scale-95"
          >
            Back
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !agreedTerms || !signatureData}
            className="rounded-2xl bg-lime px-6 py-3 font-black text-lime-foreground shadow-sm transition-all hover:scale-105 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40 active:scale-95"
          >
            {submitting ? "Redirecting to Netcash…" : "Create Account & Pay via Netcash"}
          </button>
        </div>
        {(!agreedTerms || !signatureData) && (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            You must agree to the terms and sign before enrolling.
          </p>
        )}
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Already enrolled?{" "}
          <Link href="/sign-in" className="font-semibold text-navy underline-offset-4 hover:underline">
            Sign in to your dashboard
          </Link>
        </p>
      </div>
    )
  } // end renderStep
} // end OnboardingWizard

// ---------------------------------------------------------------------------
// Sub-components (unchanged from original)
// ---------------------------------------------------------------------------

function PackagePicker({
  packages,
  onSelect,
}: {
  packages: PublicPackage[]
  onSelect: (p: PublicPackage) => void
}) {
  const CARD_COLORS = [
    "from-navy to-[#0d3070]",
    "from-[#1a4a1a] to-[#2d6e2d]",
    "from-[#3a1a5c] to-[#5a2d8c]",
    "from-[#1a3a4a] to-[#0a2a3a]",
  ]
  return (
    <section className="mx-auto max-w-3xl px-4 py-12">
      <h2 className="text-center text-2xl font-black text-navy">Choose Your Package</h2>
      <p className="mt-2 text-center text-sm text-muted-foreground">
        Pick the plan that suits your child — swipe or scroll to explore
      </p>
      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        {packages.map((pkg, i) => {
          const gradient = CARD_COLORS[i % CARD_COLORS.length]
          return (
            <button
              key={pkg.id}
              onClick={() => onSelect(pkg)}
              className="group block w-full overflow-hidden rounded-2xl text-left shadow-xl transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl"
            >
              <div className={`relative overflow-hidden bg-gradient-to-br ${gradient} p-5 text-white`}>
                <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-white/5" />
                {pkg.popular && (
                  <span className="mb-2 inline-block rounded-full bg-lime px-3 py-0.5 text-xs font-black text-navy">
                    Most Popular
                  </span>
                )}
                <h3 className="text-lg font-black leading-tight">{pkg.name}</h3>
                {pkg.tagline && <p className="mt-1 text-xs text-white/70">{pkg.tagline}</p>}
                <div className="mt-3 flex items-end gap-2">
                  <span className="text-4xl font-black text-lime">R{pkg.price.toLocaleString()}</span>
                  {pkg.period === "once-off" ? (
                    <span className="mb-1 rounded-full bg-white/20 px-2 py-0.5 text-xs font-bold">once off</span>
                  ) : (
                    <span className="mb-1 text-sm text-white/60">/month</span>
                  )}
                </div>
              </div>
              <div className="bg-card p-5">
                {pkg.features.length > 0 && (
                  <div className="space-y-2">
                    {pkg.features.slice(0, 4).map((item, idx) => (
                      <div key={idx}>
                        {item.type === "heading" ? (
                          <h5 className="mb-1 text-xs font-semibold text-navy">{item.text}</h5>
                        ) : (
                          <div className="flex items-start gap-2 text-sm">
                            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-lime/20">
                              <Check className="h-2.5 w-2.5 text-lime-foreground" />
                            </span>
                            <span>{item.text}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <span className="mt-5 flex items-center justify-center gap-1.5 rounded-xl bg-lime py-3 text-sm font-black text-lime-foreground transition-all group-hover:bg-navy group-hover:text-white">
                  Select &amp; Continue
                  <ChevronRight className="h-4 w-4" />
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function StepNav({
  onBack,
  onNext,
  nextDisabled,
  nextLabel = "Continue",
}: {
  onBack?: () => void
  onNext: () => void
  nextDisabled?: boolean
  nextLabel?: string
}) {
  return (
    <div className="mt-8 flex items-center justify-between gap-4">
      {onBack ? (
        <button
          onClick={onBack}
          className="rounded-2xl border-2 border-border px-5 py-3 font-bold text-navy transition-all hover:bg-muted active:scale-95"
        >
          Back
        </button>
      ) : (
        <span />
      )}
      <button
        onClick={onNext}
        disabled={nextDisabled}
        className="rounded-2xl bg-lime px-6 py-3 font-black text-lime-foreground shadow-sm transition-all hover:scale-105 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40 active:scale-95"
      >
        {nextLabel}
      </button>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
}) {
  return (
    <label className="block">
      <span className="block text-sm font-semibold text-navy">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 w-full rounded-md border border-border bg-card px-3 py-2 outline-none focus:border-lime"
      />
    </label>
  )
}

function PrefToggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-md border border-border bg-card px-4 py-3">
      <span className="text-sm font-medium text-navy">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 accent-lime"
      />
    </label>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div
      className={`flex justify-between gap-4 border-b border-border pb-2 last:border-0 last:pb-0 ${
        bold ? "border-t border-border pt-2" : ""
      }`}
    >
      <dt className={bold ? "font-bold text-navy" : "text-muted-foreground"}>{label}</dt>
      <dd className={`text-right ${bold ? "font-extrabold text-navy" : "font-semibold text-navy"}`}>
        {value}
      </dd>
    </div>
  )
}

function ConsentCheck({
  label,
  checked,
  onChange,
  required,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  required?: boolean
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-5 w-5 flex-shrink-0 accent-lime"
      />
      <span className="text-sm leading-relaxed text-navy">
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </span>
    </label>
  )
}

function Confirmation({
  packageName,
  reference,
  isEft,
  childNames = [],
  packagePrice,
}: {
  packageName: string
  reference: string
  isEft?: boolean
  childNames?: string[]
  packagePrice?: number
}) {
  const childLabel = childNames.filter(Boolean).join(" & ") || "your child"
  const refs = reference.split(", ")
  return (
    <section className="mx-auto max-w-2xl px-4 py-16">
      <div className="rounded-card border border-lime bg-lime/10 p-8 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-lime text-lime-foreground">
          <Check className="h-7 w-7" />
        </span>
        <h2 className="mt-4 text-2xl font-extrabold text-navy">Welcome to Next Gen Padel!</h2>
        <p className="mt-2 text-muted-foreground">
          {childNames.length > 1
            ? `Your account is ready and ${childNames.length} enrollments in the ${packageName} have been received.`
            : `Your account is ready and your enrollment in the ${packageName} has been received.`}
        </p>
        <p className="mt-4 text-sm text-muted-foreground">
          {refs.length > 1 ? "Your reference numbers" : "Your reference number"}
        </p>
        {refs.map((r) => (
          <p key={r} className="text-lg font-extrabold tracking-wide text-navy">
            {r}
          </p>
        ))}

        {isEft && (
          <div className="mt-6 rounded-card border border-border bg-card p-5 text-left shadow-sm">
            <p className="text-sm font-bold text-navy">Complete your payment via EFT</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Your enrollment is reserved. Please make payment within 48 hours to confirm your spot.
            </p>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-4 border-b border-border pb-2">
                <dt className="text-muted-foreground">Account Name</dt>
                <dd className="font-semibold text-navy">NEXT GEN PADEL ACADEMY</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-border pb-2">
                <dt className="text-muted-foreground">Bank</dt>
                <dd className="font-semibold text-navy">First National Bank</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-border pb-2">
                <dt className="text-muted-foreground">Account Number</dt>
                <dd className="font-semibold text-navy">63214278441</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-border pb-2">
                <dt className="text-muted-foreground">Branch Code</dt>
                <dd className="font-semibold text-navy">252445</dd>
              </div>
              {packagePrice !== undefined && (
                <div className="flex justify-between gap-4 border-b border-border pb-2">
                  <dt className="text-muted-foreground">Amount</dt>
                  <dd className="font-semibold text-navy">R{packagePrice.toLocaleString()}</dd>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Payment Reference</dt>
                <dd className="font-black text-navy">{childLabel}</dd>
              </div>
            </dl>
            <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3">
              <p className="text-xs font-semibold text-amber-800">Important</p>
              <p className="mt-1 text-xs text-amber-700">
                Use <strong>{childLabel}</strong> as the payment reference so we can match your
                payment and confirm your enrollment.
              </p>
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            href="/dashboard"
            className="rounded-md bg-lime px-6 py-2.5 font-bold text-lime-foreground transition-colors hover:bg-lime/90"
          >
            Go to My Dashboard
          </Link>
          <Link
            href="/"
            className="rounded-md border border-border px-6 py-2.5 font-semibold text-navy transition-colors hover:bg-muted"
          >
            Back to Home
          </Link>
        </div>
      </div>
    </section>
  )
}
