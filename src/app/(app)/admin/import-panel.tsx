'use client'

import { useState } from 'react'
import { commitItemImport, previewItems } from './actions'
import type { ImportPreview } from '@/lib/catalog/csv'
import type { Item } from '@/lib/catalog/types'

/**
 * Two-step import: preview, then commit (§14.8).
 *
 * The dry run is the point. A spreadsheet from a real business will have bad
 * rows in it, and finding out which ones after a partial write is far worse
 * than being told before anything happens.
 */
export function ImportPanel({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<ImportPreview<Item> | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function readFile(file: File) {
    const content = await file.text()
    setText(content)
    setPreview(null)
    setResult(null)
    setError(null)
  }

  async function runPreview() {
    if (!text.trim()) return
    setBusy(true)
    setError(null)
    setPreview(await previewItems(text))
    setBusy(false)
  }

  async function commit() {
    setBusy(true)
    setError(null)

    const outcome = await commitItemImport(text)
    setBusy(false)

    if (!outcome.ok) {
      setError(outcome.error ?? 'Import failed.')
      return
    }

    setResult(
      `Imported — ${outcome.created ?? 0} created, ${outcome.updated ?? 0} updated` +
        (outcome.rejected ? `, ${outcome.rejected} skipped` : ''),
    )
    setPreview(null)
    setText('')
  }

  return (
    <section className="mt-4 rounded border border-neutral-300 p-4 dark:border-neutral-700">
      <h2 className="text-sm font-medium">Import items from CSV</h2>
      <p className="mt-1 text-xs text-neutral-500">
        Columns: sku, name, unit, category, barcode, unit_cost, sell_price, supplier, moq,
        target_cover_days, service_level, is_serialized, units_per_case. Only sku and name are
        required. Suppliers are matched by name and must already exist.
      </p>

      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void readFile(file)
        }}
        className="mt-3 block w-full text-sm"
      />

      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setPreview(null)
        }}
        rows={5}
        placeholder="…or paste CSV here"
        className="mt-2 w-full rounded border border-neutral-300 px-2 py-1.5 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => void runPreview()}
          disabled={busy || !text.trim()}
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-neutral-700"
        >
          {busy ? 'Checking…' : 'Check file'}
        </button>

        {preview && preview.rejects === 0 && preview.rows.length > 0 && (
          <button
            onClick={() => void commit()}
            disabled={busy}
            className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            Import {preview.creates + preview.updates} row(s)
          </button>
        )}

        {preview && preview.rejects > 0 && (
          <button
            onClick={() => void commit()}
            disabled={busy || preview.creates + preview.updates === 0}
            className="rounded border border-amber-500 px-3 py-1.5 text-sm text-amber-700 disabled:opacity-50 dark:text-amber-400"
          >
            Import the {preview.creates + preview.updates} valid row(s), skip{' '}
            {preview.rejects}
          </button>
        )}

        <button onClick={onDone} className="text-sm text-neutral-500 underline">
          Close
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}

      {result && (
        <p role="status" className="mt-3 text-sm text-green-700 dark:text-green-400">
          {result}
        </p>
      )}

      {preview && (
        <div className="mt-4">
          <p className="text-sm">
            {preview.creates} to create · {preview.updates} to update ·{' '}
            <span className={preview.rejects > 0 ? 'text-red-600 dark:text-red-400' : ''}>
              {preview.rejects} rejected
            </span>
          </p>

          <div className="mt-2 max-h-72 overflow-y-auto">
            <table className="w-full border-collapse text-xs">
              <tbody>
                {preview.rows.map((row) => (
                  <tr
                    key={row.line}
                    className="border-b border-neutral-200 last:border-0 dark:border-neutral-800"
                  >
                    <td className="py-1 pr-2 text-neutral-500">{row.line}</td>
                    <td className="py-1 pr-2 font-mono">{row.values.sku ?? '—'}</td>
                    <td className="py-1 pr-2">{row.values.name ?? ''}</td>
                    <td className="py-1 pr-2">
                      {row.action === 'reject' ? (
                        <span className="text-red-600 dark:text-red-400">
                          {row.problems.join('; ')}
                        </span>
                      ) : (
                        <span className="text-neutral-500">{row.action}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}
