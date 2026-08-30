import { redirect } from 'next/navigation'
import { getEmployee } from '@/lib/auth'
import { SignOutButton } from './sign-out-button'

// Reads cookies and environment per request; prerendering would bake in
// whatever configuration existed at build time.
export const dynamic = 'force-dynamic'

/**
 * The only screen a non-active employee can see (§9.1).
 *
 * A signed-up but unapproved user authenticates successfully and every query
 * returns zero rows — so there is nothing to show them but their own status.
 * That is the default-deny design working as intended, not an error state.
 */
export default async function PendingPage() {
  const employee = await getEmployee()

  if (!employee) redirect('/login')
  if (employee.status === 'active' && employee.role !== 'pending') redirect('/overview')

  const message: Record<string, string> = {
    pending: 'Your account is waiting for approval. An administrator will review it shortly.',
    suspended: 'Your access has been suspended. Contact an administrator if you think this is wrong.',
    offboarded: 'This account is no longer active.',
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-xl font-semibold">Inventory</h1>
      <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
        {message[employee.status] ?? message.pending}
      </p>
      <p className="mt-2 text-xs text-neutral-500">Signed in as {employee.email}</p>
      <SignOutButton />
    </main>
  )
}
