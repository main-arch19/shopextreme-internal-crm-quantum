import { createClient } from '@/lib/supabase/server'
import type { Item, Supplier } from '@/lib/catalog/types'
import { ItemsAdmin } from './items-admin'

export const dynamic = 'force-dynamic'

export default async function ItemsPage() {
  const supabase = await createClient()

  const [{ data: items }, { data: suppliers }] = await Promise.all([
    supabase
      .from('items')
      .select(
        'id, sku, name, category, unit, units_per_case, barcode, unit_cost, sell_price, supplier_id, moq, target_cover_days, service_level, manual_reorder_point, velocity_window_days, exclude_from_reorder, is_tracked, is_active, is_serialized',
      )
      .order('sku'),
    supabase.from('suppliers').select('*').eq('is_active', true).order('name'),
  ])

  return (
    <ItemsAdmin
      items={(items ?? []) as Item[]}
      suppliers={(suppliers ?? []) as Supplier[]}
    />
  )
}
