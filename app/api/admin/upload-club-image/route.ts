import { type NextRequest, NextResponse } from "next/server"
import { put } from "@vercel/blob"
import { isAdminAuthenticated } from "@/lib/admin-auth"

export async function POST(request: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const formData = await request.formData()
  const file = formData.get("file") as File | null

  if (!file || file.size === 0) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 })
  }

  const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"]
  if (!allowed.includes(file.type)) {
    return NextResponse.json({ error: "Only JPEG, PNG, WebP and GIF are supported" }, { status: 400 })
  }

  if (file.size > 4 * 1024 * 1024) {
    return NextResponse.json({ error: "Image must be under 4 MB" }, { status: 400 })
  }

  const ext = file.name.split(".").pop() ?? "jpg"
  const randomSuffix = Math.random().toString(36).slice(2, 7)
  const filename = `clubs/${Date.now()}-${randomSuffix}.${ext}`

  const blob = await put(filename, file, {
    access: "public",
    contentType: file.type,
  })

  // Return the full public blob URL — stored directly in the DB, no proxy needed
  return NextResponse.json({ url: blob.url })
}
