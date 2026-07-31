/**
 * Netcash Pay Now — server-side helper.
 *
 * Reference: official Netcash WooCommerce plugin (Netcash-ZA/PayNow-WooCommerce)
 * and the Netcash\PayNow PHP SDK (iedev1/paynow-php).
 *
 * Environment variables required:
 *   NETCASH_SERVICE_KEY   — Pay Now service key from Netcash portal (NetConnector → Pay Now)
 *   NEXT_PUBLIC_BASE_URL  — Public HTTPS URL of the deployment
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const NETCASH_PAY_NOW_URL = "https://paynow.netcash.co.za/site/paynow.aspx"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NetcashPaymentType = "once-off" | "monthly"

export interface NetcashPayNowInput {
  /** Netcash Pay Now service key (p1) */
  serviceKey: string
  /** Unique order / reference in your system (p3) */
  orderReference: string
  /** Amount in Rands, e.g. "300.00" (p4) */
  amount: string
  /** Short item name shown on the Netcash page (p5) */
  itemName: string
  /** Optional extra description (p6) */
  itemDescription?: string
  /** URL the customer is sent to after payment — all outcomes use this (p7) */
  returnUrl: string
  /** URL the customer is sent to if they cancel (p8) */
  cancelUrl: string
  /** URL Netcash POSTs the ITN to — must be your notify endpoint (m1) */
  notifyUrl: string
  /** Customer email (m4) */
  customerEmail: string
  /** Customer first name (m5) */
  customerFirstName?: string
  /** Customer last name (m6) */
  customerLastName?: string
  /** 'once-off' or 'monthly' subscription */
  paymentType: NetcashPaymentType
  /**
   * Extra echo-back fields — Netcash returns these in Extra1/Extra2/Extra3
   * in the ITN POST so you can look up your own records without a DB query.
   */
  extra1?: string // returned as Extra1
  extra2?: string // returned as Extra2
  extra3?: string // returned as Extra3
}

export interface NetcashFormFields {
  [key: string]: string
}

// ---------------------------------------------------------------------------
// Build Pay Now form fields
// ---------------------------------------------------------------------------

/**
 * Build the hidden form fields for a Netcash Pay Now redirect.
 *
 * Field map per official Netcash documentation:
 *   p1  = Service Key
 *   p2  = (unused / legacy merchant key — omit for Pay Now)
 *   p3  = Order Reference  ← used as "Reference" in ITN echo-back
 *   p4  = Amount (Rands, 2 decimals)
 *   p5  = Item Name (≤ 100 chars)
 *   p6  = Item Description (≤ 200 chars)
 *   p7  = Return URL (after payment)
 *   p8  = Cancel URL
 *   m1  = Notify URL (server-side ITN endpoint)
 *   m4  = Customer Email   → returned as Extra1 in ITN
 *   m5  = Customer First Name → returned as Extra2
 *   m6  = Customer Last Name  → returned as Extra3
 *   m9  = 1 = enable subscription / recurring token
 *   m10 = Subscription frequency (2 = monthly)
 */
export function buildNetcashPayNowFields(input: NetcashPayNowInput): NetcashFormFields {
  const fields: NetcashFormFields = {
    p1: input.serviceKey,
    p3: input.orderReference,
    p4: input.amount,
    p5: input.itemName.slice(0, 100),
    p6: (input.itemDescription ?? "").slice(0, 200),
    p7: input.returnUrl,
    p8: input.cancelUrl,
    m1: input.notifyUrl,
    m4: input.customerEmail,
  }

  if (input.customerFirstName) fields.m5 = input.customerFirstName
  if (input.customerLastName) fields.m6 = input.customerLastName

  // Recurring subscription — instruct Netcash to tokenise and create a subscription
  if (input.paymentType === "monthly") {
    fields.m9 = "1"   // Enable subscription/recurring
    fields.m10 = "2"  // Frequency: 2 = monthly
  }

  // Echo-back fields — returned as Extra1/Extra2/Extra3 in the ITN POST
  if (input.extra1) fields.m2 = input.extra1
  if (input.extra2) fields.m3 = input.extra2
  if (input.extra3) fields.m7 = input.extra3

  return fields
}

// ---------------------------------------------------------------------------
// ITN (Instant Transaction Notification) payload type
// ---------------------------------------------------------------------------

/**
 * Exact fields Netcash POSTs to your Notify URL.
 *
 * Source: Netcash-ZA/PayNow-WooCommerce → includes/class-wc-gateway-paynow.php
 * `getPostData()` method (the canonical list of expected keys).
 *
 * NOTE: Netcash does NOT send a cryptographic hash/signature in the ITN POST.
 * Verification is done by:
 *   1. Checking TransactionAccepted === "TRUE"
 *   2. Looking up the Reference in your own DB to confirm it is a real order
 *   3. Comparing the posted Amount against the expected amount stored in your DB
 */
