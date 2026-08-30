'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/admin/items', label: 'Items' },
  { href: '/admin/locations', label: 'Locations' },
  { href: '/admin/suppliers', label: 'Suppliers' },
]

/**
 * Sub-navigation for the catalog screens.
 *
 * `pl-14` below `md` clears the fixed sidebar trigger, which would otherwise
 * sit on top of the first tab.
 */
export function AdminNav() {
  const pathname = usePathname()

  return (
    <nav className="mb-4 flex gap-1 pl-14 text-sm md:pl-0">
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(tab.href + '/')
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`rounded-lg px-3 py-1.5 transition-colors ${
              active
                ? 'bg-surface-card font-medium text-text-primary'
                : 'text-text-secondary hover:bg-surface-card'
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
