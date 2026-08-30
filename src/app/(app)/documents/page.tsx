import Link from 'next/link'
import { requireActiveEmployee } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import type { DocStatus, DocType } from '@/lib/posting/types'
import { VoidButton } from './void-button'
import { NewDocumentMenu } from './new-document-menu'
import {
  Card,
  EmptyState,
  PageTitle,
  StatusBadge,
  Table,
  TableWrap,
  Td,
  Th,
  Tr,
} from '@/components/ui'

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
    <>
      <PageTitle actions={<NewDocumentMenu role={employee.role} />}>Documents</PageTitle>

      <div className="mb-4 flex flex-wrap gap-2 text-sm">
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

      {/* Card wraps the table; the rows inside stay dense. §7.2 — a buyer
          scans this daily and needs rows per screen, not padding. */}
      <Card>
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Number</Th>
                <Th>Type</Th>
                <Th>When</Th>
                <Th>Location</Th>
                <Th>Posted by</Th>
                <Th>Note</Th>
                <Th align="right"> </Th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <Tr key={doc.id}>
                  <Td className="font-mono whitespace-nowrap">
                    {doc.doc_number}
                    {doc.voids_document && (
                      <span className="ml-1 text-xs text-text-muted">(reversal)</span>
                    )}
                  </Td>
                  <Td>{doc.doc_type.charAt(0) + doc.doc_type.slice(1).toLowerCase()}</Td>
                  <Td className="whitespace-nowrap tabular-nums text-text-secondary">
                    {new Date(doc.occurred_at).toLocaleString()}
                  </Td>
                  <Td>{doc.locations?.code ?? '—'}</Td>
                  <Td className="text-text-secondary">
                    {doc.employees?.full_name ?? doc.employees?.email ?? '—'}
                  </Td>
                  <Td className="text-text-secondary">
                    {doc.status === 'VOIDED' ? (
                      <StatusBadge tone="danger">Voided — {doc.void_reason}</StatusBadge>
                    ) : (
                      (doc.reason ?? doc.reference ?? '')
                    )}
                  </Td>
                  <Td align="right">
                    {canVoid && doc.status === 'POSTED' && (
                      <VoidButton documentId={doc.id} docNumber={doc.doc_number} />
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>

        {documents.length === 0 && (
          <EmptyState>
            {filters.type === 'COUNT' ? (
              <>
                No counts recorded. Cycle counting is not built yet — until it is, use{' '}
                <Link href="/adjust" className="underline">
                  Adjust
                </Link>{' '}
                to correct stock you have counted by hand.
              </>
            ) : filters.type || filters.status ? (
              'No documents match that filter.'
            ) : (
              // The screen someone lands on looking for "where do I add
              // things". It has to say where, rather than that it is empty.
              <>
                Nothing recorded yet. Documents appear here once stock moves — use{' '}
                <strong>New document</strong> above to record one.
                <br />
                If you have no items yet, start under{' '}
                <Link href="/admin/items" className="underline">
                  Catalog
                </Link>
                .
              </>
            )}
          </EmptyState>
        )}
      </Card>
    </>
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
      className={`rounded-lg border px-3 py-1.5 transition-colors ${
        active
          ? 'border-accent bg-accent text-accent-fg'
          : 'border-line text-text-secondary hover:bg-surface-subtle'
      }`}
    >
      {label}
    </Link>
  )
}
