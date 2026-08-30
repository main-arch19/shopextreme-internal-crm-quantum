import { requireActiveEmployee } from '@/lib/auth'
import { Sidebar } from '@/components/sidebar'
import { ThemeToggle } from '@/components/theme-toggle'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const employee = await requireActiveEmployee()

  return (
    <div className="min-h-screen bg-surface-page">
      <Sidebar employee={employee} />

      {/* Offset for the fixed sidebar on desktop; full width below md, where
          the sidebar becomes a slide-over. */}
      <div className="md:pl-64">
        <header className="flex h-14 items-center justify-end gap-3 border-b border-line bg-surface-card px-4">
          {/* No search box and no notification bell, both of which the mockup
              shows. Search is not in the spec and item detail (§7.3) is not
              built, so there is nowhere for a result to land. Nothing
              generates notifications until §11 alerting in phase 9, and a
              bell that never rings misrepresents the system's state. */}
          <ThemeToggle />
        </header>

        <main className="px-4 py-6 md:px-6">{children}</main>
      </div>
    </div>
  )
}
