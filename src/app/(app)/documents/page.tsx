import Link from 'next/link'
import { requireActiveEmployee } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import type { DocStatus, DocType } from '@/lib/posting/types'
import { VoidButton } from './void-button'

export const dynamic = 'force-dynamic'

interface DocumentRow {
  id: string
  doc_number: string
  doc_type: DocType
  status: DocStatus
  occurred_at: string
  reference: string | null
  reason: string | null
  void_reason: string | null
  voids_document: string | null
  locations: { code: string } | null
  employees: { full_name: string | null; email: string } | null
}

/**
 * Documents register (§7.6).
 *
 * The screen anyone goes to in order to answer "why does this number look
 * wrong". Every posted document is here, voided ones included — a void
 * reverses, it never erases, so both the original and its reversal stay
 * visible (§4.2).
 */
export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; status?: string }>
}) {
  const employee = await requireActiveEmployee()
  const filters = await searchParams

  const supabase = await createClient()

  let query = supabase
    .from('documents')
    .select(
      `id, doc_number, doc_type, status, occurred_at, reference, reason,
       void_reason, voids_document,
       locations:location_id (code),
       employees:posted_by (full_name, email)`,
    )
    .order('occurred_at', { ascending: false })
    .limit(100)

  if (filters.type) query = query.eq('doc_type', filters.type)
  if (filters.status) query = query.eq('status', filters.status)

  const { data } = await query
  const documents = (data ?? []) as unknown as DocumentRow[]

  const canVoid = employee.role === 'manager' || employee.role === 'executive'

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-lg font-semibold">Documents</h1>

      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        <FilterLink label="All" href="/documents" active={!filters.type && !filters.status} />
        {(['RECEIPT', 'ISSUE', 'ADJUSTMENT', 'TRANSFER', 'COUNT'] as DocType[]).map((t) => (
          <FilterLink
            key={t}
            label={t.charAt(0) + t.slice(1).toLowerCase()}
            href={`/documents?type=${t}`}
            active={filters.type === t}
          />
        ))}
        <FilterLink
          label="Voided"
          href="/documents?status=VOIDED"
          active={filters.status === 'VOIDED'}
        />
      </div>

      {/* Dense bordered rows, not cards — this is a scanning surface (§7.2). */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-300 text-left dark:border-neutral-700">
              <th className="py-2 pr-3 font-medium">Number</th>
              <th className="py-2 pr-3 font-medium">Type</th>
              <th className="py-2 pr-3 font-medium">When</th>
              <th className="py-2 pr-3 font-medium">Location</th>
              <th className="py-2 pr-3 font-medium">Posted by</th>
              <th className="py-2 pr-3 font-medium">Note</th>
              <th className="py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr
                key={doc.id}
                className="border-b border-neutral-200 last:border-0 dark:border-neutral-800"
              >
                <td className="py-2 pr-3 font-mono">
                  {doc.doc_number}
                  {doc.voids_document && (
                    <span className="ml-1 text-xs text-neutral-500">(reversal)</span>
                  )}
                </td>
                <td className="py-2 pr-3">
                  {doc.doc_type.charAt(0) + doc.doc_type.slice(1).toLowerCase()}
                </td>
                <td className="py-2 pr-3 tabular-nums text-neutral-600 dark:text-neutral-400">
                  {new Date(doc.occurred_at).toLocaleString()}
                </td>
                <td className="py-2 pr-3">{doc.locations?.code ?? '—'}</td>
                <td className="py-2 pr-3 text-neutral-600 dark:text-neutral-400">
                  {doc.employees?.full_name ?? doc.employees?.email ?? '—'}
                </td>
                <td className="py-2 pr-3 text-neutral-600 dark:text-neutral-400">
                  {doc.status === 'VOIDED' ? (
                    <span className="text-red-600 dark:text-red-400">
                      Voided — {doc.void_reason}
                    </span>
                  ) : (
                    (doc.reason ?? doc.reference ?? '')
                  )}
                </td>
                <td className="py-2 text-right">
                  {canVoid && doc.status === 'POSTED' && (
                    <VoidButton documentId={doc.id} docNumber={doc.doc_number} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {documents.length === 0 && (
          <p className="py-6 text-sm text-neutral-500">No documents match that filter.</p>
        )}
      </div>
    </main>
  )
}

function FilterLink({
  label,
  href,
  active,
}: {
  label: string
  href: string
  active: boolean
}) {
  return (
    <Link
      href={href}
      className={`rounded border px-2 py-1 ${
        active
          ? 'border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
          : 'border-neutral-300 dark:border-neutral-700'
      }`}
    >
      {label}
    </Link>
  )
}
