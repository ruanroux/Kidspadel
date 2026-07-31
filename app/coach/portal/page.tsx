import { redirect } from "next/navigation"
import { getCoachSession } from "@/lib/coach-auth"
import { selfGetEnrollments, selfGetAttendance, selfGetAttendanceHistory } from "@/app/actions/coach-portal-self"
import { CoachPortalView } from "@/components/coach/coach-portal-view"

export const metadata = {
  title: "Coach Portal | Next Gen Padel Academy",
}

export default async function CoachPortalPage() {
  const session = await getCoachSession()
  if (!session) redirect("/coach/login")

  // Load coach profile from DB
  const { Pool } = require("pg")
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  let coachName = "Coach"
  let coachEmail = ""
  try {
    const res = await pool.query(
      'SELECT name, email FROM coaches WHERE id = $1 LIMIT 1',
      [session.coachId]
    )
    coachName = res.rows[0]?.name ?? "Coach"
    coachEmail = res.rows[0]?.email ?? session.email
  } finally {
    await pool.end()
  }

  const [enrollments, attendance, history] = await Promise.all([
    selfGetEnrollments(),
    selfGetAttendance(0),
    selfGetAttendanceHistory(),
  ])

  return (
    <CoachPortalView
      coachId={session.coachId}
      coachName={coachName}
      coachEmail={coachEmail}
      initialEnrollments={enrollments}
      initialAttendance={attendance}
      initialHistory={history}
    />
  )
}
