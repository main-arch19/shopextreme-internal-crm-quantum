import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { QuickEntry } from './quick-entry'

export const dynamic = 'force-dynamic'

/**
 * Quick entry (§7.1) — the most-used screen in the system.
 *
 * Targets: under 15 seconds to post a receipt, under 5 to record an issue.
 * These are engineering constraints, not aspirations. If entry is slower than
 * scribbling on the box, people scribble and the system drifts silently (§3).
 */
export default async function EntryPage() {
  await requireRole('buyer')

  const supabase = await createClient()
  const { data: locations } = await supabase
    .from('locations')
    .select('id, code, name')
    .eq('is_active', true)
    .order('code')

  return <QuickEntry locations={locations ?? []} />
}
