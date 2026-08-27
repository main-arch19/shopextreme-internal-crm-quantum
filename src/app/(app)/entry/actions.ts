'use server'

import { createClient } from '@/lib/supabase/server'
import { createAndPost } from '@/lib/posting/post'
import type { AdjustmentDirection, DocType, IssueReason } from '@/lib/posting/types'

export interface ResolvedItem {
  item_id: string
  sku: string
  name: string
  unit: string
  unit_cost: number | null
  is_serialized: boolean
  on_hand: number
  matched_on?: string
}

/** One round trip: scan in, item out. */
export async function resolveScan(
  code: string,
  locationId: string | null,
): Promise<ResolvedItem | null> {
  const supabase = await createClient()
  const { data } = await supabase.rpc('resolve_scan', {
    p_code: code,
    p_location_id: locationId,
  })
  const rows = (data as ResolvedItem[]) ?? []
  return rows[0] ?? null
}

export async function searchItems(
  query: string,
  locationId: string | null,
): Promise<ResolvedItem[]> {
  if (query.trim().length < 1) return []

  const supabase = await createClient()
  const { data } = await supabase.rpc('search_items', {
    p_query: query,
    p_location_id: locationId,
    p_limit: 8,
  })
  return (data as ResolvedItem[]) ?? []
}

export interface SerialCheck {
  serial_unit_id: string | null
  serial: string
  status: string | null
  location_id: string | null
  acceptable: boolean
  message: string
}

/**
 * Validates a scanned serial against its current state, so the scan loop can
 * reject a duplicate the moment it is scanned rather than at post time —
 * after forty more scans (§ phase 3).
 */
export async function checkSerial(
  itemId: string,
  serial: string,
  docType: DocType,
  locationId: string,
): Promise<SerialCheck> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('resolve_serial', {
    p_item_id: itemId,
    p_serial: serial,
    p_doc_type: docType,
    p_location_id: locationId,
  })

  if (error) {
    return {
      serial_unit_id: null,
      serial,
      status: null,
      location_id: null,
      acceptable: false,
      message: error.message,
    }
  }

  const rows = (data as SerialCheck[]) ?? []
  return (
    rows[0] ?? {
      serial_unit_id: null,
      serial,
      status: null,
      location_id: null,
      acceptable: false,
      message: 'Could not check that serial.',
    }
  )
}

export interface EntryLine {
  item_id: string
  quantity: number
  unit_cost?: number | null
  serial?: string | null
  direction?: AdjustmentDirection | null
}

export interface EntryResult {
  ok: boolean
  docNumber?: string
  error?: string
}

/**
 * Posts one entry. Serial rows are registered first so the posting engine has
 * a serial_unit_id to move; that registration creates them written_off with
 * no location, so a scan that never posts cannot inflate on-hand.
 */
export async function postEntry(input: {
  docType: DocType
  locationId: string
  toLocationId?: string | null
  supplierId?: string | null
  issueReason?: IssueReason | null
  reference?: string | null
  reason?: string | null
  lines: EntryLine[]
}): Promise<EntryResult> {
  const supabase = await createClient()

  const lines = []
  for (const line of input.lines) {
    let serialUnitId: string | null = null

    if (line.serial) {
      const { data, error } = await supabase.rpc('ensure_serial_unit', {
        p_item_id: line.item_id,
        p_serial: line.serial,
      })
      if (error) return { ok: false, error: error.message }
      serialUnitId = data as string
    }

    lines.push({
      item_id: line.item_id,
      quantity: line.quantity,
      unit_cost: line.unit_cost ?? null,
      serial_unit_id: serialUnitId,
      direction: line.direction ?? null,
    })
  }

  const result = await createAndPost(supabase, {
    doc_type: input.docType,
    location_id: input.locationId,
    to_location_id: input.toLocationId ?? null,
    supplier_id: input.supplierId ?? null,
    issue_reason: input.issueReason ?? null,
    reference: input.reference ?? null,
    reason: input.reason ?? null,
    lines,
  })

  return { ok: result.ok, docNumber: result.docNumber, error: result.error }
}
