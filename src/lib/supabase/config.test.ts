import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readSupabaseConfig } from './config.ts'

/**
 * Run with: npm test
 *
 * These exist because an earlier version of this validator rejected any value
 * containing "xxxxx" as a placeholder. Supabase project references are random
 * strings, so a legitimate URL could have been thrown out — a false negative
 * in the exact code written to end false diagnoses.
 */

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {}
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key]
    if (vars[key] === undefined) delete process.env[key]
    else process.env[key] = vars[key]
  }
  try {
    fn()
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test('accepts a valid URL and key', () => {
  withEnv(
    {
      NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefgh.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test',
    },
    () => {
      const result = readSupabaseConfig()
      assert.equal(result.ok, true)
    },
  )
})

test('a project ref containing five x characters is NOT rejected', () => {
  // The regression this file exists for. Real Supabase refs are random, so
  // "xxxxx" can legitimately occur inside one.
  withEnv(
    {
      NEXT_PUBLIC_SUPABASE_URL: 'https://axxxxxbcd.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiJ9.real',
    },
    () => {
      const result = readSupabaseConfig()
      assert.equal(result.ok, true, 'a legitimate URL was rejected as a placeholder')
    },
  )
})

test('reports both as absent when unset', () => {
  withEnv(
    { NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined },
    () => {
      const result = readSupabaseConfig()
      assert.equal(result.ok, false)
      if (result.ok) return
      assert.equal(result.rejected.length, 2)
      assert.ok(result.rejected.every((r) => r.problem === 'absent'))
    },
  )
})

test('distinguishes a placeholder from an absent value', () => {
  withEnv(
    {
      NEXT_PUBLIC_SUPABASE_URL: 'https://xxxxx.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
    },
    () => {
      const result = readSupabaseConfig()
      assert.equal(result.ok, false)
      if (result.ok) return

      const url = result.rejected.find((r) => r.name === 'NEXT_PUBLIC_SUPABASE_URL')
      const key = result.rejected.find((r) => r.name === 'NEXT_PUBLIC_SUPABASE_ANON_KEY')
      assert.equal(url?.problem, 'placeholder')
      assert.equal(key?.problem, 'absent')
    },
  )
})

test('reports a malformed URL distinctly', () => {
  withEnv(
    {
      NEXT_PUBLIC_SUPABASE_URL: 'not a url at all',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'eyJvalid',
    },
    () => {
      const result = readSupabaseConfig()
      assert.equal(result.ok, false)
      if (result.ok) return
      assert.equal(result.rejected[0].problem, 'malformed')
    },
  )
})

test('whitespace-only is absent, and real values are trimmed', () => {
  withEnv(
    {
      NEXT_PUBLIC_SUPABASE_URL: '   ',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: '  eyJkey  ',
    },
    () => {
      const result = readSupabaseConfig()
      assert.equal(result.ok, false)
      if (result.ok) return
      assert.equal(result.rejected.length, 1)
      assert.equal(result.rejected[0].problem, 'absent')
    },
  )

  withEnv(
    {
      NEXT_PUBLIC_SUPABASE_URL: '  https://abc.supabase.co  ',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: '  eyJkey  ',
    },
    () => {
      const result = readSupabaseConfig()
      assert.equal(result.ok, true)
      if (!result.ok) return
      // A trailing newline from a paste would otherwise reach the Supabase
      // client and fail there instead.
      assert.equal(result.config.url, 'https://abc.supabase.co')
      assert.equal(result.config.anonKey, 'eyJkey')
    },
  )
})
