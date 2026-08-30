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

/** Why a variable is unusable. "absent" and "placeholder" need different fixes. */
export type VarProblem = 'absent' | 'placeholder' | 'malformed'

export interface RejectedVar {
  name: string
  problem: VarProblem
}

export type ConfigResult =
  | { ok: true; config: SupabaseConfig }
  | { ok: false; rejected: RejectedVar[] }

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
 * The exact placeholder strings shipped in .env.example.
 *
 * Matched exactly, not as substrings. An earlier version rejected anything
 * containing "xxxxx", which would have thrown out a legitimate Supabase URL
 * whose random project reference happened to contain five x's — a false
 * negative in the very code meant to end false diagnoses.
 */
const PLACEHOLDERS = new Set([
  'https://xxxxx.supabase.co',
  'eyJ...',
  'eyJhbGciOi…',
  'your-project-url',
  'your-anon-key',
])

function classify(value: string | undefined, expectUrl: boolean): VarProblem | null {
  if (value === undefined) return 'absent'

  const trimmed = value.trim()
  if (trimmed.length === 0) return 'absent'
  if (PLACEHOLDERS.has(trimmed)) return 'placeholder'

  if (expectUrl) {
    // A trailing newline or a stray quote from pasting produces a value that
    // is present but does not parse, failing the same opaque way as absence.
    try {
      new URL(trimmed)
    } catch {
      return 'malformed'
    }
  }

  return null
}

export function readSupabaseConfig(): ConfigResult {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  const rejected: RejectedVar[] = []

  const urlProblem = classify(url, true)
  if (urlProblem) rejected.push({ name: 'NEXT_PUBLIC_SUPABASE_URL', problem: urlProblem })

  const keyProblem = classify(anonKey, false)
  if (keyProblem) rejected.push({ name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', problem: keyProblem })

  if (rejected.length > 0) return { ok: false, rejected }

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
    const detail = result.rejected.map((r) => `${r.name} (${r.problem})`).join(', ')
    throw new Error(
      `Supabase is not configured: ${detail}. ` +
        `Set these in your hosting environment (Vercel → Settings → Environment ` +
        `Variables) or in .env.local for local development, then redeploy.`,
    )
  }

  return result.config
}
