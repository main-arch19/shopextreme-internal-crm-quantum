import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { roleAtLeast, type Employee, type EmployeeRole } from '@/lib/roles'

// Re-exported so callers can keep importing these from auth.ts. The
// definitions live in roles.ts because this module imports next/headers,
// which is unavailable to client components.
export { roleAtLeast } from '@/lib/roles'
export type { Employee, EmployeeRole, EmployeeStatus } from '@/lib/roles'




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
  // Every guarded route reaches this function, so the configuration check
  // lives here rather than being repeated in each page. Without it,
  // createClient() throws and the page returns an opaque 500.
  if (!isSupabaseConfigured()) redirect('/setup')

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
