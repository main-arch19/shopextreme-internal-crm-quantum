/**
 * Supabase configuration, read once and validated.
 *
 * Exists because `process.env.NEXT_PUBLIC_SUPABASE_URL!` is a TypeScript
 * assertion that compiles away — it checks nothing at runtime. When the value
 * is undefined the Supabase client throws deep inside its own constructor,
 * and because the proxy runs on every request, the whole site returns 500
 * with no indication of which variable is missing.
 *
 * Returning a discriminated union forces callers to handle absence rather
 * than assert it away.
 */

export interface SupabaseConfig {
  url: string
  anonKey: string
}

export type ConfigResult =
  | { ok: true; config: SupabaseConfig }
  | { ok: false; missing: string[] }

/** Env var names, with where each is found. Shown on the setup page. */
export const REQUIRED_PUBLIC_VARS = [
  {
    name: 'NEXT_PUBLIC_SUPABASE_URL',
    where: 'Supabase → Project Settings → API → Project URL',
    example: 'https://abcdefgh.supabase.co',
  },
  {
    name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    where: 'Supabase → Project Settings → API → anon public key',
    example: 'eyJhbGciOi…',
  },
] as const

/**
 * A value that is present but unusable is as broken as a missing one, and
 * currently fails identically. Treat a placeholder or an unparseable URL as
 * absent so the setup page names it.
 */
function usable(value: string | undefined): value is string {
  if (!value) return false
  const trimmed = value.trim()
  if (trimmed.length === 0) return false
  // Values copied from a template rather than the dashboard.
  if (trimmed.startsWith('your-') || trimmed.includes('xxxxx')) return false
  return true
}

export function readSupabaseConfig(): ConfigResult {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  const missing: string[] = []

  if (!usable(url)) {
    missing.push('NEXT_PUBLIC_SUPABASE_URL')
  } else {
    // A trailing newline or a stray quote from pasting produces a value that
    // is present but does not parse, which fails the same opaque way.
    try {
      new URL(url.trim())
    } catch {
      missing.push('NEXT_PUBLIC_SUPABASE_URL')
    }
  }

  if (!usable(anonKey)) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY')

  if (missing.length > 0) return { ok: false, missing }

  return {
    ok: true,
    config: { url: url!.trim(), anonKey: anonKey!.trim() },
  }
}

export function isSupabaseConfigured(): boolean {
  return readSupabaseConfig().ok
}

/**
 * For the server clients, which cannot render a page and must throw. The
 * message names the variable so the runtime log is self-explanatory.
 */
export function requireSupabaseConfig(): SupabaseConfig {
  const result = readSupabaseConfig()

  if (!result.ok) {
    throw new Error(
      `Supabase is not configured. Missing or invalid: ${result.missing.join(', ')}. ` +
        `Set these in your hosting environment (Vercel → Settings → Environment ` +
        `Variables) or in .env.local for local development, then redeploy.`,
    )
  }

  return result.config
}
