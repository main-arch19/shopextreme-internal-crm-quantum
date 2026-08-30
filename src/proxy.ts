import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { readSupabaseConfig } from '@/lib/supabase/config'

/**
 * Refreshes the Supabase session cookie on every request.
 *
 * This is session plumbing, not authorization. It deliberately does not check
 * roles or redirect based on employment status: this runs at the edge against
 * a cookie, and treating that as the gate would put the security boundary in
 * the wrong place. Authorization lives in RLS, re-read from the database on
 * every query (§9.1), so a stale or forged cookie reaches nothing.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  // Without configuration, pass the request through untouched rather than
  // crashing. This runs on every path the matcher covers, so throwing here
  // returns 500 for the entire site — including /login and the setup page
  // that would explain the problem.
  //
  // Skipping session refresh is harmless when Supabase is unreachable: there
  // can be no signed-in sessions to refresh.
  const configResult = readSupabaseConfig()
  if (!configResult.ok) return response

  const supabase = createServerClient(
    configResult.config.url,
    configResult.config.anonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // Must be getUser(), not getSession(). getSession() trusts the cookie
  // without contacting the auth server, so a revoked session would keep
  // refreshing itself here.
  await supabase.auth.getUser()

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
