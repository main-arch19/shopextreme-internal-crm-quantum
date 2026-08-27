import Link from 'next/link'
import { requireRole } from '@/lib/auth'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Managers and above (§1.1). RLS enforces the same thing at the data layer,
  // so this only decides what to render.
  await requireRole('manager')

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <nav className="flex gap-3 text-sm">
        <Link href="/admin/items" className="hover:underline">
          Items
        </Link>
        <Link href="/admin/locations" className="hover:underline">
          Locations
        </Link>
        <Link href="/admin/suppliers" className="hover:underline">
          Suppliers
        </Link>
      </nav>
      <div className="mt-4">{children}</div>
    </div>
  )
}
