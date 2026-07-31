"use client"

import { useEffect, useRef, useState } from "react"
import {
  Copy,
  Check,
  Share2,
  Mail,
  Gift,
  Users,
  Clock,
  Tag,
  ChevronDown,
  ChevronUp,
} from "lucide-react"
import type { ReferralSummary } from "@/app/actions/referrals"
import QRCode from "qrcode"

type Props = {
  summary: ReferralSummary
}

export function ReferralPanel({ summary }: Props) {
  const { referralUrl, pending, successful, vouchers } = summary
  const [copied, setCopied] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [showVouchers, setShowVouchers] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    QRCode.toDataURL(referralUrl, { width: 200, margin: 1, color: { dark: "#0a2347", light: "#ffffff" } })
      .then(setQrDataUrl)
      .catch(() => {})
  }, [referralUrl])

  function copyLink() {
    navigator.clipboard.writeText(referralUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function shareWhatsApp() {
    const msg = encodeURIComponent(
      `Join me at Next Gen Padel Academy! Use my referral link to sign up: ${referralUrl}`,
    )
    window.open(`https://wa.me/?text=${msg}`, "_blank")
  }

  function shareEmail() {
    const subject = encodeURIComponent("Join Next Gen Padel Academy!")
    const body = encodeURIComponent(
      `Hi!\n\nI wanted to share this with you — I've been part of Next Gen Padel Academy and it's been amazing for my kids.\n\nSign up using my referral link and we both benefit:\n${referralUrl}\n\nSee you on the court!`,
    )
    window.open(`mailto:?subject=${subject}&body=${body}`)
  }

  const activeVouchers = vouchers.filter((v) => v.status === "active")
  const usedVouchers = vouchers.filter((v) => v.status !== "active")

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-navy">Refer a Friend</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Earn a 20% discount voucher for every family you refer who joins and completes their first payment.
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <StatCard
          label="Successful"
          value={successful}
          icon={<Users className="h-5 w-5 text-lime" />}
          highlight
        />
        <StatCard
          label="Pending"
          value={pending}
          icon={<Clock className="h-5 w-5 text-muted-foreground" />}
        />
        <StatCard
          label="Vouchers"
          value={activeVouchers.length}
          icon={<Tag className="h-5 w-5 text-lime" />}
          highlight={activeVouchers.length > 0}
        />
      </div>

      {/* Referral link card */}
      <div className="rounded-card border border-border bg-card p-5 shadow-sm space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your Referral Link</p>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
          <span className="flex-1 truncate text-sm font-mono text-navy">{referralUrl}</span>
          <button
            onClick={copyLink}
            aria-label="Copy referral link"
            className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-lime/20 hover:text-navy"
          >
            {copied ? <Check className="h-4 w-4 text-lime" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={copyLink}
            className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-semibold text-navy transition-colors hover:bg-muted"
          >
            {copied ? <Check className="h-4 w-4 text-lime" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied!" : "Copy Link"}
          </button>
          <button
            onClick={shareWhatsApp}
            className="flex items-center gap-2 rounded-md bg-[#25D366] px-3 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            <Share2 className="h-4 w-4" />
            WhatsApp
          </button>
          <button
            onClick={shareEmail}
            className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-semibold text-navy transition-colors hover:bg-muted"
          >
            <Mail className="h-4 w-4" />
            Email
          </button>
        </div>

        {/* QR Code */}
        {qrDataUrl && (
          <div className="flex flex-col items-start gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">QR Code</p>
            <img
              src={qrDataUrl}
              alt="Referral QR code"
              className="h-32 w-32 rounded-lg border border-border"
            />
          </div>
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {/* Vouchers */}
      {vouchers.length > 0 && (
        <div className="rounded-card border border-border bg-card shadow-sm">
          <button
            onClick={() => setShowVouchers((v) => !v)}
            className="flex w-full items-center justify-between p-5 text-left"
          >
            <div className="flex items-center gap-3">
              <Gift className="h-5 w-5 text-lime" />
              <span className="font-bold text-navy">
                My Vouchers
                {activeVouchers.length > 0 && (
                  <span className="ml-2 rounded-full bg-lime/20 px-2 py-0.5 text-xs font-bold text-navy">
                    {activeVouchers.length} active
                  </span>
                )}
              </span>
            </div>
            {showVouchers ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>

          {showVouchers && (
            <div className="border-t border-border divide-y divide-border">
              {activeVouchers.map((v) => (
                <VoucherRow key={v.id} voucher={v} />
              ))}
              {usedVouchers.map((v) => (
                <VoucherRow key={v.id} voucher={v} dim />
              ))}
            </div>
          )}
        </div>
      )}

      {vouchers.length === 0 && (
        <div className="rounded-card border border-dashed border-border bg-card p-8 text-center">
          <Gift className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm text-muted-foreground">
            No vouchers yet. Start referring friends to earn discount vouchers!
          </p>
        </div>
      )}
    </section>
  )
}

function StatCard({
  label,
  value,
  icon,
  highlight,
}: {
  label: string
  value: number
  icon: React.ReactNode
  highlight?: boolean
}) {
  return (
    <div
      className={`rounded-card border p-4 text-center shadow-sm ${
        highlight ? "border-lime/40 bg-lime/10" : "border-border bg-card"
      }`}
    >
      <div className="flex justify-center">{icon}</div>
      <p className="mt-1 text-2xl font-extrabold text-navy">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

function VoucherRow({
  voucher,
  dim,
}: {
  voucher: ReferralSummary["vouchers"][number]
  dim?: boolean
}) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(voucher.code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const expired = voucher.expiresAt && new Date(voucher.expiresAt) < new Date()

  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 p-4 ${dim ? "opacity-50" : ""}`}>
      <div className="space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-bold text-navy">{voucher.code}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-bold capitalize ${
              voucher.status === "active"
                ? "bg-lime/20 text-navy"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {voucher.status}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {voucher.discountPercent}% off — {voucher.campaignName}
          {voucher.expiresAt &&
            ` · Expires ${new Date(voucher.expiresAt).toLocaleDateString("en-ZA")}`}
        </p>
      </div>
      {voucher.status === "active" && (
        <button
          onClick={copy}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-navy transition-colors hover:bg-muted"
        >
          {copied ? <Check className="h-3 w-3 text-lime" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy Code"}
        </button>
      )}
    </div>
  )
}
