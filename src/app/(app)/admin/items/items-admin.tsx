'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createItem, setItemActive } from '../actions'
import { ImportPanel } from '../import-panel'
import { ITEM_UNITS, SKU_PREFIX_PATTERN, type Item, type ItemUnit, type Supplier } from '@/lib/catalog/types'
import {
  Button,
  Card,
  EmptyState,
  Field,
  PageTitle,
  StatusBadge,
  Table,
  TableWrap,
  Td,
  Th,
  Tr,
  fieldClass,
} from '@/components/ui'

export function ItemsAdmin({ items, suppliers }: { items: Item[]; suppliers: Supplier[] }) {
  const router = useRouter()
  const [showNew, setShowNew] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showInactive, setShowInactive] = useState(false)

  const visible = showInactive ? items : items.filter((i) => i.is_active)

  return (
    <>
      {/* Actions live in PageTitle's actions slot rather than bespoke markup.
          Hand-rolled header rows are what let these buttons drift out of view
          when the surrounding layout changed. */}
      <PageTitle
        actions={
          <>
            <Button variant="secondary" onClick={() => setShowImport((v) => !v)}>
              Import CSV
            </Button>
            <Link
              href="/admin/items/labels"
              className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface-subtle"
            >
              Print labels
            </Link>
            <Button onClick={() => setShowNew((v) => !v)}>New item</Button>
          </>
        }
      >
        Items
      </PageTitle>

      {showImport && (
        <ImportPanel
          onDone={() => {
            setShowImport(false)
            router.refresh()
          }}
        />
      )}

      {showNew && (
        <NewItemForm
          suppliers={suppliers}
          onDone={() => {
            setShowNew(false)
            router.refresh()
          }}
        />
      )}

      <label className="mb-3 flex items-center gap-2 text-sm text-text-secondary">
        <input
          type="checkbox"
          checked={showInactive}
          onChange={(e) => setShowInactive(e.target.checked)}
        />
        Show deactivated
      </label>

      <Card>
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>SKU</Th>
                <Th>Name</Th>
                <Th>Unit</Th>
                <Th align="right">Cost</Th>
                <Th align="right">Price</Th>
                <Th>Supplier</Th>
                <Th align="right"> </Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <Tr key={item.id} muted={!item.is_active}>
                  <Td className="whitespace-nowrap font-mono">
                    {item.sku}
                    {item.is_serialized && (
                      <span className="ml-2">
                        <StatusBadge>serial</StatusBadge>
                      </span>
                    )}
                  </Td>
                  <Td>{item.name}</Td>
                  <Td>{item.unit}</Td>
                  <Td align="right">{item.unit_cost ?? '—'}</Td>
                  <Td align="right">{item.sell_price ?? '—'}</Td>
                  <Td className="text-text-secondary">
                    {suppliers.find((s) => s.id === item.supplier_id)?.name ?? '—'}
                  </Td>
                  <Td align="right">
                    <Button
                      variant="ghost"
                      onClick={async () => {
                        await setItemActive(item.id, !item.is_active)
                        router.refresh()
                      }}
                    >
                      {item.is_active ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>

        {visible.length === 0 && (
          <EmptyState>
            {items.length === 0 ? (
              <>
                No items yet. Use <strong>New item</strong> above to add one, or{' '}
                <strong>Import CSV</strong> to bring in an existing spreadsheet.
              </>
            ) : (
              'No active items. Tick "Show deactivated" to see the rest.'
            )}
          </EmptyState>
        )}
      </Card>
    </>
  )
}

function NewItemForm({
  suppliers,
  onDone,
}: {
  suppliers: Supplier[]
  onDone: () => void
}) {
  const [prefix, setPrefix] = useState('')
  const [name, setName] = useState('')
  const [unit, setUnit] = useState<ItemUnit>('each')
  const [isSerialized, setIsSerialized] = useState(false)
  const [unitCost, setUnitCost] = useState('')
  const [sellPrice, setSellPrice] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()

    const cleanPrefix = prefix.toUpperCase().trim()
    if (!SKU_PREFIX_PATTERN.test(cleanPrefix)) {
      setError('The prefix must be two to six letters, for example MUG.')
      return
    }

    setBusy(true)
    setError(null)

    const result = await createItem({
      prefix: cleanPrefix,
      name,
      // A serialized item is counted in whole units by definition, so the
      // form forces "each" rather than letting the database reject it later.
      unit: isSerialized ? 'each' : unit,
      unitCost: unitCost ? Number(unitCost) : null,
      sellPrice: sellPrice ? Number(sellPrice) : null,
      supplierId: supplierId || null,
      isSerialized,
      unitsPerCase: 1,
    })

    setBusy(false)

    if (!result.ok) {
      setError(result.error ?? 'Could not create the item.')
      return
    }

    onDone()
  }

  return (
    <Card className="mb-4 p-4">
      <form onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="SKU prefix"
            hint="The number is assigned automatically — MUG becomes MUG-0001."
          >
            <input
              required
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder="MUG"
              className={`${fieldClass} font-mono uppercase`}
            />
          </Field>

          <Field label="Name">
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={fieldClass}
            />
          </Field>

          <Field label="Unit">
            <select
              value={isSerialized ? 'each' : unit}
              disabled={isSerialized}
              onChange={(e) => setUnit(e.target.value as ItemUnit)}
              className={`${fieldClass} disabled:opacity-60`}
            >
              {ITEM_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Supplier">
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className={fieldClass}
            >
              <option value="">—</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Unit cost" hint="Without it, stock value and margin stay blank.">
            <input
              type="number"
              step="0.01"
              min="0"
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
              className={fieldClass}
            />
          </Field>

          <Field label="Sell price">
            <input
              type="number"
              step="0.01"
              min="0"
              value={sellPrice}
              onChange={(e) => setSellPrice(e.target.value)}
              className={fieldClass}
            />
          </Field>
        </div>

        <label className="mt-3 flex items-center gap-2 text-sm text-text-primary">
          <input
            type="checkbox"
            checked={isSerialized}
            onChange={(e) => setIsSerialized(e.target.checked)}
          />
          Track individual serial numbers
        </label>
        {isSerialized && (
          <p className="mt-1 text-xs text-text-muted">
            Every movement of this item will need a serial scanned per unit.
          </p>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="mt-4 flex items-center gap-3">
          <Button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create item'}
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  )
}
