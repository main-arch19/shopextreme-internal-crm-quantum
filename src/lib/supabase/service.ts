import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * Service-role client. BYPASSES ALL ROW LEVEL SECURITY.
 *
 * Legitimate uses are limited to work that has no user behind it:
 *   - the nightly stock snapshot job
 *   - the nightly audit chain verification job
 *   - the invite-acceptance route, which must create an auth user and an
 *     employees row for someone who is not yet an employee and therefore
 *     cannot pass is_active_employee()
 *
 * Never call this from a page, a Server Component, or any route that acts on
 * behalf of a signed-in user — use `createClient()` from ./server instead.
 * A service-role client in a request path makes every RLS policy in the
 * system decorative, and the failure is silent: queries succeed and return
 * data the caller should never have seen.
 *
 * Note that even this client cannot mutate audit_log or stock_movements: the
 * UPDATE/DELETE grants are revoked from service_role, and trigger backstops
 * raise regardless (§10.3).
 */
export function serviceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. This client is for scheduled jobs only.',
    )
  }

  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
