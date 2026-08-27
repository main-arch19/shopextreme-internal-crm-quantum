'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createItem, setItemActive } from '../actions'
import { ImportPanel } from '../import-panel'
import { ITEM_UNITS, SKU_PREFIX_PATTERN, type Item, type ItemUnit, type Supplier } from '@/lib/catalog/types'

export function ItemsAdmin({ items, suppliers }: { items: Item[]; suppliers: Supplier[] }) {
  const router = useRouter()
  const [showNew, setShowNew] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showInactive, setShowInactive] = useState(false)

  const visible = showInactive ? items : items.filter((i) => i.is_active)

  return (
    <main>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Items</h1>
        <div className="flex gap-2 text-sm">
          <button
            onClick={() => setShowImport((v) => !v)}
            className="rounded border border-neutral-300 px-3 py-1.5 dark:border-neutral-700"
          >
            Import CSV
          </button>
          <Link
            href="/admin/items/labels"
            className="rounded border border-neutral-300 px-3 py-1.5 dark:border-neutral-700"
          >
            Print labels
          </Link>
          <button
            onClick={() => setShowNew((v) => !v)}
            className="rounded bg-neutral-900 px-3 py-1.5 text-white dark:bg-neutral-100 dark:text-neutral-900"
          >
            New item
          </button>
        </div>
      </div>

      {showImport && (
        <ImportPanel
          onDone={() => {
            setShowImport(false)
            router.refresh()
          }}
        />
      )}

      {showNew && (
        <NewItemForm
          suppliers={suppliers}
          onDone={() => {
            setShowNew(false)
            router.refresh()
          }}
        />
      )}

      <label className="mt-4 flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
        <input
          type="checkbox"
          checked={showInactive}
          onChange={(e) => setShowInactive(e.target.checked)}
        />
        Show deactivated
      </label>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-300 text-left dark:border-neutral-700">
              <th className="py-2 pr-3 font-medium">SKU</th>
              <th className="py-2 pr-3 font-medium">Name</th>
              <th className="py-2 pr-3 font-medium">Unit</th>
              <th className="py-2 pr-3 font-medium text-right">Cost</th>
              <th className="py-2 pr-3 font-medium text-right">Price</th>
              <th className="py-2 pr-3 font-medium">Supplier</th>
              <th className="py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => (
              <tr
                key={item.id}
                className={`border-b border-neutral-200 last:border-0 dark:border-neutral-800 ${
                  item.is_active ? '' : 'text-neutral-400'
                }`}
              >
                <td className="py-2 pr-3 font-mono">
                  {item.sku}
                  {item.is_serialized && (
                    <span className="ml-1 text-xs text-neutral-500">serial</span>
                  )}
                </td>
                <td className="py-2 pr-3">{item.name}</td>
                <td className="py-2 pr-3">{item.unit}</td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {item.unit_cost ?? '—'}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {item.sell_price ?? '—'}
                </td>
                <td className="py-2 pr-3 text-neutral-600 dark:text-neutral-400">
                  {suppliers.find((s) => s.id === item.supplier_id)?.name ?? '—'}
                </td>
                <td className="py-2 text-right">
                  <button
                    onClick={async () => {
                      await setItemActive(item.id, !item.is_active)
                      router.refresh()
                    }}
                    className="text-xs text-neutral-500 underline"
                  >
                    {item.is_active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {visible.length === 0 && (
          <p className="py-6 text-sm text-neutral-500">
            No items yet. Create one, or import a spreadsheet.
          </p>
        )}
      </div>
    </main>
  )
}

function NewItemForm({
  suppliers,
  onDone,
}: {
  suppliers: Supplier[]
  onDone: () => void
}) {
  const [prefix, setPrefix] = useState('')
  const [name, setName] = useState('')
  const [unit, setUnit] = useState<ItemUnit>('each')
  const [isSerialized, setIsSerialized] = useState(false)
  const [unitCost, setUnitCost] = useState('')
  const [sellPrice, setSellPrice] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()

    const cleanPrefix = prefix.toUpperCase().trim()
    if (!SKU_PREFIX_PATTERN.test(cleanPrefix)) {
      setError('The prefix must be two to six letters, for example MUG.')
      return
    }

    setBusy(true)
    setError(null)

    const result = await createItem({
      prefix: cleanPrefix,
      name,
      // A serialized item is counted in whole units by definition, so the
      // form forces "each" rather than letting the database reject it later.
      unit: isSerialized ? 'each' : unit,
      unitCost: unitCost ? Number(unitCost) : null,
      sellPrice: sellPrice ? Number(sellPrice) : null,
      supplierId: supplierId || null,
      isSerialized,
      unitsPerCase: 1,
    })

    setBusy(false)

    if (!result.ok) {
      setError(result.error ?? 'Could not create the item.')
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
          SKU prefix
          <input
            required
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            placeholder="MUG"
            className="rounded border border-neutral-300 px-2 py-1.5 font-mono uppercase dark:border-neutral-700 dark:bg-neutral-900"
          />
          <span className="text-xs text-neutral-500">
            The number is assigned automatically — MUG becomes MUG-0001.
          </span>
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
          Unit
          <select
            value={isSerialized ? 'each' : unit}
            disabled={isSerialized}
            onChange={(e) => setUnit(e.target.value as ItemUnit)}
            className="rounded border border-neutral-300 px-2 py-1.5 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900"
          >
            {ITEM_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Supplier
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="rounded border border-neutral-300 px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="">—</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Unit cost
          <input
            type="number"
            step="0.01"
            min="0"
            value={unitCost}
            onChange={(e) => setUnitCost(e.target.value)}
            className="rounded border border-neutral-300 px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900"
          />
          <span className="text-xs text-neutral-500">
            Without it, stock value and margin stay blank.
          </span>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Sell price
          <input
            type="number"
            step="0.01"
            min="0"
            value={sellPrice}
            onChange={(e) => setSellPrice(e.target.value)}
            className="rounded border border-neutral-300 px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isSerialized}
          onChange={(e) => setIsSerialized(e.target.checked)}
        />
        Track individual serial numbers
      </label>
      {isSerialized && (
        <p className="mt-1 text-xs text-neutral-500">
          Every movement of this item will need a serial scanned per unit.
        </p>
      )}

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
          {busy ? 'Creating…' : 'Create item'}
        </button>
        <button type="button" onClick={onDone} className="text-sm text-neutral-500 underline">
          Cancel
        </button>
      </div>
    </form>
  )
}
