"use client"

import { useState, useTransition, useRef } from "react"
import { Plus, Trash2, Save, Check, Upload, Eye, EyeOff, GripVertical, ChevronDown, KeyRound, Mail, ShieldCheck, ShieldOff, ExternalLink } from "lucide-react"
import type { CoachRow } from "@/app/actions/coaches"
import { saveCoach, deleteCoach } from "@/app/actions/coaches"
import { adminSetCoachPassword, adminSetCoachEmail, adminSetCoachStatus } from "@/app/actions/coach-auth"
import type { Club } from "@/lib/db/schema"

function makeTemp(): CoachRow {
  return {
    id: 0,
    name: "",
    role: "",
    bio: "",
    imageUrl: null,
    sortOrder: 0,
    published: true,
    clubIds: [],
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="block text-xs font-semibold text-navy">{label}</span>
      {children}
    </div>
  )
}

function ClubMultiSelect({
  allClubs,
  selected,
  onChange,
}: {
  allClubs: Club[]
  selected: number[]
  onChange: (ids: number[]) => void
}) {
  const [open, setOpen] = useState(false)

  function toggle(id: number) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])
  }

  const label =
    selected.length === 0
      ? "No clubs assigned"
      : selected.length === allClubs.length
      ? "All clubs"
      : allClubs
          .filter((c) => selected.includes(c.id))
          .map((c) => c.name)
          .join(", ")

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mt-1.5 flex w-full items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime"
      >
        <span className={`truncate ${selected.length === 0 ? "text-muted-foreground" : "text-navy"}`}>{label}</span>
        <ChevronDown className={`ml-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-card shadow-lg">
          {allClubs.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">No clubs found. Add clubs first.</p>
          ) : (
            allClubs.map((club) => (
              <label
                key={club.id}
                className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(club.id)}
                  onChange={() => toggle(club.id)}
                  className="h-4 w-4 accent-lime"
                />
                <span className="text-sm text-navy">{club.name}</span>
                {club.location && (
                  <span className="ml-auto text-xs text-muted-foreground">{club.location}</span>
                )}
              </label>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Convert any image URL to a proxy URL safe for browser rendering.
 * Raw private blob URLs (https://...private.blob.vercel-storage.com/...)
 * require server-side auth — browsers cannot load them directly.
 * This mirrors what resolveImageUrl() does on the server.
 */
function toDisplayUrl(url: string | null | undefined): string | null {
  if (!url) return null
  // Already a proxy URL — use as-is
  if (url.startsWith("/api/blob?p=")) return url
  // Raw blob or bare pathname — wrap in proxy
  return `/api/blob?p=${encodeURIComponent(url)}`
}

/**
 * Strip ALL layers of /api/blob?p= wrapping before saving to DB.
 * Mirrors the loop in unwrapProxyUrl() on the server.
 */
function fromDisplayUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const PREFIX = "/api/blob?p="
  let current = url
  for (let i = 0; i < 5; i++) {
    if (!current.startsWith(PREFIX)) break
    try { current = decodeURIComponent(current.slice(PREFIX.length)) } catch { break }
  }
  return current
}

// ---------------------------------------------------------------------------
// Login access panel — shown inside each CoachCard for existing coaches
// ---------------------------------------------------------------------------

function CoachLoginAccess({
  coachId,
  coachName,
  initialLoginEmail,
  initialHasPassword,
  initialAccountStatus,
}: {
  coachId: number
  coachName: string
  initialLoginEmail?: string | null
  initialHasPassword?: boolean
  initialAccountStatus?: string
}) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [emailMsg, setEmailMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [emailPending, startEmail] = useTransition()

  // Tracks what's actually saved on the server, so the panel always shows
  // proof of persistence instead of the write-only input going blank.
  const [savedEmail, setSavedEmail] = useState<string | null>(initialLoginEmail ?? null)
  const [savedHasPassword, setSavedHasPassword] = useState<boolean>(!!initialHasPassword)

  const [newPassword, setNewPassword] = useState("")
  const [showPw, setShowPw] = useState(false)
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pwPending, startPw] = useTransition()

  const [statusPending, startStatus] = useTransition()
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [savedStatus, setSavedStatus] = useState<string>(initialAccountStatus ?? "active")

  if (coachId === 0) return null // unsaved coach — nothing to manage yet

  function handleSetEmail() {
    if (!email.includes("@")) { setEmailMsg({ ok: false, text: "Enter a valid email." }); return }
    setEmailMsg(null)
    const submitted = email.trim().toLowerCase()
    startEmail(async () => {
      const res = await adminSetCoachEmail(coachId, submitted)
      setEmailMsg({ ok: res.ok, text: res.ok ? "Email saved." : res.error ?? "Failed." })
      if (res.ok) {
        setSavedEmail(submitted)
        setEmail("")
      }
    })
  }

  function handleSetPassword() {
    if (newPassword.length < 6) { setPwMsg({ ok: false, text: "At least 6 characters required." }); return }
    setPwMsg(null)
    startPw(async () => {
      const res = await adminSetCoachPassword(coachId, newPassword)
      if (!res.ok) {
        setPwMsg({ ok: false, text: res.error ?? "Failed." })
        return
      }
      setSavedHasPassword(true)
      setPwMsg({
        ok: true,
        text: res.emailSent
          ? "Password saved — invite email sent to the coach."
          : `Password saved. ${res.emailError ?? "Invite email could not be sent."}`,
      })
      setNewPassword("")
    })
  }

  function handleSetStatus(status: "active" | "suspended") {
    setStatusMsg(null)
    startStatus(async () => {
      const res = await adminSetCoachStatus(coachId, status)
      setStatusMsg({ ok: res.ok, text: res.ok ? `Account ${status}.` : res.error ?? "Failed." })
      if (res.ok) setSavedStatus(status)
    })
  }

  return (
    <div className="mt-4 rounded-xl border border-border bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm"
      >
        <div className="flex items-center gap-2 text-navy font-semibold">
          <KeyRound className="h-4 w-4 text-muted-foreground" />
          Login Access &amp; Account
        </div>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-border px-4 pb-4 pt-3 space-y-5">
          {/* Portal link */}
          <div className="flex items-center gap-2 rounded-lg border border-lime/30 bg-lime/5 px-3 py-2">
            <ExternalLink className="h-3.5 w-3.5 text-lime shrink-0" />
            <span className="text-xs text-muted-foreground">Coach portal:</span>
            <a
              href="/coach/login"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold text-navy underline hover:text-lime transition-colors"
            >
              /coach/login
            </a>
          </div>

          {/* Email */}
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-navy">
              <Mail className="h-3.5 w-3.5" />
              Login email
            </p>
            <p className="mb-1.5 text-xs">
              {savedEmail ? (
                <span className="text-muted-foreground">
                  Currently saved: <span className="font-semibold text-navy">{savedEmail}</span>
                </span>
              ) : (
                <span className="text-muted-foreground">No login email saved yet.</span>
              )}
            </p>
            <div className="flex gap-2">
              <input
                type="email"
                name={`coach-${coachId}-login-email`}
                placeholder="coach@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                data-form-type="other"
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime"
              />
              <button
                type="button"
                disabled={emailPending || !email}
                onClick={handleSetEmail}
                className="rounded-md bg-lime px-3 py-2 text-xs font-bold text-[#1a2a00] hover:bg-lime/90 disabled:opacity-50 transition-colors"
              >
                {emailPending ? "Saving…" : "Set email"}
              </button>
            </div>
            {emailMsg && (
              <p className={`mt-1.5 text-xs font-semibold ${emailMsg.ok ? "text-emerald-600" : "text-destructive"}`}>
                {emailMsg.text}
              </p>
            )}
          </div>

          {/* Password */}
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-navy">
              <KeyRound className="h-3.5 w-3.5" />
              Set / reset password
            </p>
            <p className="mb-1.5 text-xs">
              {savedHasPassword ? (
                <span className="font-semibold text-emerald-600">Password is set — this coach can log in.</span>
              ) : (
                <span className="font-semibold text-amber-600">No password set yet — this coach cannot log in.</span>
              )}
            </p>
            <p className="mb-1.5 text-xs text-muted-foreground">
              Saving a password automatically emails the coach an invite with their login email and this password — set the login email above first.
            </p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showPw ? "text" : "password"}
                  name={`coach-${coachId}-new-password`}
                  placeholder="New password (min 6 chars)"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  data-1p-ignore
                  data-lpignore="true"
                  data-form-type="other"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 pr-10 text-sm outline-none focus:border-lime"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-navy transition-colors"
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <button
                type="button"
                disabled={pwPending || newPassword.length < 6}
                onClick={handleSetPassword}
                className="rounded-md bg-navy px-3 py-2 text-xs font-bold text-white hover:bg-navy/80 disabled:opacity-50 transition-colors"
              >
                {pwPending ? "Saving…" : "Set password"}
              </button>
            </div>
            {pwMsg && (
              <p className={`mt-1.5 text-xs font-semibold ${pwMsg.ok ? "text-emerald-600" : "text-destructive"}`}>
                {pwMsg.text}
              </p>
            )}
          </div>

          {/* Account status */}
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-navy">
              <ShieldCheck className="h-3.5 w-3.5" />
              Account status
            </p>
            <p className="mb-1.5 text-xs text-muted-foreground">
              Currently: <span className="font-semibold text-navy">{savedStatus === "suspended" ? "Suspended" : "Active"}</span>
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={statusPending}
                onClick={() => handleSetStatus("active")}
                className={`flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-bold transition-colors disabled:opacity-50 ${
                  savedStatus === "active"
                    ? "bg-lime/25 border-lime text-[#2d4800]"
                    : "bg-lime/15 border-lime/30 text-[#2d4800] hover:bg-lime/25"
                }`}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                Activate
              </button>
              <button
                type="button"
                disabled={statusPending}
                onClick={() => handleSetStatus("suspended")}
                className={`flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-bold transition-colors disabled:opacity-50 ${
                  savedStatus === "suspended"
                    ? "bg-red-100 border-red-300 text-red-700"
                    : "bg-red-50 border-red-200 text-red-700 hover:bg-red-100"
                }`}
              >
                <ShieldOff className="h-3.5 w-3.5" />
                Suspend
              </button>
            </div>
            {statusMsg && (
              <p className={`mt-1.5 text-xs font-semibold ${statusMsg.ok ? "text-emerald-600" : "text-destructive"}`}>
                {statusMsg.text}
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Suspended coaches cannot log in. Their data is preserved.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function CoachCard({
  coach,
  index,
  allClubs,
  onUpdate,
  onRemove,
}: {
  coach: CoachRow
  index: number
  allClubs: Club[]
  onUpdate: (updated: CoachRow) => void
  onRemove: (id: number, imageUrl: string | null) => void
}) {
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [saving, startSave] = useTransition()
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Separate display URL (always proxied, safe for <img>) from the raw
  // value stored in coach.imageUrl (which may be a raw blob URL or proxy URL).
  // We use displayUrl for rendering and pass the raw value to saveCoach.
  const displayUrl = toDisplayUrl(coach.imageUrl)

  function update<K extends keyof CoachRow>(field: K, value: CoachRow[K]) {
    onUpdate({ ...coach, [field]: value })
  }

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError(null)
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/coaches/upload", { method: "POST", body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "Upload failed")
      // Store the raw URL — toDisplayUrl() will make it renderable for <img>
      update("imageUrl", json.url)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  function handleSave() {
    setSaveError(null)
    setSaved(false)
    startSave(async () => {
      // Always send the raw URL to the server — unwrapProxyUrl in saveCoach
      // handles both raw and proxy formats correctly.
      const rawUrl = fromDisplayUrl(coach.imageUrl)
      const res = await saveCoach({
        id: coach.id || undefined,
        name: coach.name,
        role: coach.role,
        bio: coach.bio,
        imageUrl: rawUrl,
        sortOrder: coach.sortOrder,
        published: coach.published,
        clubIds: coach.clubIds,
      })
      if (res.ok) {
        onUpdate({ ...coach, id: res.id })
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      } else {
        setSaveError("Save failed. Please try again.")
      }
    })
  }

  return (
    <fieldset className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      {/* Header */}
      <div className="mb-4 flex items-center gap-3">
        <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-sm font-bold text-navy">
          {coach.name || `Coach ${index + 1}`}
        </span>
        <button
          type="button"
          onClick={() => update("published", !coach.published)}
          title={coach.published ? "Visible on site" : "Hidden from site"}
          className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold transition-colors ${
            coach.published ? "bg-lime/20 text-lime-foreground" : "bg-muted text-muted-foreground"
          }`}
        >
          {coach.published ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
          {coach.published ? "Published" : "Hidden"}
        </button>
        <button
          type="button"
          onClick={() => onRemove(coach.id, coach.imageUrl)}
          className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/10 transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Remove
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Photo */}
        <div className="sm:col-span-2 flex items-center gap-4">
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full border-2 border-border bg-muted">
            {displayUrl ? (
              // Always use displayUrl (proxied) — raw private blob URLs can't be loaded by browsers
              // eslint-disable-next-line @next/next/no-img-element
              <img src={displayUrl} alt={coach.name || "Coach"} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xl font-black text-muted-foreground">
                {coach.name ? coach.name[0].toUpperCase() : "?"}
              </div>
            )}
          </div>
          <div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-navy hover:bg-muted transition-colors disabled:opacity-50"
            >
              <Upload className="h-3.5 w-3.5" />
              {uploading ? "Uploading…" : coach.imageUrl ? "Change photo" : "Upload photo"}
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
            {uploadError && <p className="mt-1 text-xs text-destructive">{uploadError}</p>}
            <p className="mt-1 text-xs text-muted-foreground">JPG, PNG or WebP · max 5 MB</p>
          </div>
        </div>

        <Field label="Full name">
          <input
            value={coach.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="e.g. Gareth Nunes"
            className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime"
          />
        </Field>

        <Field label="Role / title">
          <input
            value={coach.role}
            onChange={(e) => update("role", e.target.value)}
            placeholder="e.g. Head Coach"
            className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime"
          />
        </Field>

        <Field label="Assigned clubs">
          <ClubMultiSelect
            allClubs={allClubs}
            selected={coach.clubIds}
            onChange={(ids) => update("clubIds", ids)}
          />
        </Field>

        <Field label="Sort order">
          <input
            type="number"
            min={0}
            value={coach.sortOrder}
            onChange={(e) => update("sortOrder", Number(e.target.value))}
            className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime"
          />
        </Field>

        <Field label="Bio">
          <textarea
            value={coach.bio}
            onChange={(e) => update("bio", e.target.value)}
            rows={3}
            placeholder="Short bio…"
            className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime resize-none sm:col-span-2"
          />
        </Field>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !coach.name}
          className="inline-flex items-center gap-2 rounded-md bg-lime px-4 py-2 text-sm font-bold text-lime-foreground hover:bg-lime/90 disabled:opacity-40 transition-colors"
        >
          {saved ? (
            <><Check className="h-4 w-4" />Saved</>
          ) : (
            <><Save className="h-4 w-4" />{saving ? "Saving…" : "Save coach"}</>
          )}
        </button>
        {saveError && <p className="text-xs text-destructive">{saveError}</p>}
      </div>

      <CoachLoginAccess
        coachId={coach.id}
        coachName={coach.name}
        initialLoginEmail={coach.loginEmail}
        initialHasPassword={coach.hasPassword}
        initialAccountStatus={coach.accountStatus}
      />
    </fieldset>
  )
}

