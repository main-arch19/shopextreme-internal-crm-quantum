'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  checkSerial,
  postEntry,
  resolveScan,
  searchItems,
  type ResolvedItem,
} from './actions'
import type { DocType, IssueReason } from '@/lib/posting/types'

interface Location {
  id: string
  code: string
  name: string
}

interface PendingSerial {
  serial: string
  ok: boolean
  message: string
}

type Stage = 'item' | 'quantity' | 'serials'

const LAST_LOCATION_KEY = 'entry.lastLocation'
const LAST_MODE_KEY = 'entry.lastMode'

/**
 * Reads a remembered default. Returns the fallback when storage is blocked
 * (private browsing, site data disabled) or holds something stale.
 */
function readStored<T extends string>(key: string, fallback: T, allowed: (v: string) => boolean): T {
  if (typeof window === 'undefined') return fallback
  try {
    const saved = localStorage.getItem(key)
    return saved && allowed(saved) ? (saved as T) : fallback
  } catch {
    return fallback
  }
}

export function QuickEntry({ locations }: { locations: Location[] }) {
  // Lazy initializers rather than an effect: the remembered value is the
  // first value, so the screen never renders a default and then visibly
  // swaps it. On this screen a flicker is not cosmetic — it lands under
  // someone already typing.
  const [mode, setMode] = useState<DocType>(() =>
    readStored<DocType>(LAST_MODE_KEY, 'ISSUE', (v) => v === 'RECEIPT' || v === 'ISSUE'),
  )
  const [locationId, setLocationId] = useState(() =>
    readStored(LAST_LOCATION_KEY, locations[0]?.id ?? '', (v) =>
      locations.some((l) => l.id === v),
    ),
  )
  const [issueReason, setIssueReason] = useState<IssueReason>('sale')

  const [stage, setStage] = useState<Stage>('item')
  const [term, setTerm] = useState('')
  const [matches, setMatches] = useState<ResolvedItem[]>([])
  const [item, setItem] = useState<ResolvedItem | null>(null)
  const [quantity, setQuantity] = useState('')

  const [serialInput, setSerialInput] = useState('')
  const [serials, setSerials] = useState<PendingSerial[]>([])

  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const itemRef = useRef<HTMLInputElement>(null)
  const quantityRef = useRef<HTMLInputElement>(null)
  const serialRef = useRef<HTMLInputElement>(null)

  // Persist the remembered defaults. The person receiving goods works the
  // same location every day; making them re-choose it each time is exactly
  // the friction that pushes people back to paper (§3).
  useEffect(() => {
    try {
      if (locationId) localStorage.setItem(LAST_LOCATION_KEY, locationId)
      localStorage.setItem(LAST_MODE_KEY, mode)
    } catch {
      /* ignore */
    }
  }, [locationId, mode])

  // Focus follows the stage, always. No mouse at any point in the happy path.
  useEffect(() => {
    if (stage === 'item') itemRef.current?.focus()
    else if (stage === 'quantity') quantityRef.current?.focus()
    else serialRef.current?.focus()
  }, [stage])

  const reset = useCallback(() => {
    setItem(null)
    setTerm('')
    setMatches([])
    setQuantity('')
    setSerialInput('')
    setSerials([])
    setStage('item')
  }, [])

  // Search-as-you-type, debounced just enough to avoid a request per keystroke
  // without the list ever feeling behind the typing.
  //
  // The stale-response guard matters here: a slow request for "MU" must not
  // overwrite a fast one for "MUG-12". Out-of-order results would show the
  // wrong item under the cursor at the exact moment someone presses Enter.
  useEffect(() => {
    const query = stage === 'item' ? term.trim() : ''
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
  }, [term, stage, locationId])

  async function selectItem(chosen: ResolvedItem) {
    setItem(chosen)
    setMatches([])
    setTerm(chosen.sku)
    setStage(chosen.is_serialized ? 'serials' : 'quantity')
    if (!chosen.is_serialized) setQuantity('')
  }

  async function onItemKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    event.preventDefault()

    const code = term.trim()
    if (!code) return

    // A scanner types the whole code and sends Enter, so an exact match is
    // tried first and only falls back to the ranked list for typed input.
    const scanned = await resolveScan(code, locationId || null)
    if (scanned) {
      await selectItem(scanned)
      return
    }

    if (matches.length > 0) {
      await selectItem(matches[0])
      return
    }

    setStatus({ kind: 'error', text: `Nothing matches "${code}".` })
  }

  async function onSerialKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    event.preventDefault()

    const value = serialInput.trim()
    if (!value || !item) return

    if (serials.some((s) => s.serial.toUpperCase() === value.toUpperCase())) {
      setStatus({ kind: 'error', text: `${value} is already in this list.` })
      setSerialInput('')
      return
    }

    const check = await checkSerial(item.item_id, value, mode, locationId)

    setSerials((prev) => [
      ...prev,
      { serial: check.serial, ok: check.acceptable, message: check.message },
    ])
    setSerialInput('')

    // Deliberately does not steal focus or clear the list on a bad scan — the
    // counter keeps scanning and fixes the rejected one at the end.
    if (!check.acceptable) {
      setStatus({ kind: 'error', text: check.message })
    } else {
      setStatus(null)
    }
  }

  async function submit() {
    if (!item || !locationId || busy) return

    const isSerial = item.is_serialized
    const accepted = serials.filter((s) => s.ok)

    if (isSerial && accepted.length === 0) {
      setStatus({ kind: 'error', text: 'Scan at least one valid serial.' })
      return
    }

    const qty = Number(quantity)
    if (!isSerial && (!Number.isFinite(qty) || qty <= 0)) {
      setStatus({ kind: 'error', text: 'Enter a quantity greater than zero.' })
      return
    }

    setBusy(true)

    const result = await postEntry({
      docType: mode,
      locationId,
      issueReason: mode === 'ISSUE' ? issueReason : null,
      lines: isSerial
        ? accepted.map((s) => ({
            item_id: item.item_id,
            quantity: 1,
            unit_cost: item.unit_cost,
            serial: s.serial,
          }))
        : [{ item_id: item.item_id, quantity: qty, unit_cost: item.unit_cost }],
    })

    setBusy(false)

    if (!result.ok) {
      setStatus({ kind: 'error', text: result.error ?? 'Could not post that entry.' })
      return
    }

    const count = isSerial ? `${accepted.length} × ` : `${qty} × `
    setStatus({ kind: 'ok', text: `${result.docNumber} — ${count}${item.sku} posted.` })
    reset()
  }

  const verb = mode === 'RECEIPT' ? 'Receive' : 'Issue'

  return (
    <main className="mx-auto max-w-xl px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Quick entry</h1>
        <div className="flex gap-1 rounded border border-neutral-300 p-0.5 dark:border-neutral-700">
          {(['ISSUE', 'RECEIPT'] as DocType[]).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m)
                reset()
              }}
              className={`rounded px-3 py-1.5 text-sm ${
                mode === m
                  ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                  : ''
              }`}
            >
              {m === 'ISSUE' ? 'Issue' : 'Receive'}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <label className="flex-1 text-sm">
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

        {mode === 'ISSUE' && (
          <label className="flex-1 text-sm">
            <span className="sr-only">Reason</span>
            <select
              value={issueReason}
              onChange={(e) => setIssueReason(e.target.value as IssueReason)}
              className="w-full rounded border border-neutral-300 px-2 py-2 dark:border-neutral-700 dark:bg-neutral-900"
            >
              <option value="sale">Sale</option>
              <option value="internal">Internal use</option>
              <option value="sample">Sample</option>
              <option value="damage">Damage</option>
              <option value="writeoff">Write-off</option>
            </select>
          </label>
        )}
      </div>

      {/* Item field. Autofocused, and a scanner's Enter posts straight through. */}
      <div className="relative mt-4">
        <input
          ref={itemRef}
          autoFocus
          inputMode="search"
          autoComplete="off"
          placeholder="Scan a barcode or type a SKU"
          value={term}
          onChange={(e) => {
            const value = e.target.value
            setTerm(value)
            if (item) setItem(null)
            // Cleared in the handler rather than the search effect, so a
            // short term hides the list immediately instead of after a
            // render pass.
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
                  onClick={() => selectItem(m)}
                  className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  <span className="font-mono">{m.sku}</span>
                  <span className="flex-1 truncate text-neutral-600 dark:text-neutral-400">
                    {m.name}
                  </span>
                  <span className="tabular-nums text-neutral-500">{m.on_hand}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {item && (
        <div className="mt-4 rounded border border-neutral-300 p-3 dark:border-neutral-700">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-mono text-sm">{item.sku}</span>
            <span className="flex-1 truncate text-sm text-neutral-600 dark:text-neutral-400">
              {item.name}
            </span>
            <span className="text-sm tabular-nums text-neutral-500">
              {item.on_hand} on hand
            </span>
          </div>

          {item.is_serialized ? (
            <div className="mt-3">
              <input
                ref={serialRef}
                inputMode="text"
                autoComplete="off"
                placeholder="Scan serial, then the next"
                value={serialInput}
                onChange={(e) => setSerialInput(e.target.value)}
                onKeyDown={onSerialKeyDown}
                className="w-full rounded border border-neutral-300 px-3 py-3 text-base focus:outline-2 focus:outline-offset-2 focus:outline-blue-600 dark:border-neutral-700 dark:bg-neutral-900"
              />

              <p className="mt-2 text-sm text-neutral-500">
                {serials.filter((s) => s.ok).length} accepted
                {serials.some((s) => !s.ok) &&
                  `, ${serials.filter((s) => !s.ok).length} rejected`}
              </p>

              {serials.length > 0 && (
                <ul className="mt-2 max-h-48 overflow-y-auto text-sm">
                  {serials.map((s, i) => (
                    <li
                      key={`${s.serial}-${i}`}
                      className="flex items-baseline justify-between gap-2 border-b border-neutral-200 py-1 last:border-0 dark:border-neutral-800"
                    >
                      <span className="font-mono">{s.serial}</span>
                      <span
                        className={
                          s.ok ? 'text-neutral-500' : 'text-red-600 dark:text-red-400'
                        }
                      >
                        {s.ok ? '' : s.message}
                      </span>
                      <button
                        onClick={() => setSerials((prev) => prev.filter((_, j) => j !== i))}
                        aria-label={`Remove ${s.serial}`}
                        className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <input
              ref={quantityRef}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              placeholder={`Quantity to ${verb.toLowerCase()}`}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void submit()
                }
              }}
              className="mt-3 w-full rounded border border-neutral-300 px-3 py-3 text-base focus:outline-2 focus:outline-offset-2 focus:outline-blue-600 dark:border-neutral-700 dark:bg-neutral-900"
            />
          )}

          <button
            onClick={() => void submit()}
            disabled={busy}
            className="mt-3 w-full rounded bg-neutral-900 px-3 py-3 text-base font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {busy ? 'Posting…' : `${verb} — Enter`}
          </button>
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
