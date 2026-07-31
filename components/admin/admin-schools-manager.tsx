"use client"

import { useState, useTransition, useRef } from "react"
import { useRouter } from "next/navigation"
import { Plus, Pencil, X, Upload, Globe, Phone, Mail, MapPin, User, ExternalLink, PowerOff, RotateCcw } from "lucide-react"
import type { School } from "@/lib/db/schema"
import { createSchool, updateSchool, deactivateSchool, reactivateSchool, type SchoolInput } from "@/app/actions/schools"

const EMPTY: SchoolInput = {
  name: "",
  location: "",
  address: "",
  phone: "",
  email: "",
  website: "",
  description: "",
  logoUrl: null,
  contactPerson: "",
  published: true,
}

// ── School Form ────────────────────────────────────────────────────────────────
function SchoolForm({
  school,
  pending,
  onSubmit,
  onCancel,
}: {
  school: School | null
  pending: boolean
  onSubmit: (input: SchoolInput) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(school?.name ?? "")
  const [location, setLocation] = useState(school?.location ?? "")
  const [address, setAddress] = useState(school?.address ?? "")
  const [phone, setPhone] = useState(school?.phone ?? "")
  const [email, setEmail] = useState(school?.email ?? "")
  const [website, setWebsite] = useState(school?.website ?? "")
  const [description, setDescription] = useState(school?.description ?? "")
  const [contactPerson, setContactPerson] = useState(school?.contactPerson ?? "")
  const [published, setPublished] = useState(school?.published ?? true)

  // Logo
  const [logoUrl, setLogoUrl] = useState<string | null>(school?.logoUrl ?? null)
  const [logoPreview, setLogoPreview] = useState<string | null>(school?.logoUrl ?? null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const valid = !!name.trim()

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError(null)
    const reader = new FileReader()
    reader.onload = (ev) => setLogoPreview(ev.target?.result as string)
    reader.readAsDataURL(file)
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/admin/upload-school-logo", { method: "POST", body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "Upload failed")
      setLogoUrl(json.url as string)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setUploading(false)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    onSubmit({ name, location, address, phone, email, website, description, logoUrl, contactPerson, published })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Logo upload */}
      <div>
        <p className="mb-2 text-sm font-semibold text-navy">School Logo</p>
        <div className="flex items-center gap-4">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-border bg-muted flex items-center justify-center">
            {logoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoPreview} alt="Logo preview" className="h-full w-full object-contain p-1" />
            ) : (
              <span className="text-3xl font-black text-muted-foreground">{name[0]?.toUpperCase() ?? "?"}</span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              <Upload className="h-4 w-4" />
              {uploading ? "Uploading…" : "Upload Logo"}
            </button>
            {logoUrl && (
              <button
                type="button"
                onClick={() => { setLogoUrl(null); setLogoPreview(null) }}
                className="inline-flex items-center gap-1 text-xs text-destructive hover:underline"
              >
                <X className="h-3 w-3" /> Remove logo
              </button>
            )}
            <p className="text-xs text-muted-foreground">PNG, JPG, SVG — max 4 MB</p>
            {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
      </div>

      {/* Fields */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1 sm:col-span-2">
          <label className="text-sm font-semibold text-navy">School Name *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Greenside High School"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lime"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-semibold text-navy">Location / Area</label>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Greenside, Johannesburg"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lime"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-semibold text-navy">Street Address</label>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="123 School Road"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lime"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-semibold text-navy">Phone Number</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="011 123 4567"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lime"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-semibold text-navy">Email Address</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="info@school.co.za"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lime"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-semibold text-navy">Website URL</label>
          <input
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://www.school.co.za"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lime"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-semibold text-navy">Contact Person</label>
          <input
            value={contactPerson}
            onChange={(e) => setContactPerson(e.target.value)}
            placeholder="Ms. Jane Smith (Sport Coordinator)"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lime"
          />
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <label className="text-sm font-semibold text-navy">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Brief description of the school and the program offered there…"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lime resize-none"
          />
        </div>
      </div>

      {/* Published toggle */}
      <label className="flex cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={published}
          onChange={(e) => setPublished(e.target.checked)}
          className="h-4 w-4 rounded border-border accent-lime"
        />
        <span className="text-sm font-semibold text-navy">Visible on public Schools page</span>
      </label>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={!valid || pending || uploading}
          className="rounded-md bg-lime px-5 py-2.5 text-sm font-bold text-lime-foreground transition-colors hover:bg-lime/90 disabled:opacity-50"
        >
          {pending ? "Saving…" : school ? "Save Changes" : "Add School"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md border border-border px-5 py-2.5 text-sm font-bold transition-colors hover:bg-muted">
          Cancel
        </button>
      </div>
    </form>
  )
}

// ── Admin Schools Manager ──────────────────────────────────────────────────────
export function AdminSchoolsManager({ initialSchools }: { initialSchools: School[] }) {
  const router = useRouter()
  const [schools, setSchools] = useState<School[]>(initialSchools)
  const [editing, setEditing] = useState<School | null>(null)
  const [creating, setCreating] = useState(false)
  const [pending, startTransition] = useTransition()
  const [filter, setFilter] = useState<"active" | "inactive" | "all">("active")
  const [confirmDeactivate, setConfirmDeactivate] = useState<{ id: number; name: string } | null>(null)
  const [confirmReactivate, setConfirmReactivate] = useState<{ id: number; name: string } | null>(null)

  function handleSave(input: SchoolInput, id?: number) {
    startTransition(async () => {
      if (id) {
        await updateSchool(id, input)
      } else {
        await createSchool(input)
      }
      setEditing(null)
      setCreating(false)
      router.refresh()
    })
  }

  function handleDeactivate(id: number) {
    startTransition(async () => {
      await deactivateSchool(id)
      setConfirmDeactivate(null)
      router.refresh()
    })
  }

  function handleReactivate(id: number) {
    startTransition(async () => {
      await reactivateSchool(id)
      setConfirmReactivate(null)
      router.refresh()
    })
  }

  const activeSchools = schools.filter((s) => s.published)
  const inactiveSchools = schools.filter((s) => !s.published)
  const visibleSchools =
    filter === "active" ? activeSchools : filter === "inactive" ? inactiveSchools : schools

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-navy">Schools</h2>
        <button
          onClick={() => { setCreating(true); setEditing(null) }}
          className="inline-flex items-center gap-2 rounded-md bg-lime px-4 py-2 text-sm font-bold text-lime-foreground transition-colors hover:bg-lime/90"
        >
          <Plus className="h-4 w-4" />
          Add School
        </button>
      </div>

      {/* Filter tabs */}
      <div className="mt-4 flex gap-1 rounded-lg border border-border bg-muted/40 p-1 w-fit">
        {(["active", "inactive", "all"] as const).map((f) => {
          const count = f === "active" ? activeSchools.length : f === "inactive" ? inactiveSchools.length : schools.length
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

      {/* Create form */}
      {creating && (
        <div className="mt-6 rounded-card border border-lime/30 bg-lime/5 p-6">
          <h3 className="mb-4 text-base font-bold text-navy">New School</h3>
          <SchoolForm school={null} pending={pending} onSubmit={(input) => handleSave(input)} onCancel={() => setCreating(false)} />
        </div>
      )}

      {/* School list */}
      <div className="mt-4 grid gap-4">
        {visibleSchools.length === 0 && !creating && (
          <p className="text-sm text-muted-foreground">
            {filter === "inactive" ? "No inactive schools." : filter === "active" ? "No active schools yet. Click \"Add School\" to get started." : "No schools added yet."}
          </p>
        )}
        {visibleSchools.map((school) => {
          const logo = school.logoUrl ?? null
          return (
            <article key={school.id} className="rounded-card border border-border bg-card p-5 shadow-sm">
              {editing?.id === school.id ? (
                <>
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="font-bold text-navy">Editing: {school.name}</h3>
                    <button onClick={() => setEditing(null)} className="text-muted-foreground hover:text-foreground">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <SchoolForm school={school} pending={pending} onSubmit={(input) => handleSave(input, school.id)} onCancel={() => setEditing(null)} />
                </>
              ) : (
                <>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    {/* Logo */}
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-border bg-muted flex items-center justify-center">
                      {logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={logo} alt={school.name} className="h-full w-full object-contain p-1" />
                      ) : (
                        <span className="text-xl font-black text-muted-foreground">{school.name[0]?.toUpperCase()}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-navy">{school.name}</h3>
                        {school.published ? (
                          <span className="rounded-full bg-lime/20 border border-lime/40 px-2 py-0.5 text-xs font-bold text-lime-800">Active</span>
                        ) : (
                          <span className="rounded-full bg-muted border border-muted-foreground/20 px-2 py-0.5 text-xs font-semibold text-muted-foreground">Inactive</span>
                        )}
                      </div>
                      {school.location && (
                        <p className="flex items-center gap-1 text-sm text-muted-foreground mt-0.5">
                          <MapPin className="h-3 w-3 shrink-0" />{school.location}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                        {school.phone && (
                          <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{school.phone}</span>
                        )}
                        {school.email && (
                          <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{school.email}</span>
                        )}
                        {school.website && (
                          <a href={school.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-lime-600 hover:underline">
                            <Globe className="h-3 w-3" />{school.website.replace(/^https?:\/\//, "")}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        {school.contactPerson && (
                          <span className="flex items-center gap-1"><User className="h-3 w-3" />{school.contactPerson}</span>
                        )}
                      </div>
                      {school.description && (
                        <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{school.description}</p>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      onClick={() => { setEditing(school); setCreating(false) }}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-muted"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                    {school.published ? (
                      <button
                        onClick={() => setConfirmDeactivate({ id: school.id, name: school.name })}
                        disabled={pending}
                        className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-50"
                      >
                        <PowerOff className="h-3.5 w-3.5" /> Make Inactive
                      </button>
                    ) : (
                      <button
                        onClick={() => setConfirmReactivate({ id: school.id, name: school.name })}
                        disabled={pending}
                        className="inline-flex items-center gap-1.5 rounded-md border border-lime/40 bg-lime/10 px-3 py-1.5 text-xs font-semibold text-lime-800 transition-colors hover:bg-lime/20 disabled:opacity-50"
                      >
                        <RotateCcw className="h-3.5 w-3.5" /> Reactivate
                      </button>
                    )}
                  </div>
                </div>
                {/* end header row */}

                {/* Deactivate confirmation */}
                {confirmDeactivate?.id === school.id && (
                  <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-4">
                    <p className="text-sm font-semibold text-amber-800">
                      Make <strong>{school.name}</strong> Inactive? The school will be hidden from registrations. All data is preserved.
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => handleDeactivate(school.id)}
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
                {confirmReactivate?.id === school.id && (
                  <div className="mt-4 rounded-md border border-lime/30 bg-lime/5 p-4">
                    <p className="text-sm font-semibold text-navy">
                      Reactivate <strong>{school.name}</strong>? The school will become available for new registrations again.
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => handleReactivate(school.id)}
                        disabled={pending}
                        className="rounded-md bg-lime px-4 py-1.5 text-sm font-bold text-lime-foreground disabled:opacity-50 hover:bg-lime/90"
                      >
                        {pending ? "Saving…" : "Yes, reactivate"}
                      </button>
                      <button
                        onClick={() => setConfirmReactivate(null)}
                        className="rounded-md border border-border px-4 py-1.5 text-sm font-semibold text-navy hover:bg-muted"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                </>
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}
