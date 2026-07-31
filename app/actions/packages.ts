"use server"

import { revalidatePath } from "next/cache"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { packages, packageSlots, packageClubs, clubs, enrollments } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import type { PackageSlot } from "@/lib/db/schema"

export type FeatureItem = { type: "heading" | "bullet"; text: string }

export type PublicPackage = {
  id: number
  slug: string
  name: string
  price: number
  period: string
  tagline: string
  features: FeatureItem[]
  description: string
  popular: boolean
  published: boolean
  slotType: string
  sortOrder: number
  /** IDs of clubs this package is restricted to. Empty = available at all clubs. */
  clubIds: number[]
  /** IDs of schools this package is restricted to. Only used when isSchool is true. */
  schoolIds: number[]
  /** If true, this is a school-based package — wizard shows school picker instead of club picker. */
  isSchool: boolean
}

export type CustomSlot = Pick<PackageSlot, "id" | "packageId" | "clubId" | "weekday" | "hour" | "capacity" | "ageGroup">

function toPublic(row: typeof packages.$inferSelect, clubIds: number[] = []): PublicPackage {
  // Support both old format (string[]) and new format (FeatureItem[])
  let features: FeatureItem[] = []
  if (Array.isArray(row.features)) {
    const raw = row.features as unknown[]
    features = raw.map((f) => {
      if (typeof f === "string") {
        // Legacy: convert old string to bullet item
        return { type: "bullet", text: f }
      }
      // New format: already a FeatureItem
      return f as FeatureItem
    })
  }

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    price: row.price,
    period: row.period,
    tagline: row.tagline,
    features,
    description: row.description ?? "",
    popular: row.popular,
    published: row.published,
    slotType: row.slotType ?? "standard",
    sortOrder: row.sortOrder,
    clubIds,
    schoolIds: [],
    isSchool: row.isSchool ?? false,
  }
}

/** Fetch all package→club restrictions in one query and group by packageId. */
async function attachClubIds(rows: (typeof packages.$inferSelect)[]): Promise<PublicPackage[]> {
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const links = await db
    .select({ packageId: packageClubs.packageId, clubId: packageClubs.clubId })
    .from(packageClubs)
    .where(inArray(packageClubs.packageId, ids))
  const map: Record<number, number[]> = {}
  for (const l of links) {
    ;(map[l.packageId] ??= []).push(l.clubId)
  }
  return rows.map((r) => toPublic(r, map[r.id] ?? []))
}

/** Returns the slotType ("standard" | "custom") for a package by its id. */
export async function getPackageSlotType(packageId: number): Promise<"standard" | "custom"> {
  const rows = await db
    .select({ slotType: packages.slotType })
    .from(packages)
    .where(eq(packages.id, packageId))
    .limit(1)
  return (rows[0]?.slotType ?? "standard") as "standard" | "custom"
}

/**
 * Looks up a package by name and returns its id + slotType.
 * Used on the parent dashboard where enrollments only store packageName.
 */
export async function getPackageByName(
  name: string,
): Promise<{ id: number; slotType: "standard" | "custom" } | null> {
  const rows = await db
    .select({ id: packages.id, slotType: packages.slotType })
    .from(packages)
    .where(eq(packages.name, name))
    .limit(1)
  if (!rows[0]) return null
  return { id: rows[0].id, slotType: (rows[0].slotType ?? "standard") as "standard" | "custom" }
}

/** Published packages for the public site (homepage + enrollment). */
export async function getPublishedPackages(): Promise<PublicPackage[]> {
  const rows = await db
    .select()
    .from(packages)
    .where(eq(packages.published, true))
    .orderBy(asc(packages.sortOrder), asc(packages.id))
  return attachClubIds(rows)
}

export type CustomSlotWithAvailability = CustomSlot & { booked: number; remaining: number }

/**
 * Custom slots for a package+club combination with live remaining counts.
 * clubId=0 means "all clubs" (legacy rows — shown when no per-club slots exist).
 * Only enrollments with status='active' at the same club consume a slot.
 */
