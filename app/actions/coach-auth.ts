"use server"

import { coachLogin, setCoachSession, clearCoachSession, getCoachSession, hashPassword, verifyPassword } from "@/lib/coach-auth"
import { requireAdmin } from "@/lib/admin-auth"
import { sendCoachWelcomeEmail } from "@/lib/email"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

function getCoachPortalUrl(): string {
  const base =
    process.env.NEXT_PUBLIC_BASE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  return `${base.replace(/\/$/, "")}/coach/login`
}

// ---------------------------------------------------------------------------
// Coach login / logout
// ---------------------------------------------------------------------------

export async function loginCoach(formData: FormData): Promise<{ error?: string }> {
  const email = String(formData.get("email") ?? "")
  const password = String(formData.get("password") ?? "")
  const result = await coachLogin(email, password)
  if (!result.ok) return { error: result.error ?? "Login failed." }
  await setCoachSession(result.coachId!, email.toLowerCase().trim())
  redirect("/coach/portal")
}

export async function logoutCoach(): Promise<void> {
  await clearCoachSession()
  redirect("/coach/login")
}

// ---------------------------------------------------------------------------
// Admin: set or reset a coach's password
// ---------------------------------------------------------------------------

export async function adminSetCoachPassword(
  coachId: number,
  newPassword: string
): Promise<{ ok: boolean; error?: string; emailSent?: boolean; emailError?: string }> {
  await requireAdmin()
  if (!newPassword || newPassword.length < 6) {
    return { ok: false, error: "Password must be at least 6 characters." }
  }
  const hash = hashPassword(newPassword)
  const { Pool } = await import("pg")
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    // Fetch current email/name/passwordHash BEFORE updating so we know
    // whether this is a brand-new account (no prior password) and have
    // the coach's on-file email to send the invite to. We never source
    // this from any admin/session data — only from the coach's own row.
    const before = await pool.query(
      'SELECT name, email, "passwordHash" FROM coaches WHERE id = $1 LIMIT 1',
      [coachId]
    )
    const coachRow = before.rows[0] as { name: string; email: string | null; passwordHash: string | null } | undefined
    const isNewAccount = !coachRow?.passwordHash

    await pool.query(
      'UPDATE coaches SET "passwordHash" = $1, "updatedAt" = NOW() WHERE id = $2',
      [hash, coachId]
    )
    await pool.end()
    revalidatePath("/admin")

    if (coachRow?.email) {
      const emailResult = await sendCoachWelcomeEmail({
        to: coachRow.email,
        coachName: coachRow.name || "Coach",
        password: newPassword,
        portalUrl: getCoachPortalUrl(),
        isNewAccount,
      })
      return { ok: true, emailSent: emailResult.ok, emailError: emailResult.ok ? undefined : emailResult.error }
    }

    return { ok: true, emailSent: false, emailError: "No login email on file — set an email first to send the invite." }
  } catch (err) {
    try { await pool.end() } catch {}
    return { ok: false, error: err instanceof Error ? err.message : "Failed to set password." }
  }
}

// ---------------------------------------------------------------------------
// Admin: set coach email
// ---------------------------------------------------------------------------

export async function adminSetCoachEmail(
  coachId: number,
  email: string
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin()
  if (!email || !email.includes("@")) return { ok: false, error: "Valid email required." }
  const { Pool } = await import("pg")
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    // Check uniqueness
    const check = await pool.query(
      'SELECT id FROM coaches WHERE email = $1 AND id != $2 LIMIT 1',
      [email.toLowerCase().trim(), coachId]
    )
    if (check.rows.length > 0) {
      await pool.end()
      return { ok: false, error: "That email is already used by another coach." }
    }
    await pool.query(
      'UPDATE coaches SET email = $1, "updatedAt" = NOW() WHERE id = $2',
      [email.toLowerCase().trim(), coachId]
    )
    await pool.end()
    revalidatePath("/admin")
    return { ok: true }
  } catch (err) {
    try { await pool.end() } catch {}
    return { ok: false, error: err instanceof Error ? err.message : "Failed to set email." }
  }
}

// ---------------------------------------------------------------------------
// Admin: set coach account status (active / suspended)
// ---------------------------------------------------------------------------

export async function adminSetCoachStatus(
  coachId: number,
  status: "active" | "suspended"
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin()
  const { Pool } = await import("pg")
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    await pool.query(
      'UPDATE coaches SET "accountStatus" = $1, "updatedAt" = NOW() WHERE id = $2',
      [status, coachId]
    )
    await pool.end()
    revalidatePath("/admin")
    return { ok: true }
  } catch (err) {
    try { await pool.end() } catch {}
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update status." }
  }
}
