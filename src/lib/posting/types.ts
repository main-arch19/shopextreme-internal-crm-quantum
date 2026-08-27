export type DocType = 'RECEIPT' | 'ISSUE' | 'ADJUSTMENT' | 'COUNT' | 'TRANSFER'
export type DocStatus = 'DRAFT' | 'POSTED' | 'VOIDED'
export type IssueReason = 'sale' | 'internal' | 'sample' | 'damage' | 'writeoff'
export type SerialStatus = 'in_stock' | 'issued' | 'quarantine' | 'written_off'
export type AdjustmentDirection = 'increase' | 'decrease'

/**
 * Issue reasons that represent real demand.
 *
 * Velocity (§5.1) must exclude the others: a sample given away or a damaged
 * unit written off did not happen because a customer wanted one, and counting
 * them inflates the demand signal that drives every reorder decision.
 */
export const DEMAND_ISSUE_REASONS: IssueReason[] = ['sale', 'internal']

export const NON_DEMAND_ISSUE_REASONS: IssueReason[] = ['sample', 'damage', 'writeoff']

export interface DocumentRow {
  id: string
  doc_number: string
  doc_type: DocType
  status: DocStatus
  location_id: string | null
  to_location_id: string | null
  supplier_id: string | null
  issue_reason: IssueReason | null
  reference: string | null
  reason: string | null
  occurred_at: string
  posted_at: string | null
  posted_by: string | null
  voided_at: string | null
  voided_by: string | null
  void_reason: string | null
  voids_document: string | null
  created_by: string | null
  created_at: string
}

export interface DocumentLineInput {
  item_id: string
  quantity: number
  unit_cost?: number | null
  sell_price?: number | null
  counted_qty?: number | null
  expected_qty?: number | null
  serial_unit_id?: string | null
  direction?: AdjustmentDirection | null
  note?: string | null
}

export interface StockOnHandRow {
  item_id: string
  location_id: string
  on_hand: number
  last_movement_at: string | null
}
