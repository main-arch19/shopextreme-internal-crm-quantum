import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Adjustment } from './adjustment'

export const dynamic = 'force-dynamic'

/**
 * Stock adjustments — the correction path (§4.2).
 *
 * Adjustment is the only document type that creates or destroys stock from
 * nothing, which is why it is manager-gated and why a reason is mandatory.
 * §10.7 names adjustments as one of the three places a standalone system can
 * be quietly abused, and the executive oversight it describes depends on
 * every one of them carrying a person and a stated reason.
 *
 * It is also the only way to fix a miscount. Voiding reverses a document that
 * was entered; it cannot correct stock that was counted wrong, damaged, or
 * found.
 */
export default async function AdjustPage() {
  await requireRole('manager')

  const supabase = await createClient()
  const { data: locations } = await supabase
    .from('locations')
    .select('id, code, name')
    .eq('is_active', true)
    .order('code')

  return <Adjustment locations={locations ?? []} />
}
