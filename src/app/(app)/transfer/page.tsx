import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Transfer } from './transfer'

export const dynamic = 'force-dynamic'

/**
 * Stock transfers between locations (§4.2).
 *
 * post_document() writes both legs — negative at the source, positive at the
 * destination — so each location's balance stays independently correct and
 * on-hand remains a plain sum of the ledger.
 */
export default async function TransferPage() {
  await requireRole('buyer')

  const supabase = await createClient()
  const { data: locations } = await supabase
    .from('locations')
    .select('id, code, name')
    .eq('is_active', true)
    .order('code')

  return <Transfer locations={locations ?? []} />
}
