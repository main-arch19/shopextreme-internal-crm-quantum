import type { ReactNode } from 'react'

/**
 * Shared primitives, token-based.
 *
 * These exist because the same table, card and form markup was repeated
 * across 18 files with 311 hardcoded colour classes between them. Every
 * colour here resolves to a CSS variable, so the client's branding at phase
 * 10 is a change to globals.css rather than another 311 edits.
 */

export function Card({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={`rounded-xl border border-line bg-surface-card ${className}`}
    >
      {children}
    </div>
  )
}

export function CardHeader({
  title,
  actions,
}: {
  title: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
      <h2 className="text-base font-semibold text-text-primary">{title}</h2>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

export function PageTitle({
  children,
  actions,
}: {
  children: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 pl-14 md:pl-0">
      {/* pl-14 clears the fixed mobile menu button, which would otherwise sit
          on top of the heading. */}
      <h1 className="text-lg font-semibold text-text-primary">{children}</h1>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/**
 * Wraps a table so wide content scrolls inside its own container rather than
 * the page body — a horizontally scrolling page is unusable on a phone, and
 * these tables are wide.
 */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="w-full overflow-x-auto">{children}</div>
}

export function Table({ children }: { children: ReactNode }) {
  return <table className="w-full border-collapse text-sm">{children}</table>
}

export function Th({
  children,
  align = 'left',
}: {
  children?: ReactNode
  align?: 'left' | 'right'
}) {
  return (
    <th
      className={`whitespace-nowrap bg-surface-subtle px-3 py-2.5 font-medium text-text-secondary ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  )
}

export function Td({
  children,
  align = 'left',
  className = '',
}: {
  children?: ReactNode
  align?: 'left' | 'right'
  className?: string
}) {
  // Rows stay dense. §7.2 is explicit that card grids and generous padding
  // "photograph well and fall apart at real catalog size" — a buyer scans
  // this daily and needs rows per screen, not whitespace.
  return (
    <td
      className={`px-3 py-2 text-text-primary ${
        align === 'right' ? 'text-right tabular-nums' : ''
      } ${className}`}
    >
      {children}
    </td>
  )
}

export function Tr({
  children,
  muted = false,
}: {
  children: ReactNode
  muted?: boolean
}) {
  return (
    <tr
      className={`border-b border-line last:border-0 ${muted ? 'text-text-muted' : ''}`}
    >
      {children}
    </tr>
  )
}

export type Tone = 'neutral' | 'danger' | 'warning' | 'success'

export function StatusBadge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  const tones: Record<Tone, string> = {
    neutral: 'bg-surface-subtle text-text-secondary',
    danger: 'bg-danger-bg text-danger',
    warning: 'bg-warning-bg text-warning',
    success: 'bg-success-bg text-success',
  }
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  )
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const buttonStyles: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg hover:opacity-90',
  secondary: 'border border-line text-text-primary hover:bg-surface-subtle',
  ghost: 'text-text-secondary hover:text-text-primary underline',
  danger: 'text-danger hover:opacity-80 underline',
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const base =
    variant === 'ghost' || variant === 'danger'
      ? 'text-sm disabled:opacity-50'
      : 'rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50'

  return <button className={`${base} ${buttonStyles[variant]} ${className}`} {...props} />
}

/** Shared field styling. py-2.5 keeps a comfortable touch target on a phone. */
export const fieldClass =
  'w-full rounded-lg border border-line bg-surface-card px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted'

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="flex flex-col gap-1 text-sm text-text-secondary">
      {label}
      {children}
      {hint && <span className="text-xs text-text-muted">{hint}</span>}
    </label>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-text-muted">{children}</p>
}
