import { createClient } from '@/lib/supabase/server'
import type { Location } from '@/lib/catalog/types'
import { LocationsAdmin } from './locations-admin'

export const dynamic = 'force-dynamic'

export default async function LocationsPage() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('locations')
    .select('id, code, name, type, is_active')
    .order('code')

  return <LocationsAdmin locations={(data ?? []) as Location[]} />
}
