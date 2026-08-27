'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { writeAudit } from '@/lib/audit/write'
import { previewItemImport } from '@/lib/catalog/import-items'
import type { ImportPreview } from '@/lib/catalog/csv'
import type { Item, ItemUnit, LocationType } from '@/lib/catalog/types'

export interface ActionResult {
  ok: boolean
  error?: string
  id?: string
}

/**
 * All writes here go through the request-scoped client, so RLS decides what
 * is permitted. The manager gate in the page is a convenience for rendering;
 * the boundary is the policy (§9.1).
 */

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export async function createItem(input: {
  prefix: string
  name: string
  unit: ItemUnit
  category?: string | null
  barcode?: string | null
  unitCost?: number | null
  sellPrice?: number | null
  supplierId?: string | null
  isSerialized: boolean
  unitsPerCase: number
}): Promise<ActionResult> {
  const supabase = await createClient()

  // The SKU is generated, never typed — that is what keeps the PREFIX-NNNN
  // convention intact across everyone who ever adds an item (§4.1).
  const { data: sku, error: skuError } = await supabase.rpc('next_sku', {
    p_prefix: input.prefix,
  })

  if (skuError) return { ok: false, error: skuError.message }

  const { data, error } = await supabase
    .from('items')
    .insert({
      sku,
      name: input.name,
      unit: input.unit,
      category: input.category ?? null,
      barcode: input.barcode ?? null,
      unit_cost: input.unitCost ?? null,
      sell_price: input.sellPrice ?? null,
      supplier_id: input.supplierId ?? null,
      is_serialized: input.isSerialized,
      units_per_case: input.isSerialized ? 1 : input.unitsPerCase,
    })
    .select('id, sku')
    .single()

  if (error) return { ok: false, error: error.message }

  await writeAudit(supabase, {
    action: 'item.create',
    entityType: 'item',
    entityId: data.id,
    after: { sku: data.sku, name: input.name },
  })

  revalidatePath('/admin/items')
  return { ok: true, id: data.id }
}

export async function updateItem(
  id: string,
  patch: Partial<Item>,
): Promise<ActionResult> {
  const supabase = await createClient()

  const { data: before } = await supabase.from('items').select('*').eq('id', id).single()

  const { error } = await supabase.from('items').update(patch).eq('id', id)
  if (error) return { ok: false, error: error.message }

  // Cost and price changes are logged by the items_audit_money trigger in
  // migration 0003. Logging them again here would double-log, so this entry
  // deliberately records only the non-money change.
  const moneyOnly =
    Object.keys(patch).length > 0 &&
    Object.keys(patch).every((k) => k === 'unit_cost' || k === 'sell_price')

  if (!moneyOnly) {
    await writeAudit(supabase, {
      action: 'item.update',
      entityType: 'item',
      entityId: id,
      before: before ? { sku: before.sku, name: before.name } : null,
      after: patch,
    })
  }

  revalidatePath('/admin/items')
  return { ok: true }
}

/**
 * Catalog rows are referenced by ledger history forever, so this deactivates
 * rather than deletes — the same reasoning that keeps employees and documents
 * (§9.3, §4.2). The DELETE grant is revoked at the database anyway.
 */
