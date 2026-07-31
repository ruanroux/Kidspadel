"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { getPublicPackageSlotAvailability } from "@/app/actions/packages"
import { formatHour, formatEndHour, WEEKDAYS } from "@/lib/slots"
import type { SelectedSlot } from "@/components/slot-picker"
import type { CustomSlotWithAvailability } from "@/app/actions/packages"

export function PackageSlotPicker({
  packageId,
  packageName,
  ageGroup,
  clubId,
  selected,
  disabledWeekday,
  onSelect,
}: {
  packageId: number
  packageName: string
  ageGroup: string
  /** The club the customer selected — slots are filtered to this club. */
  clubId?: number
  selected: SelectedSlot | null
  /** Weekday number (0–6) to disable — used for the second session to prevent same-day booking. */
  disabledWeekday?: number
  onSelect: (slot: SelectedSlot) => void
}) {
  const [slots, setSlots] = useState<CustomSlotWithAvailability[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    getPublicPackageSlotAvailability(packageId, packageName, ageGroup, clubId)
      .then((data) => { if (active) setSlots(data) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [packageId, packageName, ageGroup, clubId])

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading available times…
      </div>
    )
  }

  const offered = (slots ?? []).filter((s) => s.capacity > 0)

  if (offered.length === 0) {
    return (
      <p className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        No time slots have been set up for this package yet. Please contact us.
      </p>
    )
  }

  const byWeekday = new Map<number, CustomSlotWithAvailability[]>()
  for (const s of offered) {
    if (!byWeekday.has(s.weekday)) byWeekday.set(s.weekday, [])
    byWeekday.get(s.weekday)!.push(s)
  }
  const weekdayOrder = [1, 2, 3, 4, 5, 6, 0]
  const orderedWeekdays = weekdayOrder.filter((w) => byWeekday.has(w))

  return (
    <div className="space-y-5">
      {orderedWeekdays.map((wd) => (
        <div key={wd}>
          <p className="text-sm font-semibold text-navy">{WEEKDAYS[wd]}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {byWeekday
              .get(wd)!
              .sort((a, b) => Number(a.hour) - Number(b.hour))
              .map((s) => {
                const hourNum = Number(s.hour)
                const isSelected = selected?.weekday === s.weekday && selected?.hour === hourNum
                const isFull = s.remaining <= 0
                const isSameDay = disabledWeekday !== undefined && s.weekday === disabledWeekday
                const isDisabled = isFull || isSameDay

                return (
                  <button
                    key={`${s.weekday}-${s.hour}`}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => !isDisabled && onSelect({ weekday: s.weekday, hour: hourNum })}
                    className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                      isDisabled
                        ? "cursor-not-allowed border-border bg-muted/40 opacity-50"
                        : isSelected
                          ? "border-lime bg-lime/15 text-navy"
                          : "border-border bg-card text-navy hover:border-lime/60"
                    }`}
                  >
                    <span className="font-semibold">{formatHour(hourNum)} – {formatEndHour(hourNum)}</span>
                    {isFull ? (
                      <span className="ml-2 text-xs text-muted-foreground">Full</span>
                    ) : isSameDay ? (
                      <span className="ml-2 text-xs text-muted-foreground">Same day</span>
                    ) : (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {s.remaining} / {s.capacity} spot{s.capacity !== 1 ? "s" : ""} left
                      </span>
                    )}
                  </button>
                )
              })}
          </div>
        </div>
      ))}
    </div>
  )
}
