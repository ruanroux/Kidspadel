"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Pencil, Plus, CalendarClock, X, PowerOff, RotateCcw } from "lucide-react"
import type { Club } from "@/lib/db/schema"
import { createClub, updateClub, deactivateClub, reactivateClub, type ClubInput } from "@/app/actions/admin"
import { ClubForm } from "@/components/admin/club-form"
import { SlotEditor } from "@/components/admin/slot-editor"

export function AdminClubManager({ initialClubs }: { initialClubs: Club[] }) {
  const router = useRouter()
  const [editing, setEditing] = useState<Club | null>(null)
  const [creating, setCreating] = useState(false)
  const [slotClub, setSlotClub] = useState<Club | null>(null)
  const [pending, startTransition] = useTransition()
  const [filter, setFilter] = useState<"active" | "inactive" | "all">("active")
  const [confirmDeactivate, setConfirmDeactivate] = useState<{ id: number; name: string } | null>(null)
  const [confirmReactivate, setConfirmReactivate] = useState<{ id: number; name: string } | null>(null)

  function handleSave(input: ClubInput, id?: number) {
    startTransition(async () => {
      if (id) {
        await updateClub(id, input)
      } else {
        await createClub(input)
      }
      setEditing(null)
      setCreating(false)
      router.refresh()
    })
  }

  function handleDeactivate(id: number) {
    startTransition(async () => {
      await deactivateClub(id)
      setConfirmDeactivate(null)
      router.refresh()
    })
  }

  function handleReactivate(id: number) {
    startTransition(async () => {
      await reactivateClub(id)
      setConfirmReactivate(null)
      router.refresh()
    })
  }

  const activeClubs = initialClubs.filter((c) => c.published)
  const inactiveClubs = initialClubs.filter((c) => !c.published)
  const visibleClubs =
    filter === "active" ? activeClubs : filter === "inactive" ? inactiveClubs : initialClubs

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-navy">Clubs</h2>
        <button
          onClick={() => {
            setCreating(true)
            setEditing(null)
          }}
          className="inline-flex items-center gap-2 rounded-md bg-lime px-4 py-2 text-sm font-bold text-lime-foreground transition-colors hover:bg-lime/90"
        >
          <Plus className="h-4 w-4" />
          Add Club
        </button>
      </div>

      {/* Filter tabs */}
      <div className="mt-4 flex gap-1 rounded-lg border border-border bg-muted/40 p-1 w-fit">
        {(["active", "inactive", "all"] as const).map((f) => {
          const count = f === "active" ? activeClubs.length : f === "inactive" ? inactiveClubs.length : initialClubs.length
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-4 py-1.5 text-sm font-semibold transition-colors ${filter === f ? "bg-card text-navy shadow-sm" : "text-muted-foreground hover:text-navy"}`}
            >
              {f === "active" ? "Active" : f === "inactive" ? "Inactive" : "All"} ({count})
            </button>
          )
        })}
      </div>

      <div className="mt-4 grid gap-4">
        {visibleClubs.map((club) => (
          <article key={club.id} className={`rounded-card border bg-card p-5 shadow-sm ${!club.published ? "border-dashed border-muted-foreground/30 opacity-80" : "border-border"}`}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-navy">{club.name}</h3>
                  {club.published ? (
                    <span className="rounded-full bg-lime/20 border border-lime/40 px-2 py-0.5 text-xs font-bold text-lime-800">Active</span>
                  ) : (
                    <span className="rounded-full bg-muted border border-muted-foreground/20 px-2 py-0.5 text-xs font-semibold text-muted-foreground">Inactive</span>
                  )}
                </div>
                <p className="text-sm font-semibold text-lime">{club.location}</p>
                <p className="mt-1 text-sm text-muted-foreground">{club.address}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setSlotClub(club)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-navy transition-colors hover:bg-muted"
                >
                  <CalendarClock className="h-4 w-4 text-lime" />
                  Slots
                </button>
                <button
                  onClick={() => {
                    setEditing(club)
                    setCreating(false)
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-navy transition-colors hover:bg-muted"
                >
                  <Pencil className="h-4 w-4 text-lime" />
                  Edit
                </button>
                {club.published ? (
                  <button
                    onClick={() => setConfirmDeactivate({ id: club.id, name: club.name })}
                    disabled={pending}
                    className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-50"
                  >
                    <PowerOff className="h-4 w-4" />
                    Make Inactive
                  </button>
                ) : (
                  <button
                    onClick={() => setConfirmReactivate({ id: club.id, name: club.name })}
                    disabled={pending}
                    className="inline-flex items-center gap-1.5 rounded-md border border-lime/40 bg-lime/10 px-3 py-1.5 text-sm font-semibold text-lime-800 transition-colors hover:bg-lime/20 disabled:opacity-50"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Reactivate
                  </button>
                )}
              </div>
            </div>

            {/* Deactivate confirmation */}
            {confirmDeactivate?.id === club.id && (
              <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-800">
                  Make <strong>{club.name}</strong> Inactive? The club will be hidden from registrations and the coaching portal. All data is preserved.
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => handleDeactivate(club.id)}
                    disabled={pending}
                    className="rounded-md bg-amber-600 px-4 py-1.5 text-sm font-bold text-white disabled:opacity-50 hover:bg-amber-700"
                  >
                    {pending ? "Saving…" : "Yes, make Inactive"}
                  </button>
                  <button
                    onClick={() => setConfirmDeactivate(null)}
                    className="rounded-md border border-border px-4 py-1.5 text-sm font-semibold text-navy hover:bg-muted"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Reactivate confirmation */}
            {confirmReactivate?.id === club.id && (
              <div className="mt-4 rounded-md border border-lime/30 bg-lime/5 p-4">
                <p className="text-sm font-semibold text-navy">
                  Reactivate <strong>{club.name}</strong>? The club will become visible in registrations and the coaching portal again.
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => handleReactivate(club.id)}
                    disabled={pending}
                    className="rounded-md bg-lime px-4 py-1.5 text-sm font-bold text-lime-foreground disabled:opacity-50 hover:bg-lime/90"
                  >
                    {pending ? "Saving…" : "Yes, reactivate"}
                  </button>
                  <button
                    onClick={() => setConfirmReactivate(null)}
                    className="rounded-md border border-border px-4 py-1.5 text-sm font-semibold text-navy hover:bg-muted"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </article>
        ))}
        {visibleClubs.length === 0 && (
          <p className="rounded-card border border-dashed border-border bg-card p-8 text-center text-muted-foreground">
            {filter === "inactive" ? "No inactive clubs." : filter === "active" ? "No active clubs yet. Click \"Add Club\" to create your first one." : "No clubs yet."}
          </p>
        )}
      </div>

      {/* Create / Edit modal */}
      {(creating || editing) && (
        <Modal
          title={editing ? `Edit ${editing.name}` : "Add New Club"}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
        >
          <ClubForm
            club={editing}
            pending={pending}
            onSubmit={(input) => handleSave(input, editing?.id)}
            onCancel={() => {
              setCreating(false)
              setEditing(null)
            }}
          />
        </Modal>
      )}

      {/* Slot editor modal */}
      {slotClub && (
        <Modal title={`Slots — ${slotClub.name}`} onClose={() => setSlotClub(null)} wide>
          <SlotEditor clubId={slotClub.id} />
        </Modal>
      )}
    </div>
  )
}

function Modal({
  title,
  children,
  onClose,
  wide,
}: {
  title: string
  children: React.ReactNode
  onClose: () => void
  wide?: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className={`my-8 w-full rounded-card bg-card p-6 shadow-xl ${wide ? "max-w-3xl" : "max-w-lg"}`}>
        <div className="flex items-center justify-between gap-4 border-b border-border pb-3">
          <h3 className="text-lg font-bold text-navy">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-navy"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  )
}
