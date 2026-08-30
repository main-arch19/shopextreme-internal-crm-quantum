import { requireRole } from '@/lib/auth'
import { AdminNav } from './admin-nav'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Managers and above (§1.1). RLS enforces the same thing at the data layer,
  // so this only decides what to render.
  await requireRole('manager')

  // No container of its own. The app layout already supplies padding and the
  // sidebar offset; wrapping again here applied both twice and constrained
  // the content column enough to push page actions out of view.
  return (
    <>
      <AdminNav />
      {children}
    </>
  )
}
