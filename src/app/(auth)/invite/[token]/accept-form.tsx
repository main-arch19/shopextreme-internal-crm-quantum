'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { acceptInvite } from './actions'

export function AcceptInviteForm({ token, email }: { token: string; email: string }) {
  const router = useRouter()
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    const result = await acceptInvite(token, fullName, password)

    if (!result.ok) {
      setError(result.error ?? 'Could not create the account.')
      setBusy(false)
      return
    }

    // Sign in with the credentials just set, so the invitee lands inside
    // rather than at a login screen they have no reason to expect.
    const supabase = createClient()
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })

    if (signInError) {
      router.push('/login')
      return
    }

    router.refresh()
    router.push('/overview')
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Full name
        <input
          type="text"
          required
          autoComplete="name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="rounded border border-neutral-300 px-3 py-2 focus:outline-2 focus:outline-offset-2 focus:outline-blue-600 dark:border-neutral-700 dark:bg-neutral-900"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Password
        <input
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded border border-neutral-300 px-3 py-2 focus:outline-2 focus:outline-offset-2 focus:outline-blue-600 dark:border-neutral-700 dark:bg-neutral-900"
        />
        <span className="text-xs text-neutral-500">At least 12 characters.</span>
      </label>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="rounded bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
      >
        {busy ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  )
}
