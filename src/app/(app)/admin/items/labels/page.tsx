import { createClient } from '@/lib/supabase/server'
import { code128Svg } from '@/lib/barcode/code128'

export const dynamic = 'force-dynamic'

/**
 * Barcode label sheet (§8).
 *
 * Items without a manufacturer barcode get an internal one encoding the SKU.
 * Rendered as inline SVG so printing needs no library, no CDN, and no
 * rasterisation step that could soften the bar edges.
 */
export default async function LabelsPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()

  let query = supabase
    .from('items')
    .select('id, sku, name, barcode')
    .eq('is_active', true)
    .order('sku')

  if (params.ids) {
    query = query.in('id', params.ids.split(','))
  }

  const { data: items } = await query

  return (
    <main>
      <div className="print:hidden">
        <h1 className="text-lg font-semibold">Barcode labels</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          {items?.length ?? 0} label(s). The code encodes the SKU, so a scan resolves the item
          directly on the entry screen.
        </p>
        <p className="mt-2 text-xs text-neutral-500">
          Print at 100% scale — any scaling changes the bar widths and can make the symbol
          unreadable.
        </p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 print:grid-cols-3 print:gap-2">
        {(items ?? []).map((item) => (
          <div
            key={item.id}
            className="break-inside-avoid rounded border border-neutral-300 p-2 text-center dark:border-neutral-700 print:border-neutral-400"
          >
            <div
              className="flex justify-center"
              // Server-rendered from our own encoder over a SKU already
              // constrained to [A-Z0-9-]; no user-supplied markup reaches this.
              dangerouslySetInnerHTML={{
                __html: code128Svg(item.sku, { moduleWidth: 1.6, height: 44 }),
              }}
            />
            <p className="mt-1 truncate text-xs text-neutral-700 dark:text-neutral-300 print:text-black">
              {item.name}
            </p>
          </div>
        ))}
      </div>

      {(items?.length ?? 0) === 0 && (
        <p className="py-6 text-sm text-neutral-500">No active items to label.</p>
      )}
    </main>
  )
}
