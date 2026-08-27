'use client'

import { useState } from 'react'
import { voidDocumentAction } from './actions'

/**
 * Voiding is permission-gated in the database, not here — a manager role
 * check in the UI is a convenience, and post_document/void_document enforce
 * it regardless of what the browser sends (§9.1).
 *
 * The reason is mandatory because a void is one of the three places a
 * standalone system can be quietly abused (§10.7), and an unexplained
 * reversal is indistinguishable from a cover-up.
 */
export function VoidButton({
  documentId,
  docNumber,
}: {
  documentId: string
  docNumber: string
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function confirm() {
    if (!reason.trim()) {
      setError('A reason is required.')
      return
    }

    setBusy(true)
    const result = await voidDocumentAction(documentId, reason)
    setBusy(false)

    if (!result.ok) {
      setError(result.error ?? 'Could not void that document.')
      return
    }

    setOpen(false)
    setReason('')
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-neutral-500 underline hover:text-red-600"
      >
        Void
      </button>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <p className="text-xs text-neutral-600 dark:text-neutral-400">
        Void {docNumber}? This writes a reversing document — nothing is deleted.
      </p>
      <input
        autoFocus
        placeholder="Reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void confirm()
          if (e.key === 'Escape') setOpen(false)
        }}
        className="w-48 rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
      />
      {error && <span className="text-xs text-red-600">{error}</span>}
      <div className="flex gap-2">
        <button onClick={() => setOpen(false)} className="text-xs text-neutral-500 underline">
          Cancel
        </button>
        <button
          onClick={() => void confirm()}
          disabled={busy}
          className="text-xs text-red-600 underline disabled:opacity-50"
        >
          {busy ? 'Voiding…' : 'Confirm void'}
        </button>
      </div>
    </div>
  )
}