export async function getPublicPackageSlotAvailability(
  packageId: number,
  packageName: string,
  ageGroup?: string,
  clubId?: number,
): Promise<CustomSlotWithAvailability[]> {
  // 1. Get slot definitions scoped to this club (or fall back to clubId=0 rows)
  const conditions = [eq(packageSlots.packageId, packageId)]
  // Only filter by ageGroup when one is explicitly provided — never hard-code a default here
  // (the wizard passes ageGroup ?? "4-8" so it's always set, but guard for safety)
  if (ageGroup) conditions.push(eq(packageSlots.ageGroup, ageGroup))
  // If a specific club is requested, fetch rows for that club; otherwise fetch all
  if (clubId != null && clubId !== 0) {
    conditions.push(eq(packageSlots.clubId, clubId))
  }
  const slotRows = await db
    .select()
    .from(packageSlots)
    .where(and(...conditions))
    .orderBy(asc(packageSlots.weekday), asc(packageSlots.hour))

  if (!slotRows.length) return []

  // 2. Count active bookings per weekday+hour+ageGroup+clubId for this package
  const bookedConditions = [
    eq(enrollments.packageName, packageName),
    eq(enrollments.status, "active"),
  ]
  if (ageGroup) bookedConditions.push(eq(enrollments.slotAgeGroup, ageGroup))
  if (clubId != null && clubId !== 0) {
    bookedConditions.push(eq(enrollments.clubId, clubId))
  }

  const bookedRows = await db
    .select({
      weekday: enrollments.slotWeekday,
      hour: enrollments.slotHour,
      ageGroup: enrollments.slotAgeGroup,
      clubId: enrollments.clubId,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(enrollments)
    .where(and(...bookedConditions))
    .groupBy(enrollments.slotWeekday, enrollments.slotHour, enrollments.slotAgeGroup, enrollments.clubId)

  // Key: weekday-hour-ageGroup (clubId already filtered above)
  const bookedMap = new Map<string, number>()
  for (const r of bookedRows) {
    if (r.weekday == null || r.hour == null) continue
    const key = `${r.weekday}-${parseFloat(String(r.hour))}-${r.ageGroup ?? ""}`
    bookedMap.set(key, r.count)
  }

  return slotRows.map((s) => {
    const h = parseFloat(String(s.hour))
    const key = `${s.weekday}-${h}-${s.ageGroup}`
    const booked = bookedMap.get(key) ?? 0
    return {
      id: s.id,
      packageId: s.packageId,
      clubId: s.clubId,
      weekday: s.weekday,
      hour: s.hour,
      capacity: s.capacity,
      ageGroup: s.ageGroup,
      booked,
      remaining: Math.max(0, s.capacity - booked),
    }
  })
}

/** Custom slots for a package — usable in the enrollment wizard (no auth guard). */
export async function getPublicPackageSlots(packageId: number, ageGroup?: string, clubId?: number): Promise<CustomSlot[]> {
  const conditions = [eq(packageSlots.packageId, packageId)]
  if (ageGroup) conditions.push(eq(packageSlots.ageGroup, ageGroup))
  if (clubId != null && clubId !== 0) conditions.push(eq(packageSlots.clubId, clubId))
  const rows = await db
    .select()
    .from(packageSlots)
    .where(and(...conditions))
    .orderBy(asc(packageSlots.weekday), asc(packageSlots.hour))
  return rows.map((r) => ({ id: r.id, packageId: r.packageId, clubId: r.clubId, weekday: r.weekday, hour: r.hour, capacity: r.capacity, ageGroup: r.ageGroup }))
}

/** All packages (incl. unpublished) for the admin dashboard. */
export async function getAllPackagesAdmin(): Promise<PublicPackage[]> {
  await requireAdmin()
  const rows = await db.select().from(packages).orderBy(asc(packages.sortOrder), asc(packages.id))
  return attachClubIds(rows)
}

/** Custom slots for a single package (admin). */
export async function getPackageSlots(packageId: number): Promise<CustomSlot[]> {
  await requireAdmin()
  const rows = await db
    .select()
    .from(packageSlots)
    .where(eq(packageSlots.packageId, packageId))
    .orderBy(asc(packageSlots.clubId), asc(packageSlots.ageGroup), asc(packageSlots.weekday), asc(packageSlots.hour))
  return rows.map((r) => ({ id: r.id, packageId: r.packageId, clubId: r.clubId, weekday: r.weekday, hour: r.hour, capacity: r.capacity, ageGroup: r.ageGroup }))
}

export type PackageInput = {
  slug: string
  name: string
  price: number
  period: string
  tagline: string
  features: FeatureItem[]
  description: string
  popular: boolean
  published: boolean
  slotType: string
  sortOrder: number
  /** clubId=0 means the slot applies to all clubs (legacy). Any other value = specific club. */
  customSlots?: { clubId: number; weekday: number; hour: number; capacity: number; ageGroup: string }[]
  /** Club IDs this package is restricted to. Empty array = available everywhere. */
  clubIds?: number[]
  schoolIds?: number[]
  /** If true, wizard shows school picker instead of club picker. */
  isSchool?: boolean
}

function clean(input: PackageInput) {
  return {
    slug: input.slug
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, ""),
    name: input.name.trim(),
    price: Math.max(0, Math.round(input.price)),
    period: input.period || "monthly",
    tagline: input.tagline.trim(),
    features: input.features.map((f) => ({ type: f.type, text: f.text.trim() })).filter((f) => f.text),
    description: input.description.trim(),
    popular: input.popular,
    published: input.published,
    slotType: input.slotType === "custom" ? "custom" : "standard",
    sortOrder: Math.round(input.sortOrder),
    isSchool: input.isSchool ?? false,
  }
}

/** Sync package_clubs rows: delete all existing then re-insert. */
async function syncPackageClubs(packageId: number, clubIds: number[]) {
  await db.delete(packageClubs).where(eq(packageClubs.packageId, packageId))
  if (clubIds.length > 0) {
    await db.insert(packageClubs).values(clubIds.map((clubId) => ({ packageId, clubId })))
  }
}

export async function createPackage(input: PackageInput) {
  await requireAdmin()
  const values = clean(input)
  if (!values.slug || !values.name) throw new Error("Slug and name are required.")
  const [row] = await db.insert(packages).values(values).returning({ id: packages.id })
  if (values.slotType === "custom" && input.customSlots?.length) {
    await db.insert(packageSlots).values(
      input.customSlots.map((s) => ({ packageId: row.id, clubId: s.clubId ?? 0, weekday: s.weekday, hour: String(s.hour), capacity: s.capacity, ageGroup: s.ageGroup })),
    )
  }
  await syncPackageClubs(row.id, input.clubIds ?? [])
  revalidatePaths()
}

export async function updatePackage(id: number, input: PackageInput) {
  await requireAdmin()
  const values = clean(input)
  if (!values.slug || !values.name) throw new Error("Slug and name are required.")
  await db.update(packages).set({ ...values, updatedAt: new Date() }).where(eq(packages.id, id))
  // Replace all custom slots for this package
  await db.delete(packageSlots).where(eq(packageSlots.packageId, id))
  if (values.slotType === "custom" && input.customSlots?.length) {
    await db.insert(packageSlots).values(
      input.customSlots.map((s) => ({ packageId: id, clubId: s.clubId ?? 0, weekday: s.weekday, hour: String(s.hour), capacity: s.capacity, ageGroup: s.ageGroup })),
    )
  }
  await syncPackageClubs(id, input.clubIds ?? [])
  revalidatePaths()
}

/**
 * Make a package Inactive (published=false).
 * Simultaneously sets every active/pending enrollment on this package to "inactive".
 * No records are deleted — all data is preserved.
 */
export async function deactivatePackage(id: number): Promise<{ ok: boolean; deactivatedEnrollments: number }> {
  await requireAdmin()
  await db.update(packages).set({ published: false, updatedAt: new Date() }).where(eq(packages.id, id))
  const result = await db
    .update(enrollments)
    .set({ status: "inactive", updatedAt: new Date() })
    .where(and(eq(enrollments.packageName, (await db.select({ name: packages.name }).from(packages).where(eq(packages.id, id)).limit(1))[0]?.name ?? ""), inArray(enrollments.status, ["active", "pending"])))
  revalidatePaths()
  return { ok: true, deactivatedEnrollments: result.rowCount ?? 0 }
}

/**
 * Reactivate a package (published=true).
 * Optionally reactivates all enrollments that were deactivated by this package.
 */
export async function reactivatePackage(id: number, reactivateEnrollments: boolean): Promise<{ ok: boolean; reactivatedEnrollments: number }> {
  await requireAdmin()
  await db.update(packages).set({ published: true, updatedAt: new Date() }).where(eq(packages.id, id))
  let count = 0
  if (reactivateEnrollments) {
    const pkg = await db.select({ name: packages.name }).from(packages).where(eq(packages.id, id)).limit(1)
    if (pkg[0]) {
      const result = await db
        .update(enrollments)
        .set({ status: "active", updatedAt: new Date() })
        .where(and(eq(enrollments.packageName, pkg[0].name), eq(enrollments.status, "inactive")))
      count = result.rowCount ?? 0
    }
  }
  revalidatePaths()
  return { ok: true, reactivatedEnrollments: count }
}

/** @deprecated Use deactivatePackage instead — production records must never be deleted. */
export async function deletePackage(id: number) {
  await requireAdmin()
  await db.delete(packageSlots).where(eq(packageSlots.packageId, id))
  await db.delete(packageClubs).where(eq(packageClubs.packageId, id))
  await db.delete(packages).where(eq(packages.id, id))
  revalidatePaths()
}

function revalidatePaths() {
  revalidatePath("/")
  revalidatePath("/enrollment")
  revalidatePath("/admin")
}
