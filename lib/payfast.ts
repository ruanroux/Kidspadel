/**
 * PayFast integration helpers.
 *
 * PayFast South Africa — https://developers.payfast.co.za
 *
 * Flow for once-off payments:
 *  1. Build form data with buildPayfastFormData()
 *  2. POST it to PAYFAST_URL (sandbox or live) from the browser — we render
 *     a hidden HTML form that auto-submits so no API key is exposed client-side.
 *  3. PayFast redirects to return_url / cancel_url after the user pays.
 *  4. PayFast POSTs an ITN (Instant Transaction Notification) to notify_url.
 *  5. Our ITN route verifies the signature + validates with PayFast servers and
 *     marks the enrollment as paid.
 */

import crypto from "crypto"

export const PAYFAST_URL =
  process.env.NODE_ENV === "production"
    ? "https://www.payfast.co.za/eng/process"
    : "https://sandbox.payfast.co.za/eng/process"

/** Generate a PayFast-compatible MD5 signature from an ordered param object. */
export function generateSignature(
  params: Record<string, string>,
  passphrase: string,
): string {
  // Build the parameter string (all keys except "signature")
  const paramString = Object.entries(params)
    .filter(([k]) => k !== "signature")
    .map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%20/g, "+")}`)
    .join("&")

  const stringWithPassphrase = passphrase
    ? `${paramString}&passphrase=${encodeURIComponent(passphrase).replace(/%20/g, "+")}`
    : paramString

  return crypto.createHash("md5").update(stringWithPassphrase).digest("hex")
}

export type PayfastParams = {
  merchantId: string
  merchantKey: string
  returnUrl: string
  cancelUrl: string
  notifyUrl: string
  nameFirst: string
  nameLast?: string
  emailAddress: string
  mPaymentId: string   // our internal reference
  amount: string       // e.g. "350.00"
  itemName: string
  itemDescription?: string
  passphrase: string
}

/** Build the complete signed parameter object ready to POST to PayFast. */
export function buildPayfastFormData(p: PayfastParams): Record<string, string> {
  const params: Record<string, string> = {
    merchant_id: p.merchantId,
    merchant_key: p.merchantKey,
    return_url: p.returnUrl,
    cancel_url: p.cancelUrl,
    notify_url: p.notifyUrl,
    name_first: p.nameFirst,
    ...(p.nameLast ? { name_last: p.nameLast } : {}),
    email_address: p.emailAddress,
    m_payment_id: p.mPaymentId,
    amount: p.amount,
    item_name: p.itemName,
    ...(p.itemDescription ? { item_description: p.itemDescription } : {}),
    // Payment type — once-off
    subscription_type: "1",
  }

  // Remove subscription_type for once-off (standard payment, not subscription)
  delete params.subscription_type

  const signature = generateSignature(params, p.passphrase)
  return { ...params, signature }
}

/**
 * Verify the ITN signature sent by PayFast.
 *
 * Matches the PHP reference exactly:
 *  - Iterate all fields in their original POST order
 *  - STOP (break) when you hit "signature" — do not include it or any field after it
 *  - urlencode each value (encodeURIComponent + replace %20 with +)
 *  - Append &passphrase=urlencode(passphrase) if set
 *  - MD5 the resulting string
 *
 * Returns true if the computed hash matches the signature field.
 */
export function verifyItnSignature(
  body: Record<string, string>,
  passphrase: string,
): boolean {
  const incoming = body.signature
  if (!incoming) return false

  let paramString = ""
  for (const [key, val] of Object.entries(body)) {
    if (key === "signature") break          // stop here — do NOT include fields after signature
    paramString += `${key}=${encodeURIComponent(val).replace(/%20/g, "+")}&`
  }
  // Remove trailing &
  paramString = paramString.slice(0, -1)

  if (passphrase) {
    paramString += `&passphrase=${encodeURIComponent(passphrase).replace(/%20/g, "+")}`
  }

  const expected = crypto.createHash("md5").update(paramString).digest("hex")
  return expected === incoming
}
