'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { roleAtLeast, type EmployeeRole } from '@/lib/roles'
import { Button } from '@/components/ui'

interface DocumentOption {
  label: string
  /** When to use it. The type names alone are what was unclear. */
  when: string
  href: string
  minRole: EmployeeRole
}

const OPTIONS: DocumentOption[] = [
  {
    label: 'Receipt',
    when: 'Goods arrived from a supplier',
    href: '/receive',
    minRole: 'buyer',
  },
  {
    label: 'Issue',
    when: 'Goods went out — sold, dispatched or used',
    href: '/entry',
    minRole: 'buyer',
  },
  {
    label: 'Transfer',
    when: 'Stock moved between locations',
    href: '/transfer',
    minRole: 'buyer',
  },
  {
    label: 'Adjustment',
    when: 'Correct a miscount, damage or a find',
    href: '/adjust',
    minRole: 'manager',
  },
]

/**
 * Starts a new document from the register.
 *
 * The five document types need materially different forms — a receipt needs a
 * supplier, a transfer needs a destination, an adjustment needs a direction
 * and a reason — so this routes to the screen that owns each type rather than
 * duplicating four working entry screens here.
 *
 * Nothing is created on this page. The register stays read-only (§7.6); this
 * is navigation with the type explained, which is what was missing.
 */
export function NewDocumentMenu({ role }: { role: EmployeeRole }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const available = OPTIONS.filter((option) => roleAtLeast(role, option.minRole))

  useEffect(() => {
    if (!open) return

    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        // Focus returns to the trigger, or a keyboard user is stranded.
        triggerRef.current?.focus()
      }
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // A viewer can read this page but cannot post anything. A menu whose every
  // option redirects them away is worse than no menu.
  if (available.length === 0) return null

  return (
    <div ref={containerRef} className="relative">
      <Button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        New document
      </Button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-72 overflow-hidden rounded-xl border border-line bg-surface-card shadow-lg"
        >
          {available.map((option) => (
            <button
              key={option.href}
              role="menuitem"
              onClick={() => {
                setOpen(false)
                router.push(option.href)
              }}
              className="block w-full border-b border-line px-4 py-3 text-left last:border-0 hover:bg-surface-subtle"
            >
              <span className="block text-sm font-medium text-text-primary">{option.label}</span>
              <span className="block text-xs text-text-secondary">{option.when}</span>
            </button>
          ))}

          {/* Listed rather than omitted: the register's filter tabs already
              advertise Count, so leaving it out here would recreate exactly
              the confusion this menu exists to fix. */}
          <div className="border-t border-line bg-surface-subtle px-4 py-3">
            <span className="block text-sm text-text-muted">Count</span>
            <span className="block text-xs text-text-muted">
              Cycle counting is not built yet. Use Adjustment to correct stock you have counted.
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
