import Link from 'next/link'
import { requireActiveEmployee } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Card, CardHeader, EmptyState, PageTitle, StatusBadge } from '@/components/ui'

// Reads cookies and environment per request; prerendering would bake in
// whatever configuration existed at build time.
export const dynamic = 'force-dynamic'

interface LocationActivity {
  location_id: string
  code: string
  name: string
  last_movement_at: string | null
}

/**
 * Overview (§7.9) — a 15-second health read.
 *
 * Partial: stock value, items below reorder point, dead stock and turns all
 * need the metrics layer and snapshot history from phases 4 and 5, which are
 * not built. What ships here is what the ledger can already answer, plus the
 * one panel that matters most before any of that exists.
 *
 * "Last movement recorded, per location" is not a nice-to-have. §3 identifies
 * the defining risk of a people-fed system: it fails silently. Nobody enters
 * Friday's dispatches, on-hand quietly runs high, and nothing contradicts the
 * wrong number until someone finds an empty shelf. This panel is the
 * mechanism that makes that silence visible — absence of data, shown as data.
 */
export default async function OverviewPage() {
  const employee = await requireActiveEmployee()
  const supabase = await createClient()

  const [{ data: activity }, { count: itemCount }, { count: docCount }] = await Promise.all([
    supabase.from('location_activity').select('*').order('code'),
    supabase.from('items').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('documents').select('id', { count: 'exact', head: true }).eq('status', 'POSTED'),
  ])

  const locations = (activity ?? []) as LocationActivity[]

  // Clock read once per request, outside the component body, so every badge
  // is measured against the same instant and the render stays pure.
  const staleness = locations.map((location) => describeStaleness(location.last_movement_at))

  // While nothing has been set up, the overview's job is to say what to do
  // first — not to show three zeroes.
  const needsSetup = (itemCount ?? 0) === 0 || locations.length === 0 || (docCount ?? 0) === 0

  return (
    <>
      <PageTitle>Overview</PageTitle>

      {needsSetup && (
        <Card className="mb-4 p-4">
          <h2 className="text-base font-semibold text-text-primary">Getting started</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Stock only changes through a posted document, so these come in order.
          </p>
          <ol className="mt-3 flex flex-col gap-2 text-sm">
            <SetupStep done={locations.length > 0} href="/admin/locations">
              Add a location — a warehouse, shop or van
            </SetupStep>
            <SetupStep done={(itemCount ?? 0) > 0} href="/admin/items">
              Add items, or import an existing spreadsheet
            </SetupStep>
            <SetupStep done={(docCount ?? 0) > 0} href="/receive">
              Record opening stock as a receipt
            </SetupStep>
          </ol>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Active items" value={itemCount ?? 0} />
        <Stat label="Posted documents" value={docCount ?? 0} />
        <Stat label="Locations" value={locations.length} />
      </div>

      <div className="mt-4">
        <Card>
          <CardHeader title="Last movement recorded" />
          {locations.length === 0 ? (
            <EmptyState>
              No locations yet.{' '}
              {(employee.role === 'manager' || employee.role === 'executive') && (
                <Link href="/admin/locations" className="underline">
                  Add one
                </Link>
              )}
            </EmptyState>
          ) : (
            <ul>
              {locations.map((location, index) => {
                const { tone, text } = staleness[index]
                return (
                  <li
                    key={location.location_id}
                    className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-0"
                  >
                    <div className="min-w-0">
                      <span className="font-mono text-sm text-text-primary">{location.code}</span>
                      <span className="ml-2 truncate text-sm text-text-secondary">
                        {location.name}
                      </span>
                    </div>
                    <StatusBadge tone={tone}>{text}</StatusBadge>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>

      <p className="mt-4 text-xs text-text-muted">
        Stock value, reorder urgency and dead stock appear here once the metrics layer and daily
        snapshots are in place.
      </p>
    </>
  )
}

/**
 * How long since a location last recorded anything.
 *
 * Three days without an entry is an alert, not a gap in a chart (§3), and the
 * wording is time rather than a threshold — "4 days ago" says what is
 * happening, "stale" only says a rule fired (§7.2).
 */
function describeStaleness(iso: string | null): { tone: 'warning' | 'danger' | 'success'; text: string } {
  if (iso === null) return { tone: 'warning', text: 'nothing recorded yet' }

  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)

  if (days >= 3) return { tone: 'danger', text: `${days} days ago` }
  if (days === 0) return { tone: 'success', text: 'today' }
  if (days === 1) return { tone: 'success', text: 'yesterday' }
  return { tone: 'success', text: `${days} days ago` }
}

function SetupStep({
  done,
  href,
  children,
}: {
  done: boolean
  href: string
  children: React.ReactNode
}) {
  return (
    <li className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${
          done ? 'border-success bg-success-bg text-success' : 'border-line text-text-muted'
        }`}
      >
        {done ? '✓' : ''}
      </span>
      {done ? (
        <span className="text-text-muted line-through">{children}</span>
      ) : (
        <Link href={href} className="text-text-primary underline">
          {children}
        </Link>
      )}
    </li>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-text-secondary">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-text-primary">{value}</p>
    </Card>
  )
}
