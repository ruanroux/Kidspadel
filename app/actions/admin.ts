"use server"

import { db } from "@/lib/db"
import { clubs, clubSlots, AGE_GROUPS, type AgeGroup } from "@/lib/db/schema"
import { and, asc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import {
  clearAdminSession,
  credentialsValid,
  isAdminAuthenticated,
  setAdminSession,
} from "@/lib/admin-auth"
import { SLOT_HOURS } from "@/lib/slots"
import type { ClubSlot } from "@/lib/db/schema"

async function requireAdmin() {
  if (!(await isAdminAuthenticated())) {
    throw new Error("Unauthorized")
  }
}

export async function adminLogin(_prev: { error?: string } | undefined, formData: FormData) {
  const username = String(formData.get("username") ?? "")
  const password = String(formData.get("password") ?? "")
  if (!credentialsValid(username, password)) {
    return { error: "Invalid username or password." }
  }
  await setAdminSession()
  redirect("/admin")
}

export async function adminLogout() {
  await clearAdminSession()
  redirect("/admin/login")
}

export type ClubInput = {
  name: string
  location: string
  description: string
  address: string
  phone: string
  hours: string
  features: string[]
  image: string | null
  imageUrl: string | null
  contactPerson: string
  contactEmail: string
  published: boolean
}

export async function createClub(input: ClubInput) {
  await requireAdmin()
  const rows = await db
    .insert(clubs)
    .values({
      name: input.name,
      location: input.location,
      description: input.description || null,
      address: input.address,
      phone: input.phone,
      hours: input.hours,
      features: input.features,
      image: input.image || null,
      imageUrl: input.imageUrl || null,
      contactPerson: input.contactPerson || null,
      contactEmail: input.contactEmail || null,
      published: input.published,
    })
    .returning({ id: clubs.id })
  revalidateClubPaths()
  return { id: rows[0].id }
}

export async function updateClub(id: number, input: ClubInput) {
  await requireAdmin()
  await db
    .update(clubs)
    .set({
      name: input.name,
      location: input.location,
      description: input.description || null,
      address: input.address,
      phone: input.phone,
      hours: input.hours,
      features: input.features,
      image: input.image || null,
      imageUrl: input.imageUrl || null,
      contactPerson: input.contactPerson || null,
      contactEmail: input.contactEmail || null,
      published: input.published,
      updatedAt: new Date(),
    })
    .where(eq(clubs.id, id))
  revalidateClubPaths()
  return { success: true }
}

/**
 * Make a club Inactive (published=false). No records are deleted.
 */
export async function deactivateClub(id: number): Promise<{ success: true }> {
  await requireAdmin()
  await db.update(clubs).set({ published: false, updatedAt: new Date() }).where(eq(clubs.id, id))
  revalidateClubPaths()
  return { success: true }
}

/**
 * Reactivate a club (published=true). No records are deleted.
 */
export async function reactivateClub(id: number): Promise<{ success: true }> {
  await requireAdmin()
  await db.update(clubs).set({ published: true, updatedAt: new Date() }).where(eq(clubs.id, id))
  revalidateClubPaths()
  return { success: true }
}

/** @deprecated Use deactivateClub instead — production records must never be deleted. */
export async function deleteClub(id: number) {
  await requireAdmin()
  await db.delete(clubSlots).where(eq(clubSlots.clubId, id))
  await db.delete(clubs).where(eq(clubs.id, id))
  revalidateClubPaths()
  return { success: true }
}

function revalidateClubPaths() {
  revalidatePath("/admin")
  revalidatePath("/")
  revalidatePath("/clubs")
  revalidatePath("/enrollment")
}

/** Full slot grid (weekday x hour) for a club filtered by age group, including hours with 0 capacity. */
export async function getClubSlots(clubId: number, ageGroup: AgeGroup): Promise<ClubSlot[]> {
  await requireAdmin()
  return db
    .select()
    .from(clubSlots)
    .where(and(eq(clubSlots.clubId, clubId), eq(clubSlots.ageGroup, ageGroup)))
    .orderBy(asc(clubSlots.weekday), asc(clubSlots.hour))
}

/** All clubs (published and unpublished) for the admin dashboard. */
export async function getAllClubsAdmin() {
  await requireAdmin()
  return db.select().from(clubs).orderBy(asc(clubs.id))
}

/** Upsert a single slot's capacity per age group. Capacity 0 removes the slot. */
export async function setSlotCapacity(input: {
  clubId: number
  weekday: number
  hour: number
  capacity: number
  ageGroup: AgeGroup
}) {
  await requireAdmin()
  const capacity = Math.max(0, Math.floor(input.capacity))
  // Normalise to one decimal place so DB lookups match
  const hour = Math.round(input.hour * 2) / 2

  if (!(SLOT_HOURS as readonly number[]).includes(hour)) {
    throw new Error("Invalid hour")
  }

  if (!AGE_GROUPS.includes(input.ageGroup as AgeGroup)) {
    throw new Error("Invalid age group")
  }

  const existing = await db
    .select()
    .from(clubSlots)
    .where(
      and(
        eq(clubSlots.clubId, input.clubId),
        eq(clubSlots.weekday, input.weekday),
        eq(clubSlots.hour, String(hour)),
        eq(clubSlots.ageGroup, input.ageGroup),
      ),
    )
    .limit(1)

  if (existing.length > 0) {
    await db
      .update(clubSlots)
      .set({ capacity, updatedAt: new Date() })
      .where(eq(clubSlots.id, existing[0].id))
  } else if (capacity > 0) {
    await db.insert(clubSlots).values({
      clubId: input.clubId,
      weekday: input.weekday,
      hour: String(hour),
      capacity,
      ageGroup: input.ageGroup,
    })
  }

  revalidatePath("/admin")
  return { success: true }
}
