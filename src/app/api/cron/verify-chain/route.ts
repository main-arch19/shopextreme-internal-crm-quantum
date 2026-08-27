import { NextResponse, type NextRequest } from 'next/server'
import { serviceClient } from '@/lib/supabase/service'
import { timingSafeEqual } from 'node:crypto'

export const dynamic = 'force-dynamic'

interface ChainResult {
  ok: boolean
  checked_through: number
  entry_count: number
  broken_at: number | null
  reason: string
  head_hash: string | null
}

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const header = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`
  const a = Buffer.from(header)
  const b = Buffer.from(expected)

  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Nightly audit chain verification (§10.4).
 *
 * Walks the whole chain recomputing every hash. Alter one row and that row
 * plus every row after it stops verifying, so tampering is provable rather
 * than merely suspected.
 *
 * The result is written back into the log itself and the head hash is mailed
 * out (§10.5). Mailing it is the cheap external anchor that matters most: a
 * chain head recorded somewhere the database administrator does not control
 * is what lets altered history be disproved later. Without it, an attacker
 * with database access can rewrite the chain AND its verification record.
 *
 * A failure here is a security incident, not a bug.
 */
export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()
  const { data, error } = await supabase.rpc('verify_audit_chain', { p_from: 0 })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const result = (Array.isArray(data) ? data[0] : data) as ChainResult

  await supabase.rpc('write_audit', {
    p_action: 'system.chain_verify',
    p_entity_type: 'audit_log',
    p_entity_id: String(result.checked_through),
    p_before: null,
    p_after: {
      ok: result.ok,
      checked_through: result.checked_through,
      entry_count: result.entry_count,
      broken_at: result.broken_at,
      reason: result.reason,
      head_hash: result.head_hash,
    },
  })

  // TODO(phase 9): mail head_hash to AUDIT_ANCHOR_EMAIL, and alert out of
  // band on failure. Until that ships the anchor does not exist, so the
  // guarantee here is tamper-EVIDENT to anyone reading this endpoint's
  // output — not tamper-proof against someone who can rewrite the log and
  // this record together.
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
