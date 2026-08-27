import { createClient } from '@/lib/supabase/server'
import type { Supplier } from '@/lib/catalog/types'
import { SuppliersAdmin } from './suppliers-admin'

export const dynamic = 'force-dynamic'

export default async function SuppliersPage() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('suppliers')
    .select('id, name, contact_name, contact_email, phone, lead_time_days, currency, notes, is_active')
    .order('name')

  return <SuppliersAdmin suppliers={(data ?? []) as Supplier[]} />
}
