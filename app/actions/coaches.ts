"use server"

import { db } from "@/lib/db"
import { coaches, coachClubs, clubs } from "@/lib/db/schema"
import { eq, asc, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { del } from "@vercel/blob"

export type CoachRow = {
  id: number
  name: string
  role: string
  bio: string
  imageUrl: string | null
  sortOrder: number
  published: boolean
  clubIds: number[]
  // Admin-only login status — never populated for public-facing queries
  // (getPublishedCoaches / getCoachesByClub map their own field lists).
  loginEmail?: string | null
  hasPassword?: boolean
  accountStatus?: string
}


async function attachClubIds(rows: Omit<CoachRow, "clubIds">[]): Promise<CoachRow[]> {
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const assignments = await db
    .select({ coachId: coachClubs.coachId, clubId: coachClubs.clubId })
    .from(coachClubs)
    .where(inArray(coachClubs.coachId, ids))
  const map = new Map<number, number[]>()
  for (const a of assignments) {
    if (!map.has(a.coachId)) map.set(a.coachId, [])
    map.get(a.coachId)!.push(a.clubId)
  }
  return rows.map((r) => ({ ...r, clubIds: map.get(r.id) ?? [] }))
}

export async function getCoaches(): Promise<CoachRow[]> {
  const rows = await db
    .select()
    .from(coaches)
    .orderBy(asc(coaches.sortOrder), asc(coaches.id))
  const base = rows.map((r) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    bio: r.bio,
    // Return the raw stored value — callers must use blobUrl() for display.
    // Never resolve here to avoid proxy URLs leaking into React state on the client.
    imageUrl: r.imageUrl ?? null,
    sortOrder: r.sortOrder,
    published: r.published,
    // Admin-only fields — surfaced so the Login Access panel can confirm
    // what's actually saved instead of always rendering blank inputs.
    loginEmail: r.email ?? null,
    hasPassword: !!r.passwordHash,
    accountStatus: r.accountStatus,
  }))
  return attachClubIds(base)
}

export async function getPublishedCoaches(): Promise<CoachRow[]> {
  const rows = await db
    .select()
    .from(coaches)
    .where(eq(coaches.published, true))
    .orderBy(asc(coaches.sortOrder), asc(coaches.id))
  const base = rows.map((r) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    bio: r.bio,
    // Return the raw stored value — callers must use blobUrl() for display.
    imageUrl: r.imageUrl ?? null,
    sortOrder: r.sortOrder,
    published: r.published,
  }))
  return attachClubIds(base)
}

/** Return published coaches assigned to a specific club — used in the enrollment wizard. */
export async function getCoachesByClub(clubId: number): Promise<CoachRow[]> {
  const assignments = await db
    .select({ coachId: coachClubs.coachId })
    .from(coachClubs)
    .where(eq(coachClubs.clubId, clubId))
  if (assignments.length === 0) return []
  const coachIds = assignments.map((a) => a.coachId)
  const rows = await db
    .select()
    .from(coaches)
    .where(eq(coaches.published, true))
    .orderBy(asc(coaches.sortOrder), asc(coaches.id))
  const filtered = rows.filter((r) => coachIds.includes(r.id))
  const base = filtered.map((r) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    bio: r.bio,
    imageUrl: r.imageUrl ?? null,
    sortOrder: r.sortOrder,
    published: r.published,
    clubIds: [clubId],
  }))
  return base
}

/**
 * Strip ALL layers of /api/blob?p= proxy wrapping from a URL so we always
 * store the original raw value (bare pathname or full https:// blob URL).
 *
 * Loops until the value no longer starts with /api/blob?p= to handle
 * double- or triple-encoded values that can accumulate after repeated saves.
 */
function unwrapProxyUrl(url: string | null | undefined): string | null {
  if (!url) return null
  let current = url
  const PREFIX = "/api/blob?p="
  // Safety limit — no legitimate URL needs more than 5 layers of wrapping
  for (let i = 0; i < 5; i++) {
    if (!current.startsWith(PREFIX)) break
    try {
      current = decodeURIComponent(current.slice(PREFIX.length))
    } catch {
      break
    }
  }
  return current
}

export async function saveCoach(input: {
  id?: number
  name: string
  role: string
  bio: string
  imageUrl: string | null
  sortOrder: number
  published: boolean
  clubIds: number[]
}): Promise<{ ok: boolean; id: number }> {
  let coachId: number
  // Unwrap any proxy URL so we always store the original blob path/URL
  const rawImageUrl = unwrapProxyUrl(input.imageUrl)

  if (input.id) {
    // Only update imageUrl if one is present — prevents accidentally clearing
    // an existing photo when the field was not changed.
    const setFields: Record<string, unknown> = {
      name: input.name,
      role: input.role,
      bio: input.bio,
      sortOrder: input.sortOrder,
      published: input.published,
      updatedAt: new Date(),
    }
    if (rawImageUrl !== null) setFields.imageUrl = rawImageUrl

    await db
      .update(coaches)
      .set(setFields)
      .where(eq(coaches.id, input.id))
    coachId = input.id
  } else {
    const [row] = await db
      .insert(coaches)
      .values({
        name: input.name,
        role: input.role,
        bio: input.bio,
        imageUrl: rawImageUrl ?? undefined,
        sortOrder: input.sortOrder,
        published: input.published,
      })
      .returning({ id: coaches.id })
    coachId = row.id
  }

  // Sync club assignments: delete all existing then re-insert
  await db.delete(coachClubs).where(eq(coachClubs.coachId, coachId))
  if (input.clubIds.length > 0) {
    await db.insert(coachClubs).values(
      input.clubIds.map((clubId) => ({ coachId, clubId }))
    )
  }

  revalidatePath("/about")
  revalidatePath("/")
  revalidatePath("/enrollment")
  return { ok: true, id: coachId }
}

export async function deleteCoach(id: number, imageUrl: string | null): Promise<{ ok: boolean }> {
  // imageUrl arrives from the client as a proxy URL — unwrap before calling del()
  const rawUrl = unwrapProxyUrl(imageUrl)
  if (rawUrl) {
    try {
      await del(rawUrl)
    } catch {
      // Non-fatal — blob may already be gone
    }
  }
  await db.delete(coaches).where(eq(coaches.id, id))
  revalidatePath("/about")
  revalidatePath("/")
  revalidatePath("/enrollment")
  return { ok: true }
}
