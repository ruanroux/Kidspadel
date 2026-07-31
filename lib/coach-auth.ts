"server-only"
import "server-only"
import { cookies } from "next/headers"
import { db } from "@/lib/db"
import { coaches } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import crypto from "crypto"

const COOKIE_NAME = "ngp_coach"
const COOKIE_MAX_AGE = 60 * 60 * 12 // 12 hours

// ---------------------------------------------------------------------------
// Password hashing — matches the existing salt:hash format in the coaches table
// (32-byte random salt hex + SHA-512 HMAC, producing 128-char hex digest)
// ---------------------------------------------------------------------------

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex") // 32 hex chars
  const hash = crypto
    .createHmac("sha512", salt)
    .update(password)
    .digest("hex") // 128 hex chars
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, storedHash: string): boolean {
  try {
    const [salt, expected] = storedHash.split(":")
    if (!salt || !expected) return false
    const actual = crypto.createHmac("sha512", salt).update(password).digest("hex")
    // Constant-time comparison
    if (actual.length !== expected.length) return false
    return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"))
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Session cookie helpers
// ---------------------------------------------------------------------------

function makeToken(coachId: number, email: string): string {
  const secret = process.env.BETTER_AUTH_SECRET ?? "ngp-coach-secret"
  return Buffer.from(
    `${coachId}:${email}:${crypto.createHmac("sha256", secret).update(`${coachId}:${email}`).digest("hex")}`
  ).toString("base64")
}

function parseToken(token: string): { coachId: number; email: string } | null {
  try {
    const decoded = Buffer.from(token, "base64").toString("utf8")
    const secret = process.env.BETTER_AUTH_SECRET ?? "ngp-coach-secret"
    const parts = decoded.split(":")
    if (parts.length < 3) return null
    // last 64 chars is the hmac hex
    const coachId = Number(parts[0])
    const email = parts.slice(1, -1).join(":") // handle emails with colons
    const expectedSig = crypto.createHmac("sha256", secret).update(`${coachId}:${email}`).digest("hex")
    const actualSig = parts[parts.length - 1]
    if (!crypto.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(actualSig))) return null
    if (isNaN(coachId) || !email) return null
    return { coachId, email }
  } catch {
    return null
  }
}

export async function setCoachSession(coachId: number, email: string): Promise<void> {
  const store = await cookies()
  store.set(COOKIE_NAME, makeToken(coachId, email), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  })
}

export async function clearCoachSession(): Promise<void> {
  const store = await cookies()
  store.delete(COOKIE_NAME)
}

export async function getCoachSession(): Promise<{ coachId: number; email: string } | null> {
  const store = await cookies()
  const token = store.get(COOKIE_NAME)?.value
  if (!token) return null
  return parseToken(token)
}

export async function requireCoachSession(): Promise<{ coachId: number; email: string }> {
  const session = await getCoachSession()
  if (!session) throw new Error("Not authenticated as coach")
  return session
}

// ---------------------------------------------------------------------------
// Login helper — validates email + password against the coaches table
// ---------------------------------------------------------------------------

export async function coachLogin(
  email: string,
  password: string
): Promise<{ ok: boolean; coachId?: number; name?: string; error?: string }> {
  if (!email || !password) return { ok: false, error: "Email and password are required." }

  // Fetch coach by email (the extra columns exist in DB but not in Drizzle schema — use raw SQL)
  const { Pool } = await import("pg")
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    const res = await pool.query(
      'SELECT id, name, email, "passwordHash", "accountStatus" FROM coaches WHERE email = $1 LIMIT 1',
      [email.toLowerCase().trim()]
    )
    await pool.end()
    const coach = res.rows[0]
    if (!coach) return { ok: false, error: "Invalid email or password." }
    if (coach.accountStatus !== "active") return { ok: false, error: "Account is not active. Contact admin." }
    if (!coach.passwordHash) return { ok: false, error: "No password set for this account. Contact admin." }
    if (!verifyPassword(password, coach.passwordHash)) return { ok: false, error: "Invalid email or password." }
    return { ok: true, coachId: coach.id, name: coach.name }
  } catch (err) {
    try { await pool.end() } catch {}
    return { ok: false, error: "Login failed. Please try again." }
  }
}
