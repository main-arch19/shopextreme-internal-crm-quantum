import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Audit actions (§10.6). Enumerated rather than free-text so a typo becomes a
 * type error instead of an entry that silently never matches a filter.
 *
 * Deliberately absent: page views. A log with everything in it is a log
 * nobody reads.
 */
export type AuditAction =
  // Stock
  | 'document.post'
  | 'document.void'
  | 'stock.adjust'
  // Catalog / money
  | 'item.create'
  | 'item.update'
  | 'item.cost_change'
  | 'item.price_change'
  | 'supplier.update'
  | 'location.update'
  // People
  | 'employee.invite'
  | 'employee.invite_revoke'
  | 'employee.approved'
  | 'employee.rejected'
  | 'employee.role_change'
  | 'employee.suspended'
  | 'employee.offboarded'
  | 'employee.reinstated'
  // Access
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.permission_denied'
  // Data
  | 'data.export'
  | 'data.import'
  // Reorder
  | 'reorder.override'
  | 'reorder.snooze'
  // System
  | 'system.chain_verify'
  | 'system.snapshot_failed'

interface WriteAuditArgs {
  action: AuditAction
  entityType: string
  entityId?: string | null
  before?: unknown
  after?: unknown
}

/**
 * Writes one audit entry through the single database write path.
 *
 * The RPC is security definer and derives the actor from auth.uid() itself,
 * so application code cannot forge who did something — passing an actor is
 * not even possible (§10.3).
 *
 * Errors are thrown, not swallowed. If the log write fails the surrounding
 * transaction should fail with it: an action that happened without a log
 * entry is precisely the hole this system exists to close.
 */
export async function writeAudit(
  supabase: SupabaseClient,
  { action, entityType, entityId = null, before = null, after = null }: WriteAuditArgs,
): Promise<number> {
  const { data, error } = await supabase.rpc('write_audit', {
    p_action: action,
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_before: before ?? null,
    p_after: after ?? null,
  })

  if (error) {
    throw new Error(`audit write failed for ${action}: ${error.message}`)
  }

  return data as number
}
