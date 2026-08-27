import type { SupabaseClient } from '@supabase/supabase-js'
import type { DocType, DocumentLineInput, IssueReason } from './types'

export interface CreateDocumentInput {
  doc_type: DocType
  location_id: string
  to_location_id?: string | null
  supplier_id?: string | null
  issue_reason?: IssueReason | null
  reference?: string | null
  reason?: string | null
  occurred_at?: string
  lines: DocumentLineInput[]
}

export interface PostResult {
  ok: boolean
  documentId?: string
  docNumber?: string
  error?: string
}

/**
 * Creates a draft and posts it in one call — the shape the quick-entry screen
 * needs, where a scan and a quantity should become a posted document without
 * an intermediate save step (§7.1).
 *
 * The draft still exists as a row, so a failure during posting leaves
 * something to inspect rather than losing the entry. That matters more here
 * than anywhere: this is the screen people use standing at a door, and an
 * entry that silently vanishes is exactly the failure mode §3 warns about.
 */
export async function createAndPost(
  supabase: SupabaseClient,
  input: CreateDocumentInput,
): Promise<PostResult> {
  if (input.lines.length === 0) {
    return { ok: false, error: 'A document needs at least one line.' }
  }

  const { data: doc, error: docError } = await supabase
    .from('documents')
    .insert({
      doc_type: input.doc_type,
      location_id: input.location_id,
      to_location_id: input.to_location_id ?? null,
      supplier_id: input.supplier_id ?? null,
      issue_reason: input.issue_reason ?? null,
      reference: input.reference ?? null,
      reason: input.reason ?? null,
      occurred_at: input.occurred_at ?? new Date().toISOString(),
    })
    .select('id, doc_number')
    .single()

  if (docError || !doc) {
    return { ok: false, error: docError?.message ?? 'Could not create the document.' }
  }

  const { error: linesError } = await supabase.from('document_lines').insert(
    input.lines.map((line) => ({
      document_id: doc.id,
      item_id: line.item_id,
      quantity: line.quantity,
      unit_cost: line.unit_cost ?? null,
      sell_price: line.sell_price ?? null,
      counted_qty: line.counted_qty ?? null,
      expected_qty: line.expected_qty ?? null,
      serial_unit_id: line.serial_unit_id ?? null,
      direction: line.direction ?? null,
      note: line.note ?? null,
    })),
  )

  if (linesError) {
    // The draft is still deletable (the block trigger only guards non-drafts),
    // so clean it up rather than leaving an empty document in the register.
    await supabase.from('documents').delete().eq('id', doc.id)
    return { ok: false, error: linesError.message }
  }

  return postDocument(supabase, doc.id, doc.doc_number)
}

/**
 * Posts an existing draft. All validation lives in the database function —
 * role gates, serial state transitions, adjustment direction — so this cannot
 * be bypassed by calling the API directly (§9.1).
 */
export async function postDocument(
  supabase: SupabaseClient,
  documentId: string,
  docNumber?: string,
): Promise<PostResult> {
  const { error } = await supabase.rpc('post_document', { p_doc_id: documentId })

  if (error) {
    return { ok: false, documentId, docNumber, error: humanizePostgresError(error.message) }
  }

  return { ok: true, documentId, docNumber }
}

/**
 * Voids a posted document by writing offsetting entries. Never deletes —
 * both documents stay visible in the register (§4.2).
 */
export async function voidDocument(
  supabase: SupabaseClient,
  documentId: string,
  reason: string,
): Promise<PostResult> {
  if (!reason.trim()) {
    return { ok: false, error: 'Voiding requires a reason.' }
  }

  const { data, error } = await supabase.rpc('void_document', {
    p_doc_id: documentId,
    p_reason: reason,
  })

  if (error) {
    return { ok: false, error: humanizePostgresError(error.message) }
  }

  return { ok: true, documentId: data as string }
}

/**
 * The posting function raises messages written to be read by the person at
 * the door — "serial ABC123 is already issued", not a constraint name. Strip
 * the Postgres framing so they survive to the screen intact.
 */
function humanizePostgresError(message: string): string {
  return message
    .replace(/^.*?(?:ERROR|error):\s*/i, '')
    .replace(/\s*CONTEXT:[\s\S]*$/i, '')
    .trim()
}