export interface NetcashItnPayload {
  /** "TRUE" or "FALSE" */
  TransactionAccepted?: string
  /** Decline / cancel reason text */
  Reason?: string
  /** Cardholder IP address */
  CardHolderIpAddr?: string
  /** Netcash internal transaction trace reference */
  RequestTrace?: string
  /** Your order reference — the value you sent as p3 */
  Reference?: string
  /** Echo-back of your m2 field */
  Extra1?: string
  /** Echo-back of your m2 field */
  Extra2?: string
  /** Echo-back of your m3 field */
  Extra3?: string
  /** Transaction amount in Rands */
  Amount?: string
  /** Payment method used (e.g. "CC", "EFT") */
  Method?: string
  /** Notification type — "DEPOSITRECEIPT" for notify URL calls */
  type?: string
  /** "TRUE" or "FALSE" for subscription setup */
  SubscriptionAccepted?: string
  /** Reason for subscription failure */
  SubscriptionReason?: string
  /** Card token for recurring payments */
  ccToken?: string
  /** Cardholder name on card */
  ccHolder?: string
  /** Masked card number, e.g. "4111 **** **** 1111" */
  ccMasked?: string
  /** Card expiry date */
  ccExpiry?: string
  /** Allow any unknown fields */
  [key: string]: string | undefined
}

// ---------------------------------------------------------------------------
// ITN verification
// ---------------------------------------------------------------------------

export interface NetcashItnVerificationResult {
  valid: boolean
  accepted: boolean
  declined: boolean
  cancelled: boolean
  pending: boolean
  subscriptionAccepted: boolean
  reason: string
  reference: string
  amount: number          // in Rands
  requestTrace: string
  ccToken: string | null
  extra1: string | null
  extra2: string | null
  extra3: string | null
}

/**
 * Parse and verify a Netcash ITN notification.
 *
 * Netcash does NOT sign ITN payloads with a hash/HMAC. The official
 * verification strategy (per the Netcash PHP SDK and the WooCommerce plugin)
 * is:
 *
 *   Step 1 — Reference check: confirm the `Reference` field matches a known
 *             order in your database.  (Done by the caller.)
 *
 *   Step 2 — Amount check: compare the posted `Amount` against the amount
 *             stored in your order record.  The official SDK uses
 *             `checkEqualAmounts()` which compares float-formatted strings.
 *             (Exposed as `amountMatchesExpected()` below.)
 *
 *   Step 3 — TransactionAccepted: only update order status when this is "TRUE".
 *
 * This function handles Step 1-compatible parsing and Step 3.
 * The caller must perform Step 2 using `amountMatchesExpected()`.
 */
export function parseNetcashItn(payload: NetcashItnPayload): NetcashItnVerificationResult {
  const accepted    = payload.TransactionAccepted?.toUpperCase() === "TRUE"
  const declined    = !accepted && (payload.Reason ?? "") !== ""
  const cancelled   = !accepted && !declined
  const pending     = payload.type === "PENDING"
  const subAccepted = payload.SubscriptionAccepted?.toUpperCase() === "TRUE"

  return {
    valid: true, // structural validity — caller must check reference + amount
    accepted,
    declined,
    cancelled,
    pending,
    subscriptionAccepted: subAccepted,
    reason: payload.Reason ?? "",
    reference: payload.Reference ?? "",
    amount: parseFloat(payload.Amount ?? "0"),
    requestTrace: payload.RequestTrace ?? "",
    ccToken: payload.ccToken ?? null,
    extra1: payload.Extra1 ?? null,
    extra2: payload.Extra2 ?? null,
    extra3: payload.Extra3 ?? null,
  }
}

/**
 * Amount comparison helper — mirrors the official SDK's `checkEqualAmounts()`.
 * Compares both values as floats rounded to 2 decimal places.
 */
export function amountMatchesExpected(
  postedAmountRands: number,
  expectedAmountCents: number,
): boolean {
  const posted   = Math.round(postedAmountRands * 100)
  const expected = Math.round(expectedAmountCents)
  return posted === expected
}

// ---------------------------------------------------------------------------
// Build the Netcash payment request from enrollment data
// ---------------------------------------------------------------------------

export interface BuildNetcashPaymentInput {
  referenceNumber: string
  enrollmentId: number
  parentName: string
  parentEmail: string
  packageName: string
  packagePrice: number   // in Rands
  paymentType: NetcashPaymentType
}

export async function buildNetcashPayment(input: BuildNetcashPaymentInput): Promise<{
  netcashUrl: string
  formFields: NetcashFormFields
}> {
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : null) ??
    "https://localhost:3000"

  const serviceKey = process.env.NETCASH_SERVICE_KEY ?? ""

  const nameParts = input.parentName.trim().split(" ")
  const firstName = nameParts[0] ?? input.parentName
  const lastName  = nameParts.slice(1).join(" ") || undefined

  const formFields = buildNetcashPayNowFields({
    serviceKey,
    orderReference: input.referenceNumber,
    amount: input.packagePrice.toFixed(2),
    itemName: `Next Gen Padel — ${input.packageName}`,
    itemDescription:
      input.paymentType === "once-off"
        ? `Once-off enrollment fee for ${input.packageName}`
        : `Monthly subscription for ${input.packageName}`,
    notifyUrl:  `${baseUrl}/api/netcash/notify`,
    returnUrl:  `${baseUrl}/enrollment/success?ref=${encodeURIComponent(input.referenceNumber)}&name=${encodeURIComponent(input.parentName)}`,
    cancelUrl:  `${baseUrl}/enrollment?cancelled=1`,
    customerEmail: input.parentEmail,
    customerFirstName: firstName,
    customerLastName:  lastName,
    paymentType: input.paymentType,
    // Echo enrollment ID back in Extra1 so webhook can find the record
    // without a full-table scan on the referenceNumber index.
    extra1: String(input.enrollmentId),
  })

  return { netcashUrl: NETCASH_PAY_NOW_URL, formFields }
}
