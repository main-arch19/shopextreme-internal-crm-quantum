import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Receiving } from './receiving'

export const dynamic = 'force-dynamic'

/**
 * Receiving (§7.4).
 *
 * Supplier and reference at the top, lines below. Partial receipts are the
 * normal case, not an exception — a delivery arriving short is ordinary, and
 * a screen that cannot record it pushes people to post a full receipt and
 * "fix it later", which is how on-hand starts drifting.
 *
 * No PO linkage in this phase, so on_order stays zero (phase 6).
 */
export default async function ReceivePage() {
  await requireRole('buyer')

  const supabase = await createClient()
  const [{ data: locations }, { data: suppliers }] = await Promise.all([
    supabase.from('locations').select('id, code, name').eq('is_active', true).order('code'),
    supabase.from('suppliers').select('id, name').eq('is_active', true).order('name'),
  ])

  return <Receiving locations={locations ?? []} suppliers={suppliers ?? []} />
}