export function AdminCoachesManager({
  initialCoaches,
  allClubs,
}: {
  initialCoaches: CoachRow[]
  allClubs: Club[]
}) {
  const [coachesList, setCoachesList] = useState<CoachRow[]>(initialCoaches)
  const [removing, startRemove] = useTransition()

  function updateCoach(updated: CoachRow) {
    setCoachesList((prev) =>
      prev.map((c) => (c.id !== 0 && c.id === updated.id ? updated : c.id === 0 && updated.id === 0 ? updated : c))
    )
  }

  function addCoach() {
    setCoachesList((prev) => [...prev, { ...makeTemp(), sortOrder: prev.length }])
  }

  function handleRemove(id: number, imageUrl: string | null) {
    if (id === 0) {
      setCoachesList((prev) => {
        const idx = prev.findLastIndex((c) => c.id === 0)
        return prev.filter((_, i) => i !== idx)
      })
      return
    }
    if (!confirm("Remove this coach permanently?")) return
    startRemove(async () => {
      await deleteCoach(id, imageUrl)
      setCoachesList((prev) => prev.filter((c) => c.id !== id))
    })
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-navy">Meet Our Coaches</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Add, edit or remove coaches. Assign each coach to one or more clubs — only assigned coaches appear in the sign-up form for that venue.
      </p>

      <div className="mt-6 space-y-5">
        {coachesList.map((coach, i) => (
          <CoachCard
            key={coach.id === 0 ? `new-${i}` : coach.id}
            coach={coach}
            index={i}
            allClubs={allClubs}
            onUpdate={updateCoach}
            onRemove={handleRemove}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={addCoach}
        disabled={removing}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border py-3 text-sm font-semibold text-muted-foreground transition-colors hover:border-lime hover:text-lime"
      >
        <Plus className="h-4 w-4" />
        Add coach
      </button>
    </div>
  )
}
