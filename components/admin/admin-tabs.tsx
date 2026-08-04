"use client"

import { useState } from "react"
import type { Club, VoucherCampaign } from "@/lib/db/schema"
import { AdminClubManager } from "@/components/admin/admin-club-manager"
import { AdminPackageManager } from "@/components/admin/admin-package-manager"
import { AdminSignupsManager } from "@/components/admin/admin-signups-manager"
import { AdminContactManager } from "@/components/admin/admin-contact-manager"
import { AdminCoachesManager } from "@/components/admin/admin-coaches-manager"
import { AdminCoachingPortal } from "@/components/admin/admin-coaching-portal"
import type { CoachOption, CoachingEnrollment, AttendanceRecord } from "@/app/actions/coaching-portal"
import { AdminReferralsManager } from "@/components/admin/admin-referrals-manager"
import { AdminPaymentsManager } from "@/components/admin/admin-payments-manager"
import type { PublicPackage as PackageDTO } from "@/app/actions/packages"
import type { AdminSignup } from "@/app/actions/admin-signups"
import type { ContactPerson } from "@/app/actions/contact-settings"
import type { CoachRow } from "@/app/actions/coaches"
import type { AdminReferralRow, AdminVoucherRow } from "@/app/actions/referrals"
import type { Order, Payment, Subscription, WebhookLog, School } from "@/lib/db/schema"
import { AdminSchoolsManager } from "@/components/admin/admin-schools-manager"
import { AdminImpersonationManager } from "@/components/admin/admin-impersonation-manager"
import { AdminMomentsManager } from "@/components/admin/admin-moments-manager"
import type { PublicMoment } from "@/app/actions/moments"
import { AdminSiteImagesManager } from "@/components/admin/admin-site-images-manager"
import type { SiteImageRow } from "@/app/actions/site-images"
import { AdminBillingManager } from "@/components/admin/admin-billing-manager"
import type { BillingLedgerEntry, OutstandingEntry, RevenueMonthSummary } from "@/app/actions/subscription-months"

type Tab = "clubs" | "schools" | "packages" | "signups" | "contact" | "coaches" | "coaching-portal" | "referrals" | "payments" | "billing" | "impersonate" | "moments" | "site-images"

export function AdminTabs({
  clubs,
  schools,
  packages,
  signups,
  contacts,
  coaches,
  coachOptions,
  initialCoachEnrollments,
  initialCoachAttendance,
  initialCoachHistory,
  referrals,
  vouchers,
  campaigns,
  allPayments,
  allOrders,
  allSubscriptions,
  webhookLogs,
  moments,
  siteImages,
  billingLedger,
  billingOutstanding,
  billingRevenue,
}: {
  clubs: Club[]
  schools: School[]
  packages: PackageDTO[]
  signups: AdminSignup[]
  contacts: ContactPerson[]
  coaches: CoachRow[]
  coachOptions: CoachOption[]
  initialCoachEnrollments: CoachingEnrollment[]
  initialCoachAttendance: AttendanceRecord[]
  initialCoachHistory: AttendanceRecord[]
  referrals: AdminReferralRow[]
  vouchers: AdminVoucherRow[]
  campaigns: VoucherCampaign[]
  allPayments: Payment[]
  allOrders: Order[]
  allSubscriptions: Subscription[]
  webhookLogs: WebhookLog[]
  moments: PublicMoment[]
  siteImages: SiteImageRow[]
  billingLedger: BillingLedgerEntry[]
  billingOutstanding: OutstandingEntry[]
  billingRevenue: RevenueMonthSummary[]
}) {
  const [tab, setTab] = useState<Tab>("clubs")

  const tabs: { id: Tab; label: string }[] = [
    { id: "clubs", label: "Clubs" },
    { id: "schools", label: "Schools" },
    { id: "packages", label: "Packages" },
    { id: "signups", label: "Sign-ups" },
    { id: "coaches", label: "Coaches" },
    { id: "coaching-portal", label: "Coaching Portal" },
    { id: "payments", label: "Payments" },
    { id: "billing", label: "Billing" },
    { id: "referrals", label: "Referrals & Vouchers" },
    { id: "contact", label: "Contact Details" },
    { id: "moments", label: "Next Gen Moments" },
    { id: "site-images", label: "Site Images" },
    { id: "impersonate", label: "View as Parent" },
  ]

  return (
    <div>
      <div className="flex flex-wrap gap-2 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px rounded-t-md border-b-2 px-4 py-2.5 text-sm font-bold transition-colors ${
              tab === t.id
                ? "border-lime text-navy"
                : "border-transparent text-muted-foreground hover:text-navy"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-8">
        {tab === "clubs" && <AdminClubManager initialClubs={clubs} />}
        {tab === "schools" && <AdminSchoolsManager initialSchools={schools} />}
        {tab === "packages" && <AdminPackageManager initialPackages={packages} allClubs={clubs} allSchools={schools} />}
        {tab === "signups" && <AdminSignupsManager initialSignups={signups} allCoaches={coaches} allPackages={packages} allClubs={clubs} />}
        {tab === "coaches" && <AdminCoachesManager initialCoaches={coaches} allClubs={clubs} />}
        {tab === "coaching-portal" && (
          <AdminCoachingPortal
            initialCoaches={coachOptions}
            initialEnrollments={initialCoachEnrollments}
            initialAttendance={initialCoachAttendance}
            initialHistory={initialCoachHistory}
          />
        )}
        {tab === "payments" && (
          <AdminPaymentsManager
            initialPayments={allPayments}
            initialOrders={allOrders}
            initialSubscriptions={allSubscriptions}
            initialWebhookLogs={webhookLogs}
          />
        )}
        {tab === "billing" && (
          <AdminBillingManager
            initialLedger={billingLedger}
            initialOutstanding={billingOutstanding}
            initialRevenue={billingRevenue}
          />
        )}
        {tab === "referrals" && <AdminReferralsManager referrals={referrals} vouchers={vouchers} campaigns={campaigns} />}
        {tab === "contact" && <AdminContactManager initialContacts={contacts} />}
        {tab === "moments" && <AdminMomentsManager initialMoments={moments} />}
        {tab === "site-images" && <AdminSiteImagesManager initialImages={siteImages} />}
        {tab === "impersonate" && <AdminImpersonationManager />}
      </div>
    </div>
  )
}
