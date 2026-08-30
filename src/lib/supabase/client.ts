import { createBrowserClient } from '@supabase/ssr'
import { requireSupabaseConfig } from './config'

/**
 * Browser client. Used for auth flows and for the quick-entry screen's
 * search-as-you-type, where a round trip through a Server Action would cost
 * more latency than the §3 entry targets allow.
 *
 * Everything it can reach is gated by RLS, so a compromised browser session
 * reaches exactly what that employee's role reaches and nothing more.
 */
export function createClient() {
  const { url, anonKey } = requireSupabaseConfig()
  return createBrowserClient(url, anonKey)
}
