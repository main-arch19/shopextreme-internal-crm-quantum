'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { NAV_ITEMS } from './nav-items'
// From roles.ts, not auth.ts: this is a client component, and auth.ts pulls
// in next/headers at module scope.
import { roleAtLeast, type Employee } from '@/lib/roles'

/**
 * Sidebar, per the supplied mockup: profile block at the top, navigation,
 * sign-out pinned to the bottom.
 *
 * Fixed on desktop, a slide-over below `md`. That breakpoint matters more
 * than usual here — §3 requires entry to work one-handed on a phone, because
 * the person receiving goods is standing at a door rather than sitting at a
 * desk. A sidebar that ate that screen would defeat the entry-speed targets
 * the whole design rests on.
 */
export function Sidebar({ employee }: { employee: Employee }) {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const visible = NAV_ITEMS.filter(
    (item) => !item.minRole || roleAtLeast(employee.role, item.minRole),
  )

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.refresh()
    router.push('/login')
  }

  const nav = (
    <>
      <div className="px-4 py-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-sidebar-active-bg text-base font-semibold text-sidebar-active-fg">
          {(employee.full_name ?? employee.email).charAt(0).toUpperCase()}
        </div>
        <p className="mt-3 truncate text-sm font-medium text-sidebar-fg">
          {employee.full_name ?? employee.email}
        </p>
        <p className="truncate text-xs text-sidebar-fg-muted">{employee.email}</p>
        <p className="mt-1 text-xs capitalize text-sidebar-fg-muted">{employee.role}</p>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-2">
        {visible.map((item) => {
          // startsWith so /admin/items/labels keeps Catalog highlighted.
          const active = pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                active
                  ? 'bg-sidebar-active-bg font-medium text-sidebar-active-fg'
                  : 'text-sidebar-fg-muted hover:bg-sidebar-active-bg/50 hover:text-sidebar-fg'
              }`}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="shrink-0"
              >
                <path d={item.icon} />
              </svg>
              {item.label}
            </Link>
          )
        })}
      </nav>

      <button
        onClick={signOut}
        className="m-2 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-sidebar-fg-muted transition-colors hover:bg-sidebar-active-bg/50 hover:text-sidebar-fg"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="shrink-0"
        >
          <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
        </svg>
        Sign out
      </button>
    </>
  )

  return (
    <>
      {/* Mobile trigger. 44px square — a thumb target, not a pointer target. */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        className="fixed left-3 top-3 z-30 flex h-11 w-11 items-center justify-center rounded-lg border border-line bg-surface-card text-text-secondary md:hidden"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-sidebar-bg transition-transform md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {nav}
      </aside>
    </>
  )
}
