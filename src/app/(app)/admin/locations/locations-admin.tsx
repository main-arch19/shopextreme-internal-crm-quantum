'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { setLocationActive, upsertLocation } from '../actions'
import { LOCATION_TYPES, type Location, type LocationType } from '@/lib/catalog/types'

export function LocationsAdmin({ locations }: { locations: Location[] }) {
  const router = useRouter()
  const [editing, setEditing] = useState<Location | 'new' | null>(null)

  return (
    <main>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Locations</h1>
        <button
          onClick={() => setEditing('new')}
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
        >
          New location
        </button>
      </div>

      {editing && (
        <LocationForm
          location={editing === 'new' ? null : editing}
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
              <th className="py-2 pr-3 font-medium">Code</th>
              <th className="py-2 pr-3 font-medium">Name</th>
              <th className="py-2 pr-3 font-medium">Type</th>
              <th className="py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {locations.map((location) => (
              <tr
                key={location.id}
                className={`border-b border-neutral-200 last:border-0 dark:border-neutral-800 ${
                  location.is_active ? '' : 'text-neutral-400'
                }`}
              >
                <td className="py-2 pr-3 font-mono">{location.code}</td>
                <td className="py-2 pr-3">{location.name}</td>
                <td className="py-2 pr-3">{location.type}</td>
                <td className="py-2 text-right">
                  <button
                    onClick={() => setEditing(location)}
                    className="mr-3 text-xs text-neutral-500 underline"
                  >
                    Edit
                  </button>
                  <button
                    onClick={async () => {
                      await setLocationActive(location.id, !location.is_active)
                      router.refresh()
                    }}
                    className="text-xs text-neutral-500 underline"
                  >
                    {location.is_active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {locations.length === 0 && (
          <p className="py-6 text-sm text-neutral-500">
            No locations yet. At least one is needed before stock can move.
          </p>
        )}
      </div>
    </main>
  )
}

function LocationForm({
  location,
  onDone,
}: {
  location: Location | null
  onDone: () => void
}) {
  const [code, setCode] = useState(location?.code ?? '')
  const [name, setName] = useState(location?.name ?? '')
  const [type, setType] = useState<LocationType>(location?.type ?? 'warehouse')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    const result = await upsertLocation({
      id: location?.id,
      code: code.toUpperCase().trim(),
      name,
      type,
    })

    setBusy(false)

    if (!result.ok) {
      setError(result.error ?? 'Could not save that location.')
      return
    }

    onDone()
  }

  return (
    <form
      onSubmit={submit}
      className="mt-4 rounded border border-neutral-300 p-4 dark:border-neutral-700"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          Code
          <input
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="WH1"
            className="rounded border border-neutral-300 px-2 py-1.5 font-mono uppercase dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>

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
          Type
          <select
            value={type}
            onChange={(e) => setType(e.target.value as LocationType)}
            className="rounded border border-neutral-300 px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900"
          >
            {LOCATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
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
