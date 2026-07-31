"use client"

import Image from "next/image"
import { useRef, useState } from "react"
import { Upload, X } from "lucide-react"
import type { Club } from "@/lib/db/schema"
import type { ClubInput } from "@/app/actions/admin"

export function ClubForm({
  club,
  pending,
  onSubmit,
  onCancel,
}: {
  club: Club | null
  pending: boolean
  onSubmit: (input: ClubInput) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(club?.name ?? "")
  const [location, setLocation] = useState(club?.location ?? "")
  const [description, setDescription] = useState(club?.description ?? "")
  const [address, setAddress] = useState(club?.address ?? "")
  const [phone, setPhone] = useState(club?.phone ?? "")
  const [hours, setHours] = useState(club?.hours ?? "")
  const [contactPerson, setContactPerson] = useState(club?.contactPerson ?? "")
  const [contactEmail, setContactEmail] = useState(club?.contactEmail ?? "")
  const [featuresText, setFeaturesText] = useState(
    Array.isArray(club?.features) ? (club!.features as string[]).join(", ") : "",
  )
  const [published, setPublished] = useState(club?.published ?? true)

  // Image — prefer the new Blob pathname, fall back to legacy path
  const [imageUrl, setImageUrl] = useState<string | null>(club?.imageUrl ?? null)
  // imagePreview: data: URL (local), full https:// URL (public blob), local /images/ path, or proxied /api/blob
  const resolvePreview = (url: string | null | undefined, fallback: string | null | undefined): string | null => {
    if (!url) return fallback ?? null
    if (url.startsWith("https://") || url.startsWith("http://") || url.startsWith("/")) return url
    return `/api/blob?p=${encodeURIComponent(url)}`
  }
  const [imagePreview, setImagePreview] = useState<string | null>(
    resolvePreview(club?.imageUrl, club?.image)
  )
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const valid = name && location && address && phone && hours

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError(null)
    // Local preview
    const reader = new FileReader()
    reader.onload = (ev) => setImagePreview(ev.target?.result as string)
    reader.readAsDataURL(file)
    // Upload to Blob
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/admin/upload-club-image", { method: "POST", body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "Upload failed")
      setImageUrl(json.url)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed")
      setImagePreview(resolvePreview(club?.imageUrl, club?.image))
      setImageUrl(club?.imageUrl ?? null)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  function clearImage() {
    setImageUrl(null)
    setImagePreview(null)
    if (fileRef.current) fileRef.current.value = ""
  }

  function handleSubmit() {
    onSubmit({
      name: name.trim(),
      location: location.trim(),
      description: description.trim(),
      address: address.trim(),
      phone: phone.trim(),
      hours: hours.trim(),
      image: null,
      imageUrl,
      contactPerson: contactPerson.trim(),
      contactEmail: contactEmail.trim(),
      features: featuresText
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean),
      published,
    })
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Club Name" value={name} onChange={setName} />
        <TextField
          label="Location (city, province)"
          value={location}
          onChange={setLocation}
          placeholder="Pretoria, Gauteng"
        />
      </div>
      <TextField
        label="Address"
        value={address}
        onChange={setAddress}
        placeholder="Street, suburb, city, code"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Phone" value={phone} onChange={setPhone} placeholder="012 345 6789" />
        <TextField
          label="Operating Hours"
          value={hours}
          onChange={setHours}
          placeholder="Mon-Fri: 10:00-16:00"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Contact Person (optional)"
          value={contactPerson}
          onChange={setContactPerson}
          placeholder="Full name"
        />
        <TextField
          label="Contact Email (optional)"
          value={contactEmail}
          onChange={setContactEmail}
          placeholder="contact@club.co.za"
        />
      </div>
      <label className="block">
        <span className="block text-sm font-semibold text-navy">Description (optional)</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="mt-2 w-full rounded-md border border-border bg-card px-3 py-2 outline-none focus:border-lime"
        />
      </label>
      <TextField
        label="Features (comma separated)"
        value={featuresText}
        onChange={setFeaturesText}
        placeholder="6 Indoor Courts, Café, Parking"
      />

      {/* Image upload */}
      <div>
        <span className="block text-sm font-semibold text-navy">Club Image (optional)</span>
        <div className="mt-2 flex items-start gap-4">
          {/* Preview */}
          {imagePreview ? (
            <div className="relative h-24 w-36 flex-shrink-0 overflow-hidden rounded-md border border-border bg-muted">
              <Image src={imagePreview} alt="Club preview" fill className="object-cover" />
              <button
                type="button"
                onClick={clearImage}
                className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
                aria-label="Remove image"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <div className="flex h-24 w-36 flex-shrink-0 items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/40 text-muted-foreground">
              <Upload size={24} />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={handleFileChange}
              className="hidden"
              id="club-image-upload"
            />
            <label
              htmlFor="club-image-upload"
              className="cursor-pointer rounded-md border border-border bg-card px-4 py-2 text-sm font-semibold text-navy transition-colors hover:bg-muted"
            >
              {uploading ? "Uploading…" : "Choose image"}
            </label>
            <p className="text-xs text-muted-foreground">JPEG, PNG, WebP or GIF, max 4 MB</p>
            {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
          </div>
        </div>
      </div>

      <label className="flex items-center gap-3 rounded-md border border-border bg-card px-4 py-3">
        <input
          type="checkbox"
          checked={published}
          onChange={(e) => setPublished(e.target.checked)}
          className="h-5 w-5 accent-lime"
        />
        <span className="text-sm font-medium text-navy">
          Published (visible on homepage &amp; enrollment)
        </span>
      </label>

      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onCancel}
          className="rounded-md border border-border px-5 py-2.5 font-semibold text-navy transition-colors hover:bg-muted"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!valid || pending || uploading}
          className="rounded-md bg-lime px-6 py-2.5 font-bold text-lime-foreground transition-colors hover:bg-lime/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Saving…" : club ? "Save Changes" : "Create Club"}
        </button>
      </div>
    </div>
  )
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="block">
      <span className="block text-sm font-semibold text-navy">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 w-full rounded-md border border-border bg-card px-3 py-2 outline-none focus:border-lime"
      />
    </label>
  )
}
