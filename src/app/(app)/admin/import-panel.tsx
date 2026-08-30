'use client'

import { useState } from 'react'
import { commitItemImport, previewItems } from './actions'
import type { ImportPreview } from '@/lib/catalog/csv'
import type { Item } from '@/lib/catalog/types'
import { Button, Card, fieldClass } from '@/components/ui'

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
    <Card className="mb-4 p-4">
      <h2 className="text-sm font-medium">Import items from CSV</h2>
      <p className="mt-1 text-xs text-text-muted">
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
        className={`${fieldClass} mt-2 font-mono text-xs`}
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void runPreview()} disabled={busy || !text.trim()}>
          {busy ? 'Checking…' : 'Check file'}
        </Button>

        {preview && preview.rejects === 0 && preview.rows.length > 0 && (
          <Button onClick={() => void commit()} disabled={busy}>
            Import {preview.creates + preview.updates} row(s)
          </Button>
        )}

        {preview && preview.rejects > 0 && (
          <button
            onClick={() => void commit()}
            disabled={busy || preview.creates + preview.updates === 0}
            className="rounded-lg border border-warning px-3 py-2 text-sm text-warning disabled:opacity-50"
          >
            Import the {preview.creates + preview.updates} valid row(s), skip{' '}
            {preview.rejects}
          </button>
        )}

        <Button variant="ghost" onClick={onDone}>
          Close
        </Button>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}

      {result && (
        <p role="status" className="mt-3 text-sm text-success">
          {result}
        </p>
      )}

      {preview && (
        <div className="mt-4">
          <p className="text-sm">
            {preview.creates} to create · {preview.updates} to update ·{' '}
            <span className={preview.rejects > 0 ? 'text-danger' : ''}>
              {preview.rejects} rejected
            </span>
          </p>

          <div className="mt-2 max-h-72 overflow-y-auto">
            <table className="w-full border-collapse text-xs">
              <tbody>
                {preview.rows.map((row) => (
                  <tr
                    key={row.line}
                    className="border-b border-line last:border-0"
                  >
                    <td className="py-1 pr-2 text-text-muted">{row.line}</td>
                    <td className="py-1 pr-2 font-mono">{row.values.sku ?? '—'}</td>
                    <td className="py-1 pr-2">{row.values.name ?? ''}</td>
                    <td className="py-1 pr-2">
                      {row.action === 'reject' ? (
                        <span className="text-danger">
                          {row.problems.join('; ')}
                        </span>
                      ) : (
                        <span className="text-text-muted">{row.action}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  )
}
