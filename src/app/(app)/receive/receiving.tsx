'use client'

import { useEffect, useRef, useState } from 'react'
import {
  checkSerial,
  postEntry,
  resolveScan,
  searchItems,
  type ResolvedItem,
} from '../entry/actions'

interface Named {
  id: string
  code?: string
  name: string
}

interface Line {
  key: string
  item: ResolvedItem
  quantity: number
  unitCost: number | null
  serial?: string
}

export function Receiving({
  locations,
  suppliers,
}: {
  locations: Named[]
  suppliers: Named[]
}) {
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '')
  const [supplierId, setSupplierId] = useState('')
  const [reference, setReference] = useState('')

  const [term, setTerm] = useState('')
  const [matches, setMatches] = useState<ResolvedItem[]>([])
  const [pending, setPending] = useState<ResolvedItem | null>(null)
  const [quantity, setQuantity] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [serialInput, setSerialInput] = useState('')

  const [lines, setLines] = useState<Line[]>([])
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const itemRef = useRef<HTMLInputElement>(null)
  const quantityRef = useRef<HTMLInputElement>(null)
  const serialRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!pending) itemRef.current?.focus()
    else if (pending.is_serialized) serialRef.current?.focus()
    else quantityRef.current?.focus()
  }, [pending])

  useEffect(() => {
    const query = pending ? '' : term.trim()
    if (query.length < 2) return

    let current = true
    const handle = setTimeout(async () => {
      const results = await searchItems(query, locationId || null)
      if (current) setMatches(results)
    }, 120)

    return () => {
      current = false
      clearTimeout(handle)
    }
  }, [term, pending, locationId])

  function choose(item: ResolvedItem) {
    setPending(item)
    setMatches([])
    setTerm(item.sku)
    setUnitCost(item.unit_cost?.toString() ?? '')
    setQuantity('')
    setSerialInput('')
  }

  async function onItemKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    event.preventDefault()

    const code = term.trim()
    if (!code) return

    const scanned = await resolveScan(code, locationId || null)
    if (scanned) return choose(scanned)
    if (matches.length > 0) return choose(matches[0])

    setStatus({ kind: 'error', text: `Nothing matches "${code}".` })
  }

  function addLine(extra?: { serial: string }) {
    if (!pending) return

    const qty = pending.is_serialized ? 1 : Number(quantity)
    if (!pending.is_serialized && (!Number.isFinite(qty) || qty <= 0)) {
      setStatus({ kind: 'error', text: 'Enter a quantity greater than zero.' })
      return
    }

    setLines((prev) => [
      ...prev,
      {
        key: `${pending.item_id}-${extra?.serial ?? Date.now()}`,
        item: pending,
        quantity: qty,
        unitCost: unitCost ? Number(unitCost) : null,
        serial: extra?.serial,
      },
    ])

    if (!pending.is_serialized) {
      setPending(null)
      setTerm('')
      setQuantity('')
    }

    setStatus(null)
  }

  async function onSerialKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    event.preventDefault()

    const value = serialInput.trim()
    if (!value || !pending) return

    if (lines.some((l) => l.serial?.toUpperCase() === value.toUpperCase())) {
      setStatus({ kind: 'error', text: `${value} is already on this receipt.` })
      setSerialInput('')
      return
    }

    const check = await checkSerial(pending.item_id, value, 'RECEIPT', locationId)
    setSerialInput('')

    if (!check.acceptable) {
      setStatus({ kind: 'error', text: check.message })
      return
    }

    addLine({ serial: check.serial })
  }

  async function post() {
    if (lines.length === 0 || busy) return

    setBusy(true)
    const result = await postEntry({
      docType: 'RECEIPT',
      locationId,
      supplierId: supplierId || null,
      reference: reference || null,
      lines: lines.map((l) => ({
        item_id: l.item.item_id,
        quantity: l.quantity,
        unit_cost: l.unitCost,
        serial: l.serial ?? null,
      })),
    })
    setBusy(false)

    if (!result.ok) {
      setStatus({ kind: 'error', text: result.error ?? 'Could not post that receipt.' })
      return
    }

    setStatus({
      kind: 'ok',
      text: `${result.docNumber} posted — ${lines.length} line(s).`,
    })
    setLines([])
    setPending(null)
    setTerm('')
    setReference('')
  }

  const total = lines.reduce((sum, l) => sum + l.quantity * (l.unitCost ?? 0), 0)

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-lg font-semibold">Receive stock</h1>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <label className="text-sm">
          <span className="sr-only">Location</span>
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="w-full rounded border border-neutral-300 px-2 py-2 dark:border-neutral-700 dark:bg-neutral-900"
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} — {l.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="sr-only">Supplier</span>
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="w-full rounded border border-neutral-300 px-2 py-2 dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="">Supplier —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="Their invoice number"
          className="rounded border border-neutral-300 px-2 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
      </div>

      <div className="relative mt-4">
        <input
          ref={itemRef}
          autoFocus
          autoComplete="off"
          placeholder="Scan or search an item"
          value={term}
          onChange={(e) => {
            const value = e.target.value
            setTerm(value)
            if (pending) setPending(null)
            if (value.trim().length < 2) setMatches([])
          }}
          onKeyDown={onItemKeyDown}
          className="w-full rounded border border-neutral-300 px-3 py-3 text-base focus:outline-2 focus:outline-offset-2 focus:outline-blue-600 dark:border-neutral-700 dark:bg-neutral-900"
        />

        {matches.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded border border-neutral-300 bg-white shadow dark:border-neutral-700 dark:bg-neutral-900">
            {matches.map((m) => (
              <li key={m.item_id}>
                <button
                  onClick={() => choose(m)}
                  className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  <span className="font-mono">{m.sku}</span>
                  <span className="flex-1 truncate text-neutral-600 dark:text-neutral-400">
                    {m.name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {pending && (
        <div className="mt-3 rounded border border-neutral-300 p-3 dark:border-neutral-700">
          <div className="flex items-baseline gap-2 text-sm">
            <span className="font-mono">{pending.sku}</span>
            <span className="flex-1 truncate text-neutral-600 dark:text-neutral-400">
              {pending.name}
            </span>
          </div>

          {pending.is_serialized ? (
            <input
              ref={serialRef}
              autoComplete="off"
              placeholder="Scan serial, then the next"
              value={serialInput}
              onChange={(e) => setSerialInput(e.target.value)}
              onKeyDown={onSerialKeyDown}
              className="mt-2 w-full rounded border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
            />
          ) : (
            <div className="mt-2 flex gap-2">
              <input
                ref={quantityRef}
                type="number"
                min="0"
                step="any"
                placeholder="Quantity"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addLine()
                  }
                }}
                className="flex-1 rounded border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
              />
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Unit cost"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                className="w-32 rounded border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
              />
              <button
                onClick={() => addLine()}
                className="rounded border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700"
              >
                Add
              </button>
            </div>
          )}
        </div>
      )}

      {lines.length > 0 && (
        <div className="mt-4">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-300 text-left dark:border-neutral-700">
                <th className="py-2 pr-3 font-medium">Item</th>
                <th className="py-2 pr-3 font-medium">Serial</th>
                <th className="py-2 pr-3 text-right font-medium">Qty</th>
                <th className="py-2 pr-3 text-right font-medium">Cost</th>
                <th className="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr
                  key={line.key}
                  className="border-b border-neutral-200 last:border-0 dark:border-neutral-800"
                >
                  <td className="py-2 pr-3 font-mono">{line.item.sku}</td>
                  <td className="py-2 pr-3 font-mono text-neutral-600 dark:text-neutral-400">
                    {line.serial ?? '—'}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{line.quantity}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {line.unitCost?.toFixed(2) ?? '—'}
                  </td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                      aria-label={`Remove ${line.item.sku}`}
                      className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-3 flex items-center justify-between">
            <span className="text-sm text-neutral-600 dark:text-neutral-400">
              {lines.length} line(s)
              {total > 0 && ` · ${total.toFixed(2)} total`}
            </span>
            <button
              onClick={() => void post()}
              disabled={busy}
              className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {busy ? 'Posting…' : 'Post receipt'}
            </button>
          </div>
        </div>
      )}

      {status && (
        <p
          role="status"
          aria-live="polite"
          className={`mt-4 text-sm ${
            status.kind === 'ok'
              ? 'text-green-700 dark:text-green-400'
              : 'text-red-600 dark:text-red-400'
          }`}
        >
          {status.text}
        </p>
      )}
    </main>
  )
}
