import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Per-request Supabase client carrying the caller's JWT.
 *
 * This is the client every user-initiated read and write must use. RLS is the
 * entire access-control design (§9.1), and RLS only applies to a client that
 * carries a user identity. A service-role client in a request path silently
 * bypasses every policy in the system, so `serviceClient()` below is
 * deliberately kept in a separate module-level function with a loud name.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Middleware refreshes the session, so this is safe to swallow.
          }
        },
      },
    },
  )
}
