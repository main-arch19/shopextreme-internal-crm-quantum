import { requireActiveEmployee } from '@/lib/auth'

/**
 * Placeholder. The real 15-second health read lands in phase 5 (§7.9), once
 * there is a ledger and snapshot history to read from.
 */
export default async function OverviewPage() {
  const employee = await requireActiveEmployee()

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-xl font-semibold">Overview</h1>
      <p className="mt-2 text-sm text-neutral-500">
        Signed in as {employee.full_name ?? employee.email} — {employee.role}
      </p>
      <p className="mt-6 text-sm text-neutral-600 dark:text-neutral-400">
        Stock figures appear here once the ledger is in place.
      </p>
    </main>
  )
}
