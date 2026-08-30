import type { EmployeeRole } from '@/lib/auth'

export interface NavItem {
  href: string
  label: string
  /** Minimum role. Omitted means any active employee. */
  minRole?: EmployeeRole
  /** Inline SVG path data, 24x24 viewBox, stroked. */
  icon: string
}

/**
 * Sidebar navigation.
 *
 * Only screens that exist. The supplied mockup also listed Orders, Purchase,
 * Reporting, Support and Settings — none of those are built, and purchase
 * orders are phase 6, explicitly outside the approved scope. Linking to them,
 * even greyed out, would misrepresent what the system does: a disabled
 * control implies a permission problem, when the truth is the feature does
 * not exist.
 *
 * Reorder joins this list when phase 5 ships.
 */
export const NAV_ITEMS: NavItem[] = [
  {
    href: '/overview',
    label: 'Overview',
    icon: 'M3 3h7v7H3zM14 3h7v4h-7zM14 11h7v10h-7zM3 14h7v7H3z',
  },
  {
    href: '/entry',
    label: 'Quick entry',
    icon: 'M12 5v14M5 12h14',
  },
  {
    href: '/receive',
    label: 'Receive',
    icon: 'M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z',
  },
  {
    href: '/documents',
    label: 'Documents',
    icon: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
  },
  {
    href: '/admin/items',
    label: 'Catalog',
    minRole: 'manager',
    icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
  },
]
