import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { getActiveImpersonation } from "@/app/actions/impersonation"
import { db } from "@/lib/db"
import { enrollments, payments, subscriptions } from "@/lib/db/schema"
import { eq, desc } from "drizzle-orm"
import { getMyEnrollments } from "@/app/actions/enrollment"
import { getReferralSummary } from "@/app/actions/referrals"
import { getMyPayments, getMySubscriptions } from "@/app/actions/payments"
import { SignOutButton } from "@/components/sign-out-button"
import { ChangeSlot } from "@/components/change-slot"
import { EditProfile } from "@/components/edit-profile"
import { ReferralPanel } from "@/components/referral-panel"
import { ImpersonationBanner } from "@/components/impersonation-banner"
import {
  CalendarDays, Mail, Phone, ShieldCheck, User,
  CreditCard, RefreshCw, CheckCircle2, XCircle, Clock,
  AlertCircle, Receipt,
} from "lucide-react"

const MEMBERSHIP_STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  active: "bg-lime/20 text-navy",
  confirmed: "bg-lime/20 text-navy",
  cancelled: "bg-muted text-muted-foreground",
  "on-hold": "bg-amber-100 text-amber-700",
  inactive: "bg-muted text-muted-foreground",
}

const PAYMENT_STATUS_STYLES: Record<string, string> = {
  paid: "bg-lime/20 text-navy",
  pending: "bg-amber-100 text-amber-800",
  awaiting_payment: "bg-blue-100 text-blue-800",
  failed: "bg-red-100 text-red-700",
  refunded: "bg-muted text-muted-foreground",
  cancelled: "bg-muted text-muted-foreground",
}

const SUBSCRIPTION_STATUS_STYLES: Record<string, string> = {
  active: "bg-lime/20 text-navy",
  pending: "bg-amber-100 text-amber-800",
  paused: "bg-blue-100 text-blue-700",
  cancelled: "bg-muted text-muted-foreground",
  expired: "bg-muted text-muted-foreground",
  payment_failed: "bg-red-100 text-red-700",
}

function formatDate(d: Date | string | null | undefined) {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("en-ZA", { year: "numeric", month: "short", day: "numeric" })
}

