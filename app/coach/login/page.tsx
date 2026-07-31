import { redirect } from "next/navigation"
import { getCoachSession } from "@/lib/coach-auth"
import { CoachLoginForm } from "@/components/coach/coach-login-form"

export const metadata = {
  title: "Coach Login | Next Gen Padel Academy",
  description: "Sign in to your coach portal",
}

export default async function CoachLoginPage() {
  const session = await getCoachSession()
  if (session) redirect("/coach/portal")

  return (
    <main className="flex min-h-screen items-center justify-center bg-navy px-4">
      <div className="w-full max-w-sm">
        {/* Logo / brand */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-lime shadow-lg">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <circle cx="16" cy="16" r="14" fill="#0a1628" />
              <path d="M10 16a6 6 0 1 1 12 0 6 6 0 0 1-12 0Z" fill="#b5f23d" />
              <path d="M16 8v16M8 16h16" stroke="#b5f23d" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
            </svg>
          </div>
          <h1 className="text-2xl font-extrabold text-white">Coach Portal</h1>
          <p className="mt-1 text-sm text-white/60">Next Gen Padel Academy</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-8 shadow-xl backdrop-blur-sm">
          <CoachLoginForm />
        </div>

        <p className="mt-6 text-center text-xs text-white/40">
          Having trouble signing in? Contact your admin.
        </p>
      </div>
    </main>
  )
}
