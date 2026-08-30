'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { postEntry, resolveScan, searchItems, type ResolvedItem } from '../entry/actions'
import type { AdjustmentDirection } from '@/lib/posting/types'
import { Button, Card, EmptyState, Field, PageTitle, fieldClass } from '@/components/ui'

interface Location {
  id: string
  code: string
  name: string
}

export function Adjustment({ locations }: { locations: Location[] }) {
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '')
  const [term, setTerm] = useState('')
  const [matches, setMatches] = useState<ResolvedItem[]>([])
  const [item, setItem] = useState<ResolvedItem | null>(null)
  const [direction, setDirection] = useState<AdjustmentDirection>('decrease')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const itemRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const query = item ? '' : term.trim()
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
  }, [term, item, locationId])

  function choose(chosen: ResolvedItem) {
    setItem(chosen)
    setMatches([])
    setTerm(chosen.sku)
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

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!item || busy) return

    const qty = Number(quantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      setStatus({ kind: 'error', text: 'Enter a quantity greater than zero.' })
      return
    }

    if (!reason.trim()) {
      setStatus({ kind: 'error', text: 'A reason is required for every adjustment.' })
      return
    }

    setBusy(true)
    const result = await postEntry({
      docType: 'ADJUSTMENT',
      locationId,
      reason,
      lines: [
        {
          item_id: item.item_id,
          quantity: qty,
          unit_cost: item.unit_cost,
          // Quantity stays positive; direction carries the sign. This is what
          // makes a decrease possible at all, and therefore what makes
          // shrinkage measurable (§5.9).
          direction,
        },
      ],
    })
    setBusy(false)

    if (!result.ok) {
      setStatus({ kind: 'error', text: result.error ?? 'Could not post that adjustment.' })
      return
    }

    const verb = direction === 'decrease' ? 'reduced by' : 'increased by'
    setStatus({ kind: 'ok', text: `${result.docNumber} — ${item.sku} ${verb} ${qty}.` })
    setItem(null)
    setTerm('')
    setQuantity('')
    setReason('')
    itemRef.current?.focus()
  }

  // Nothing can be adjusted before a location exists.
  if (locations.length === 0) {
    return (
      <>
        <PageTitle>Adjust stock</PageTitle>
        <Card>
          <EmptyState>
            No locations yet. Add one under{' '}
            <Link href="/admin/locations" className="underline">
              Catalog → Locations
            </Link>{' '}
            before adjusting stock.
          </EmptyState>
        </Card>
      </>
    )
  }

  const projected =
    item && Number.isFinite(Number(quantity)) && quantity !== ''
      ? direction === 'decrease'
        ? item.on_hand - Number(quantity)
        : item.on_hand + Number(quantity)
      : null

  return (
    <>
      <PageTitle>Adjust stock</PageTitle>

      <Card className="max-w-2xl p-4">
        <p className="mb-4 text-sm text-text-secondary">
          Corrects stock that was miscounted, damaged, or found. Every adjustment is recorded
          against your name with the reason you give, and appears in the executive review.
        </p>

        <form onSubmit={submit}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Location">
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className={fieldClass}
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} — {l.name}
                  </option>
                ))}
              </select>
            </Field>

            <div className="relative">
              <Field label="Item">
                <input
                  ref={itemRef}
                  autoFocus
                  autoComplete="off"
                  placeholder="Scan or search"
                  value={term}
                  onChange={(e) => {
                    const value = e.target.value
                    setTerm(value)
                    if (item) setItem(null)
                    if (value.trim().length < 2) setMatches([])
                  }}
                  onKeyDown={onItemKeyDown}
                  className={fieldClass}
                />
              </Field>

              {matches.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-line bg-surface-card shadow">
                  {matches.map((m) => (
                    <li key={m.item_id}>
                      <button
                        type="button"
                        onClick={() => choose(m)}
                        className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-subtle"
                      >
                        <span className="font-mono">{m.sku}</span>
                        <span className="flex-1 truncate text-text-secondary">{m.name}</span>
                        <span className="tabular-nums text-text-muted">{m.on_hand}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {item && (
            <div className="mt-4 rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-baseline gap-2 text-sm">
                <span className="font-mono">{item.sku}</span>
                <span className="flex-1 truncate text-text-secondary">{item.name}</span>
                <span className="tabular-nums text-text-secondary">
                  {item.on_hand} on hand now
                </span>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Direction">
                  {/* An explicit choice rather than a minus sign. Entered
                      quantities stay positive everywhere in this system. */}
                  <div className="flex gap-1 rounded-lg border border-line p-0.5">
                    {(['decrease', 'increase'] as AdjustmentDirection[]).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setDirection(d)}
                        className={`flex-1 rounded px-3 py-2 text-sm capitalize transition-colors ${
                          direction === d
                            ? 'bg-accent text-accent-fg'
                            : 'text-text-secondary hover:bg-surface-subtle'
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </Field>

                <Field
                  label="Quantity"
                  hint={
                    projected !== null
                      ? `On hand becomes ${projected}${projected < 0 ? ' — negative, which means a receipt is missing' : ''}`
                      : undefined
                  }
                >
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    className={fieldClass}
                  />
                </Field>
              </div>

              <div className="mt-3">
                <Field
                  label="Reason (required)"
                  hint="Recorded permanently against your name. Say what happened, not just that something changed."
                >
                  <input
                    required
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Damaged in transit, found during stocktake…"
                    className={fieldClass}
                  />
                </Field>
              </div>

              <Button type="submit" disabled={busy} className="mt-4 w-full">
                {busy ? 'Posting…' : 'Post adjustment'}
              </Button>
            </div>
          )}
        </form>

        {status && (
          <p
            role="status"
            aria-live="polite"
            className={`mt-4 text-sm ${status.kind === 'ok' ? 'text-success' : 'text-danger'}`}
          >
            {status.text}
          </p>
        )}
      </Card>
    </>
  )
}