function formatCents(cents: number | null | undefined) {
  if (cents == null) return "—"
  return `R${(cents / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default async function DashboardPage() {
  // Check for active admin impersonation first
  const impersonation = await getActiveImpersonation()

  let userId: string
  let displayName: string
  let displayEmail: string
  let isImpersonating = false

  if (impersonation) {
    // Admin is viewing as a parent — use the impersonated user's ID for all data
    userId = impersonation.parentId
    displayName = impersonation.parentName
    displayEmail = impersonation.parentEmail
    isImpersonating = true
  } else {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) redirect("/sign-in")
    userId = session.user.id
    displayName = session.user.name
    displayEmail = session.user.email
  }

  // Fetch data scoped to the correct userId (real or impersonated)
  const [userEnrollments, allPayments, allSubscriptions, referralSummary] = await Promise.all([
    db.select().from(enrollments).where(eq(enrollments.userId, userId)).orderBy(desc(enrollments.createdAt)),
    db.select().from(payments).where(eq(payments.userId, userId)).orderBy(desc(payments.createdAt)).catch(() => []),
    db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).orderBy(desc(subscriptions.createdAt)).catch(() => []),
    // Referral summary — only available for real sessions (not during impersonation)
    isImpersonating ? Promise.resolve(null) : getReferralSummary().catch(() => null),
  ])

  const mobile = userEnrollments[0]?.parentMobile ?? ""
  // View-only mode disables mutations on sub-components
  const viewOnly = isImpersonating && impersonation?.mode === "view-only"

  return (
    <main className="min-h-[70vh] bg-background">
      {/* Impersonation banner — always at the top, impossible to miss */}
      {isImpersonating && impersonation && (
        <ImpersonationBanner
          parentName={displayName}
          parentEmail={displayEmail}
          mode={impersonation.mode}
        />
      )}

      {/* Hero */}
      <section className="bg-navy text-navy-foreground">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-8 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4 sm:py-10">
          <div>
            <h1 className="text-xl font-extrabold sm:text-3xl">
              Welcome back, {displayName}
            </h1>
            <p className="mt-1 text-sm text-navy-foreground/80">{displayEmail}</p>
          </div>
          {/* Only show sign-out for real users, not impersonating admins */}
          {!isImpersonating && <SignOutButton />}
        </div>
      </section>

      <div className="mx-auto max-w-5xl px-4 py-8 space-y-10 sm:py-10 sm:space-y-12">
        {/* Profile */}
        <section>
          <h2 className="text-lg font-bold text-navy">My Profile</h2>
          <EditProfile name={displayName} mobile={mobile} readOnly={viewOnly} />
        </section>

        {/* Referral & Vouchers */}
        {referralSummary && (
          <section>
            <ReferralPanel summary={referralSummary} />
          </section>
        )}

        {/* Enrollments */}
        <section>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold text-navy">My Enrollments</h2>
            {!isImpersonating && (
              <a
                href="/enrollment"
                className="rounded-md bg-lime px-4 py-2 text-sm font-bold text-lime-foreground transition-colors hover:bg-lime/90"
              >
                Enroll Another Child
              </a>
            )}
          </div>

          {userEnrollments.length === 0 ? (
            <div className="mt-8 rounded-card border border-dashed border-border bg-card p-10 text-center">
              <p className="text-muted-foreground">You don&apos;t have any enrollments yet.</p>
              <a
                href="/enrollment"
                className="mt-4 inline-block rounded-md bg-lime px-5 py-2.5 font-bold text-lime-foreground transition-colors hover:bg-lime/90"
              >
                Start an Enrollment
              </a>
            </div>
          ) : (
            <div className="mt-6 grid gap-6 md:grid-cols-2">
              {userEnrollments.map((e) => {
                const subscription = allSubscriptions.find((s) => s.enrollmentId === e.id) ?? null
                const enrollmentPayments = allPayments.filter((p) => p.enrollmentId === e.id)
                const isMonthly = e.paymentType === "monthly"

                const isInactive = e.status === "inactive"

                return (
                  <article
                    key={e.id}
                    className={`rounded-card border bg-card shadow-sm ${isInactive ? "border-dashed border-muted-foreground/30 opacity-80" : "border-border"}`}
                  >
                    {/* Card header */}
                    <div className="flex items-start justify-between gap-3 border-b border-border p-4 sm:p-5">
                      <div>
                        <h3 className={`text-lg font-bold ${isInactive ? "text-muted-foreground" : "text-navy"}`}>{e.childName}</h3>
                        <p className="text-sm text-muted-foreground">{e.packageName}</p>
                        {!isInactive && (
                          <p className="mt-0.5 text-xs text-muted-foreground capitalize">
                            {isMonthly ? "Monthly subscription" : "Once-off"}
                          </p>
                        )}
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold capitalize ${
                          MEMBERSHIP_STATUS_STYLES[e.status] ?? "bg-muted text-muted-foreground"
                        }`}
                      >
                        {e.status}
                      </span>
                    </div>

                    <div className="p-4 sm:p-5 space-y-4">
                      {/* Inactive notice */}
                      {isInactive && (
                        <div className="flex items-center gap-2 rounded-md bg-muted/60 border border-border px-3 py-2 text-xs text-muted-foreground">
                          <AlertCircle className="h-4 w-4 shrink-0" />
                          This enrolment has been made inactive. Please contact us if you have any questions.
                        </div>
                      )}

                      {/* Enrollment details */}
                      <dl className="space-y-2 text-sm">
                        <Detail icon={ShieldCheck} label="Reference" value={e.referenceNumber} />
                        <Detail icon={CalendarDays} label="Club" value={e.club} />
                        {!isInactive && (
                          <ChangeSlot
                            enrollmentId={e.id}
                            clubId={e.clubId}
                            weekday={e.slotWeekday}
                            hour={e.slotHour != null ? parseFloat(String(e.slotHour)) : null}
                            ageGroup={(e.slotAgeGroup as import("@/lib/db/schema").AgeGroup) ?? null}
                            packageName={e.packageName ?? null}
                          />
                        )}
                        <Detail icon={User} label="Age" value={`${e.childAge} years`} />
                        <Detail icon={Mail} label="Email" value={e.parentEmail} />
                        <Detail icon={Phone} label="Mobile" value={e.parentMobile} />
                        {e.emergencyContactName && (
                          <Detail
                            icon={Phone}
                            label="Emergency"
                            value={`${e.emergencyContactName} — ${e.emergencyContactPhone}`}
                          />
                        )}
                      </dl>

                      {/* Payment section — only show for active enrolments */}
                      {!isInactive && (
                        <>
                          {/* Payment status */}
                          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payment</p>
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                              <CreditCard className="h-4 w-4 text-lime" />
                              <span className="text-navy font-medium">Status:</span>
                              <span className={`rounded-full px-2 py-0.5 text-xs font-bold capitalize ${
                                PAYMENT_STATUS_STYLES[e.paymentStatus ?? "pending"] ?? "bg-muted text-muted-foreground"
                              }`}>
                                {(e.paymentStatus ?? "pending").replace("_", " ")}
                              </span>
                            </div>

                            {/* Subscription info for monthly */}
                            {isMonthly && subscription && (
                              <>
                                <div className="flex flex-wrap items-center gap-2 text-sm">
                                  <RefreshCw className="h-4 w-4 text-lime" />
                                  <span className="text-navy font-medium">Subscription:</span>
                                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold capitalize ${
                                    SUBSCRIPTION_STATUS_STYLES[subscription.status] ?? "bg-muted text-muted-foreground"
                                  }`}>
                                    {subscription.status.replace("_", " ")}
                                  </span>
                                </div>
                                {subscription.nextBillingDate && (
                                  <div className="flex items-center gap-2 text-sm">
                                    <Clock className="h-4 w-4 text-lime" />
                                    <span className="text-muted-foreground">Next billing:</span>
                                    <span className="font-semibold text-navy">{formatDate(subscription.nextBillingDate)}</span>
                                  </div>
                                )}
                                {subscription.lastPaymentDate && (
                                  <div className="flex items-center gap-2 text-sm">
                                    <CheckCircle2 className="h-4 w-4 text-lime" />
                                    <span className="text-muted-foreground">Last payment:</span>
                                    <span className="font-semibold text-navy">{formatDate(subscription.lastPaymentDate)}</span>
                                  </div>
                                )}
                                {subscription.amount && (
                                  <div className="flex items-center gap-2 text-sm">
                                    <Receipt className="h-4 w-4 text-lime" />
                                    <span className="text-muted-foreground">Monthly amount:</span>
                                    <span className="font-semibold text-navy">{formatCents(subscription.amount)}</span>
                                  </div>
                                )}
                              </>
                            )}

                            {/* Pending payment prompt */}
                            {(e.paymentStatus === "pending" || e.paymentStatus === "awaiting_payment" || e.paymentStatus == null) && (
                              <div className="flex items-center gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                                <AlertCircle className="h-4 w-4 shrink-0" />
                                Payment pending. If you have not yet completed payment, please contact us.
                              </div>
                            )}

                            {e.paymentStatus === "failed" && (
                              <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                                <XCircle className="h-4 w-4 shrink-0" />
                                Your last payment failed. Please contact us to retry.
                              </div>
                            )}
                          </div>

                          {/* Payment history */}
                          {enrollmentPayments.length > 0 && (
                            <div>
                              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payment History</p>
                              <div className="space-y-1">
                                {enrollmentPayments.slice(0, 5).map((p) => (
                                  <div key={p.id} className="flex items-center justify-between gap-2 rounded-md bg-muted/30 px-3 py-2 text-xs">
                                    <div className="flex items-center gap-2">
                                      {p.status === "paid"
                                        ? <CheckCircle2 className="h-3.5 w-3.5 text-lime-600" />
                                        : <XCircle className="h-3.5 w-3.5 text-red-500" />}
                                      <span className="capitalize text-muted-foreground">{formatDate(p.paidAt ?? p.createdAt)}</span>
                                    </div>
                                    <span className="font-bold text-navy">{formatCents(p.amount)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

function Detail({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Mail
  label: string
  value: string
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border pb-2 last:border-0 last:pb-0">
      <dt className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4 text-lime" />
        {label}
      </dt>
      <dd className="text-right font-semibold text-navy">{value}</dd>
    </div>
  )
}
