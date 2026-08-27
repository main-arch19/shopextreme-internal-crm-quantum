'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { setSupplierActive, upsertSupplier } from '../actions'
import type { Supplier } from '@/lib/catalog/types'

export function SuppliersAdmin({ suppliers }: { suppliers: Supplier[] }) {
  const router = useRouter()
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null)

  return (
    <main>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Suppliers</h1>
        <button
          onClick={() => setEditing('new')}
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
        >
          New supplier
        </button>
      </div>

      {editing && (
        <SupplierForm
          supplier={editing === 'new' ? null : editing}
          onDone={() => {
            setEditing(null)
            router.refresh()
          }}
        />
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-300 text-left dark:border-neutral-700">
              <th className="py-2 pr-3 font-medium">Name</th>
              <th className="py-2 pr-3 font-medium">Contact</th>
              <th className="py-2 pr-3 font-medium text-right">Lead time</th>
              <th className="py-2 pr-3 font-medium">Currency</th>
              <th className="py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((supplier) => (
              <tr
                key={supplier.id}
                className={`border-b border-neutral-200 last:border-0 dark:border-neutral-800 ${
                  supplier.is_active ? '' : 'text-neutral-400'
                }`}
              >
                <td className="py-2 pr-3">{supplier.name}</td>
                <td className="py-2 pr-3 text-neutral-600 dark:text-neutral-400">
                  {supplier.contact_name ?? supplier.contact_email ?? '—'}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {supplier.lead_time_days ? (
                    `${supplier.lead_time_days} days`
                  ) : (
                    // Lead time drives the reorder point and the runway
                    // marker. Without it an item cannot be ranked by urgency
                    // at all, so the gap is called out rather than left blank.
                    <span className="text-amber-600 dark:text-amber-400">not set</span>
                  )}
                </td>
                <td className="py-2 pr-3">{supplier.currency}</td>
                <td className="py-2 text-right">
                  <button
                    onClick={() => setEditing(supplier)}
                    className="mr-3 text-xs text-neutral-500 underline"
                  >
                    Edit
                  </button>
                  <button
                    onClick={async () => {
                      await setSupplierActive(supplier.id, !supplier.is_active)
                      router.refresh()
                    }}
                    className="text-xs text-neutral-500 underline"
                  >
                    {supplier.is_active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {suppliers.length === 0 && (
          <p className="py-6 text-sm text-neutral-500">No suppliers yet.</p>
        )}
      </div>
    </main>
  )
}

function SupplierForm({
  supplier,
  onDone,
}: {
  supplier: Supplier | null
  onDone: () => void
}) {
  const [name, setName] = useState(supplier?.name ?? '')
  const [contactName, setContactName] = useState(supplier?.contact_name ?? '')
  const [contactEmail, setContactEmail] = useState(supplier?.contact_email ?? '')
  const [phone, setPhone] = useState(supplier?.phone ?? '')
  const [leadTime, setLeadTime] = useState(supplier?.lead_time_days?.toString() ?? '')
  const [currency, setCurrency] = useState(supplier?.currency ?? 'USD')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    const result = await upsertSupplier({
      id: supplier?.id,
      name,
      contactName: contactName || null,
      contactEmail: contactEmail || null,
      phone: phone || null,
      leadTimeDays: leadTime ? Number(leadTime) : null,
      currency,
    })

    setBusy(false)

    if (!result.ok) {
      setError(result.error ?? 'Could not save that supplier.')
      return
    }

    onDone()
  }

  return (
    <form
      onSubmit={submit}
      className="mt-4 rounded border border-neutral-300 p-4 dark:border-neutral-700"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          Name
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded border border-neutral-300 px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Contact name
          <input
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            className="rounded border border-neutral-300 px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Contact email
          <input
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            className="rounded border border-neutral-300 px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Phone
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="rounded border border-neutral-300 px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Lead time (days)
          <input
            type="number"
            min="1"
            value={leadTime}
            onChange={(e) => setLeadTime(e.target.value)}
            className="rounded border border-neutral-300 px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900"
          />
          <span className="text-xs text-neutral-500">
            How long between ordering and arrival. Reorder urgency depends on this.
          </span>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Currency
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            maxLength={3}
            className="rounded border border-neutral-300 px-2 py-1.5 uppercase dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onDone} className="text-sm text-neutral-500 underline">
          Cancel
        </button>
      </div>
    </form>
  )
}
