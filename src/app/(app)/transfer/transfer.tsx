'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { checkSerial, postEntry, resolveScan, searchItems, type ResolvedItem } from '../entry/actions'
import { Button, Card, EmptyState, Field, PageTitle, fieldClass } from '@/components/ui'

interface Location {
  id: string
  code: string
  name: string
}

interface Line {
  key: string
  item: ResolvedItem
  quantity: number
  serial?: string
}

export function Transfer({ locations }: { locations: Location[] }) {
  const [fromId, setFromId] = useState(locations[0]?.id ?? '')
  const [toId, setToId] = useState(locations[1]?.id ?? '')
  const [term, setTerm] = useState('')
  const [matches, setMatches] = useState<ResolvedItem[]>([])
  const [pending, setPending] = useState<ResolvedItem | null>(null)
  const [quantity, setQuantity] = useState('')
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
      const results = await searchItems(query, fromId || null)
      if (current) setMatches(results)
    }, 120)

    return () => {
      current = false
      clearTimeout(handle)
    }
  }, [term, pending, fromId])

  function choose(chosen: ResolvedItem) {
    setPending(chosen)
    setMatches([])
    setTerm(chosen.sku)
    setQuantity('')
    setSerialInput('')
  }

  async function onItemKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    event.preventDefault()

    const code = term.trim()
    if (!code) return

    const scanned = await resolveScan(code, fromId || null)
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
      setStatus({ kind: 'error', text: `${value} is already on this transfer.` })
      setSerialInput('')
      return
    }

    // Validated against its current location, so a serial that is not at the
    // source is rejected at scan time rather than after forty more scans.
    const check = await checkSerial(pending.item_id, value, 'TRANSFER', fromId)
    setSerialInput('')

    if (!check.acceptable) {
      setStatus({ kind: 'error', text: check.message })
      return
    }

    addLine({ serial: check.serial })
  }

  async function post() {
    if (lines.length === 0 || busy) return

    if (fromId === toId) {
      setStatus({ kind: 'error', text: 'Choose two different locations.' })
      return
    }

    setBusy(true)
    const result = await postEntry({
      docType: 'TRANSFER',
      locationId: fromId,
      toLocationId: toId,
      lines: lines.map((l) => ({
        item_id: l.item.item_id,
        quantity: l.quantity,
        unit_cost: l.item.unit_cost,
        serial: l.serial ?? null,
      })),
    })
    setBusy(false)

    if (!result.ok) {
      setStatus({ kind: 'error', text: result.error ?? 'Could not post that transfer.' })
      return
    }

    const from = locations.find((l) => l.id === fromId)?.code
    const to = locations.find((l) => l.id === toId)?.code
    setStatus({
      kind: 'ok',
      text: `${result.docNumber} posted — ${lines.length} line(s) moved from ${from} to ${to}.`,
    })
    setLines([])
    setPending(null)
    setTerm('')
  }

  // A transfer needs somewhere to go.
  if (locations.length < 2) {
    return (
      <>
        <PageTitle>Transfer stock</PageTitle>
        <Card>
          <EmptyState>
            Transfers need at least two locations.{' '}
            <Link href="/admin/locations" className="underline">
              Add another under Catalog → Locations
            </Link>
            .
          </EmptyState>
        </Card>
      </>
    )
  }

  const sameLocation = fromId === toId

  return (
    <>
      <PageTitle>Transfer stock</PageTitle>

      <Card className="max-w-3xl p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From">
            <select
              value={fromId}
              onChange={(e) => setFromId(e.target.value)}
              className={fieldClass}
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} — {l.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="To">
            <select value={toId} onChange={(e) => setToId(e.target.value)} className={fieldClass}>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} — {l.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {sameLocation && (
          <p className="mt-2 text-sm text-danger">
            Source and destination must be different.
          </p>
        )}

        <div className="relative mt-4">
          <input
            ref={itemRef}
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
            className={fieldClass}
          />

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

        {pending && (
          <div className="mt-3 rounded-lg border border-line p-3">
            <div className="flex items-baseline gap-2 text-sm">
              <span className="font-mono">{pending.sku}</span>
              <span className="flex-1 truncate text-text-secondary">{pending.name}</span>
              <span className="tabular-nums text-text-muted">{pending.on_hand} at source</span>
            </div>

            {pending.is_serialized ? (
              <input
                ref={serialRef}
                autoComplete="off"
                placeholder="Scan serial, then the next"
                value={serialInput}
                onChange={(e) => setSerialInput(e.target.value)}
                onKeyDown={onSerialKeyDown}
                className={`${fieldClass} mt-2`}
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
                  className={fieldClass}
                />
                <Button type="button" variant="secondary" onClick={() => addLine()}>
                  Add
                </Button>
              </div>
            )}
          </div>
        )}

        {lines.length > 0 && (
          <div className="mt-4">
            <ul className="text-sm">
              {lines.map((line) => (
                <li
                  key={line.key}
                  className="flex items-baseline justify-between gap-3 border-b border-line py-2 last:border-0"
                >
                  <span className="font-mono">{line.item.sku}</span>
                  {line.serial && (
                    <span className="font-mono text-text-muted">{line.serial}</span>
                  )}
                  <span className="flex-1 truncate text-text-secondary">{line.item.name}</span>
                  <span className="tabular-nums">{line.quantity}</span>
                  <button
                    onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                    aria-label={`Remove ${line.item.sku}`}
                    className="text-text-muted hover:text-text-primary"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>

            <div className="mt-3 flex items-center justify-between">
              <span className="text-sm text-text-secondary">{lines.length} line(s)</span>
              <Button onClick={() => void post()} disabled={busy || sameLocation}>
                {busy ? 'Posting…' : 'Post transfer'}
              </Button>
            </div>
          </div>
        )}

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
