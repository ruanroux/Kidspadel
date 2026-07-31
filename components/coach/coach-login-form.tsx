"use client"

import { useActionState, useState } from "react"
import { loginCoach } from "@/app/actions/coach-auth"
import { Eye, EyeOff } from "lucide-react"

export function CoachLoginForm() {
  const [state, formAction, pending] = useActionState(
    async (_prev: { error?: string } | undefined, formData: FormData) => {
      return await loginCoach(formData)
    },
    undefined
  )
  const [showPw, setShowPw] = useState(false)

  return (
    <form action={formAction} className="space-y-5">
      <label className="block">
        <span className="block text-sm font-semibold text-white/80">Email address</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          className="mt-2 w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none focus:border-lime focus:bg-white/15 transition-colors"
        />
      </label>

      <label className="block">
        <span className="block text-sm font-semibold text-white/80">Password</span>
        <div className="relative mt-2">
          <input
            name="password"
            type={showPw ? "text" : "password"}
            autoComplete="current-password"
            required
            placeholder="••••••••"
            className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 pr-11 text-sm text-white placeholder:text-white/30 outline-none focus:border-lime focus:bg-white/15 transition-colors"
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors"
            aria-label={showPw ? "Hide password" : "Show password"}
          >
            {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </label>

      {state?.error && (
        <div
          role="alert"
          className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"
        >
          {state.error}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-lime px-4 py-3 font-bold text-navy transition-all hover:bg-lime/90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending ? "Signing in…" : "Sign In"}
      </button>
    </form>
  )
}
