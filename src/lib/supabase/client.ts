import { createBrowserClient } from '@supabase/ssr'

/**
 * Browser client. Used for auth flows and for the quick-entry screen's
 * search-as-you-type, where a round trip through a Server Action would cost
 * more latency than the §3 entry targets allow.
 *
 * Everything it can reach is gated by RLS, so a compromised browser session
 * reaches exactly what that employee's role reaches and nothing more.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