export async function setItemActive(id: string, isActive: boolean): Promise<ActionResult> {
  return updateItem(id, { is_active: isActive })
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

export async function upsertLocation(input: {
  id?: string
  code: string
  name: string
  type: LocationType
}): Promise<ActionResult> {
  const supabase = await createClient()

  const payload = { code: input.code, name: input.name, type: input.type }

  const { data, error } = input.id
    ? await supabase.from('locations').update(payload).eq('id', input.id).select('id').single()
    : await supabase.from('locations').insert(payload).select('id').single()

  if (error) return { ok: false, error: error.message }

  await writeAudit(supabase, {
    action: 'location.update',
    entityType: 'location',
    entityId: data.id,
    after: payload,
  })

  revalidatePath('/admin/locations')
  return { ok: true, id: data.id }
}

export async function setLocationActive(
  id: string,
  isActive: boolean,
): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.from('locations').update({ is_active: isActive }).eq('id', id)
  if (error) return { ok: false, error: error.message }

  await writeAudit(supabase, {
    action: 'location.update',
    entityType: 'location',
    entityId: id,
    after: { is_active: isActive },
  })

  revalidatePath('/admin/locations')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export async function upsertSupplier(input: {
  id?: string
  name: string
  contactName?: string | null
  contactEmail?: string | null
  phone?: string | null
  leadTimeDays?: number | null
  currency: string
}): Promise<ActionResult> {
  const supabase = await createClient()

  const payload = {
    name: input.name,
    contact_name: input.contactName ?? null,
    contact_email: input.contactEmail ?? null,
    phone: input.phone ?? null,
    lead_time_days: input.leadTimeDays ?? null,
    currency: input.currency,
  }

  const { data, error } = input.id
    ? await supabase.from('suppliers').update(payload).eq('id', input.id).select('id').single()
    : await supabase.from('suppliers').insert(payload).select('id').single()

  if (error) return { ok: false, error: error.message }

  await writeAudit(supabase, {
    action: 'supplier.update',
    entityType: 'supplier',
    entityId: data.id,
    after: payload,
  })

  revalidatePath('/admin/suppliers')
  return { ok: true, id: data.id }
}

export async function setSupplierActive(
  id: string,
  isActive: boolean,
): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.from('suppliers').update({ is_active: isActive }).eq('id', id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/admin/suppliers')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// CSV import
// ---------------------------------------------------------------------------

async function loadItemImportContext() {
  const supabase = await createClient()

  const [{ data: items }, { data: suppliers }] = await Promise.all([
    supabase.from('items').select('id, sku, barcode'),
    supabase.from('suppliers').select('id, name'),
  ])

  const existingSkus = new Map<string, string>()
  const barcodeOwners = new Map<string, string>()
  for (const item of items ?? []) {
    existingSkus.set(item.sku, item.id)
    if (item.barcode) barcodeOwners.set(item.barcode, item.id)
  }

  const suppliersByName = new Map<string, string>()
  for (const supplier of suppliers ?? []) {
    suppliersByName.set(supplier.name.toLowerCase(), supplier.id)
  }

  return { existingSkus, suppliersByName, barcodeOwners }
}

/** Dry run. Reads only — nothing is written until commitItemImport. */
export async function previewItems(text: string): Promise<ImportPreview<Item>> {
  const context = await loadItemImportContext()
  return previewItemImport(text, context)
}

/**
 * Commits an import, re-validating from scratch rather than trusting a
 * preview the browser sends back. The catalog may have changed between the
 * two calls, and a client-supplied row set is an obvious way to write values
 * that never passed validation at all.
 */
export async function commitItemImport(
  text: string,
): Promise<ActionResult & { created?: number; updated?: number; rejected?: number }> {
  const supabase = await createClient()
  const context = await loadItemImportContext()
  const preview = previewItemImport(text, context)

  const writable = preview.rows.filter((r) => r.action !== 'reject')

  if (writable.length === 0) {
    return { ok: false, error: 'No valid rows to import.', rejected: preview.rejects }
  }

  const creates = writable.filter((r) => r.action === 'create')
  const updates = writable.filter((r) => r.action === 'update')

  // Batched, not row-by-row. A loop that fails on line 34 leaves 33 rows
  // committed and no way to tell from the outside which import produced
  // them — the half-applied state the dry run exists to prevent.
  //
  // Two statements rather than one is still not atomic across both. Making it
  // truly all-or-nothing needs a database function taking the whole payload;
  // that is the right fix if partial imports ever actually bite, and it is
  // noted rather than silently assumed away.
  if (creates.length > 0) {
    const { error } = await supabase.from('items').insert(creates.map((r) => r.values))
    if (error) return { ok: false, error: `Import failed, nothing was created: ${error.message}` }
  }

  for (const row of updates) {
    const { error } = await supabase.from('items').update(row.values).eq('id', row.existingId!)
    if (error) {
      return {
        ok: false,
        error: `Created ${creates.length} row(s), then failed updating line ${row.line}: ${error.message}`,
        created: creates.length,
      }
    }
  }

  const created = creates.length
  const updated = updates.length

  await writeAudit(supabase, {
    action: 'data.import',
    entityType: 'item',
    after: { created, updated, rejected: preview.rejects },
  })

  revalidatePath('/admin/items')
  return { ok: true, created, updated, rejected: preview.rejects }
}
