/**
 * Pure billing helpers — no server-only code here so this file
 * can be imported by both "use server" action files and client components.
 */

export const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

export const BILLING_START_YEAR = 2026
export const BILLING_START_MONTH = 8  // August
export const BILLING_END_MONTH = 12   // December

export function formatMonth(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`
}

export function getMonthLabel(year: number, month: number): string {
  return formatMonth(year, month)
}
