'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function SignOutButton() {
  const router = useRouter()

  async function onClick() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.refresh()
    router.push('/login')
  }

  return (
    <button
      onClick={onClick}
      className="mt-6 self-start rounded border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700"
    >
      Sign out
    </button>
  )
}
