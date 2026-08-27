import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

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

/**
 * Returns the signed-in employee, or null.
 *
 * This is a convenience for rendering — deciding what to show. It is NOT the
 * access control. Every table is gated by RLS calling is_active_employee(),
 * so a caller who skips this helper still cannot read or write anything.
 * Client-side route guards are cosmetic; anyone can call the API directly
 * (§9.1).
 */
export async function getEmployee(): Promise<Employee | null> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('employees')
    .select('id, email, full_name, role, status, last_active_at')
    .eq('id', user.id)
    .maybeSingle()

  return (data as Employee) ?? null
}

/**
 * Gate a page on active employment. Sends unauthenticated users to login and
 * everyone else — pending, suspended, offboarded — to the waiting screen,
 * which is the only thing they can see (§9.1).
 */
export async function requireActiveEmployee(): Promise<Employee> {
  const employee = await getEmployee()

  if (!employee) redirect('/login')
  if (employee.status !== 'active' || employee.role === 'pending') redirect('/pending')

  return employee
}

/** Gate a page on a minimum role. Renders a 404-equivalent rather than a 403. */
export async function requireRole(min: EmployeeRole): Promise<Employee> {
  const employee = await requireActiveEmployee()
  if (!roleAtLeast(employee.role, min)) redirect('/overview')
  return employee
}
