/**
 * Role types and comparison, with no server-only imports.
 *
 * Split out of auth.ts so client components can use them. auth.ts imports
 * next/headers at module scope, which makes the whole module unusable from a
 * client component even when only a pure function is wanted from it.
 */

export type EmployeeRole = 'pending' | 'viewer' | 'buyer' | 'manager' | 'executive'
export type EmployeeStatus = 'pending' | 'active' | 'suspended' | 'offboarded'

export interface Employee {
  id: string
  email: string
  full_name: string | null
  role: EmployeeRole
  status: EmployeeStatus
  last_active_at: string | null
}

/** Declaration order matters — it mirrors the Postgres enum, which compares ordinally. */
const ROLE_ORDER: EmployeeRole[] = ['pending', 'viewer', 'buyer', 'manager', 'executive']

export function roleAtLeast(role: EmployeeRole, min: EmployeeRole): boolean {
  return ROLE_ORDER.indexOf(role) >= ROLE_ORDER.indexOf(min)
}
