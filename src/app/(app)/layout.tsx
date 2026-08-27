import Link from 'next/link'
import { requireActiveEmployee } from '@/lib/auth'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const employee = await requireActiveEmployee()

  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 py-3 text-sm">
          <Link href="/overview" className="font-semibold">
            Inventory
          </Link>
          <Link href="/entry" className="text-neutral-600 hover:underline dark:text-neutral-400">
            Entry
          </Link>
          <Link href="/receive" className="text-neutral-600 hover:underline dark:text-neutral-400">
            Receive
          </Link>
          <Link href="/documents" className="text-neutral-600 hover:underline dark:text-neutral-400">
            Documents
          </Link>
          {/* Managers and above only — RLS blocks the data regardless, but a
              link to a page that redirects is just noise for a buyer. */}
          {(employee.role === 'manager' || employee.role === 'executive') && (
            <Link href="/admin/items" className="text-neutral-600 hover:underline dark:text-neutral-400">
              Catalog
            </Link>
          )}
          <span className="ml-auto text-xs text-neutral-500">
            {employee.full_name ?? employee.email} · {employee.role}
          </span>
        </nav>
      </header>
      {children}
    </div>
  )
}
