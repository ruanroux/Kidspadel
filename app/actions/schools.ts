"use server"

import { db } from "@/lib/db"
import { schools } from "@/lib/db/schema"
import { asc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { requireAdmin } from "@/lib/admin-auth"
import type { School } from "@/lib/db/schema"

export type SchoolInput = {
  name: string
  location: string
  address: string
  phone: string
  email: string
  website: string
  description: string
  logoUrl?: string | null
  contactPerson: string
  published: boolean
}

/** All published schools for the public site. */
export async function getPublishedSchools(): Promise<School[]> {
  return db.select().from(schools).where(eq(schools.published, true)).orderBy(asc(schools.name))
}

/** All schools for admin (published + unpublished). */
export async function getAllSchoolsAdmin(): Promise<School[]> {
  return db.select().from(schools).orderBy(asc(schools.name))
}

/** A single school by id. */
export async function getSchoolById(id: number): Promise<School | null> {
  const rows = await db.select().from(schools).where(eq(schools.id, id)).limit(1)
  return rows[0] ?? null
}

/** Create a new school (admin only). */
export async function createSchool(input: SchoolInput): Promise<School> {
  await requireAdmin()
  const [row] = await db
    .insert(schools)
    .values({
      name: input.name,
      location: input.location,
      address: input.address,
      phone: input.phone,
      email: input.email,
      website: input.website,
      description: input.description,
      logoUrl: input.logoUrl ?? null,
      contactPerson: input.contactPerson,
      published: input.published,
    })
    .returning()
  revalidatePath("/schools")
  revalidatePath("/admin")
  return row
}

/** Update an existing school (admin only). */
export async function updateSchool(id: number, input: SchoolInput): Promise<School> {
  await requireAdmin()
  const [row] = await db
    .update(schools)
    .set({
      name: input.name,
      location: input.location,
      address: input.address,
      phone: input.phone,
      email: input.email,
      website: input.website,
      description: input.description,
      logoUrl: input.logoUrl ?? null,
      contactPerson: input.contactPerson,
      published: input.published,
      updatedAt: new Date(),
    })
    .where(eq(schools.id, id))
    .returning()
  revalidatePath("/schools")
  revalidatePath("/admin")
  return row
}

/**
 * Make a school Inactive (published=false). No records are deleted.
 */
export async function deactivateSchool(id: number): Promise<void> {
  await requireAdmin()
  await db.update(schools).set({ published: false, updatedAt: new Date() }).where(eq(schools.id, id))
  revalidatePath("/schools")
  revalidatePath("/admin")
  revalidatePath("/enrollment")
}

/**
 * Reactivate a school (published=true). No records are deleted.
 */
export async function reactivateSchool(id: number): Promise<void> {
  await requireAdmin()
  await db.update(schools).set({ published: true, updatedAt: new Date() }).where(eq(schools.id, id))
  revalidatePath("/schools")
  revalidatePath("/admin")
  revalidatePath("/enrollment")
}

/** @deprecated Use deactivateSchool instead — production records must never be deleted. */
export async function deleteSchool(id: number): Promise<void> {
  await requireAdmin()
  await db.delete(schools).where(eq(schools.id, id))
  revalidatePath("/schools")
  revalidatePath("/admin")
}
