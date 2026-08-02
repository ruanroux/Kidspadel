/**
 * POST /api/netcash/pay
 *
 * Builds and returns the Netcash Pay Now form fields as JSON.
 * Called from the onboarding wizard instead of a Server Action so that
 * the request goes through a standard fetch() / API route path, avoiding
 * any proxy or middleware that could silently intercept Server Action POSTs
 * (which target /_next/action-... URLs).
 *
 * The caller receives { netcashUrl, formFields } and then auto-submits a
 * hidden HTML form to POST directly to Netcash Pay Now.
 */

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { buildNetcashPaymentForEnrollment } from "@/app/actions/enrollment"

export async function POST(req: NextRequest) {
  // Require an authenticated session — the enrollment must belong to the
  // signed-in user. This prevents unauthenticated callers from triggering
  // order creation.
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: {
    referenceNumber?: string
    enrollmentId?: number
    parentName?: string
    parentEmail?: string
    packageName?: string
    packagePrice?: number
    paymentType?: "once-off" | "monthly"
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const {
    referenceNumber,
    enrollmentId,
    parentName,
    parentEmail,
    packageName,
    packagePrice,
    paymentType,
  } = body

  if (
    !referenceNumber ||
    !enrollmentId ||
    !parentName ||
    !parentEmail ||
    !packageName ||
    packagePrice == null ||
    !paymentType
  ) {
    return NextResponse.json({ error: "Missing required payment fields" }, { status: 400 })
  }

  if (!["once-off", "monthly"].includes(paymentType)) {
    return NextResponse.json({ error: "Invalid paymentType" }, { status: 400 })
  }

  if (packagePrice <= 0) {
    return NextResponse.json({ error: "Invalid packagePrice" }, { status: 400 })
  }

  try {
    const serviceKey = process.env.NETCASH_SERVICE_KEY ?? ""
    if (!serviceKey) {
      console.error("[netcash-pay] NETCASH_SERVICE_KEY is not set")
      return NextResponse.json({ error: "Payment gateway is not configured" }, { status: 503 })
    }

    const { netcashUrl, formFields, orderId } = await buildNetcashPaymentForEnrollment({
      referenceNumber,
      enrollmentId,
      parentName,
      parentEmail,
      packageName,
      packagePrice,
      paymentType,
    })

    if (!netcashUrl || !formFields) {
      return NextResponse.json({ error: "Failed to build payment request" }, { status: 500 })
    }

    return NextResponse.json({ netcashUrl, formFields, orderId })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[netcash-pay] Error building payment:", message)
    return NextResponse.json({ error: "Payment gateway error", detail: message }, { status: 500 })
  }
}
