'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { setSupplierActive, upsertSupplier } from '../actions'
import type { Supplier } from '@/lib/catalog/types'
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

export function SuppliersAdmin({ suppliers }: { suppliers: Supplier[] }) {
  const router = useRouter()
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null)

  return (
    <>
      <PageTitle actions={<Button onClick={() => setEditing('new')}>New supplier</Button>}>
        Suppliers
      </PageTitle>

      {editing && (
        <SupplierForm
          supplier={editing === 'new' ? null : editing}
          onDone={() => {
            setEditing(null)
            router.refresh()
          }}
        />
      )}

      <Card>
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Contact</Th>
                <Th align="right">Lead time</Th>
                <Th>Currency</Th>
                <Th align="right"> </Th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((supplier) => (
                <Tr key={supplier.id} muted={!supplier.is_active}>
                  <Td>{supplier.name}</Td>
                  <Td className="text-text-secondary">
                    {supplier.contact_name ?? supplier.contact_email ?? '—'}
                  </Td>
                  <Td align="right">
                    {supplier.lead_time_days ? (
                      `${supplier.lead_time_days} days`
                    ) : (
                      // Lead time drives the reorder point and the runway
                      // marker (§5.4, §7.2). Without it an item cannot be
                      // ranked by urgency at all, so the gap is called out
                      // rather than left blank.
                      <StatusBadge tone="warning">not set</StatusBadge>
                    )}
                  </Td>
                  <Td>{supplier.currency}</Td>
                  <Td align="right">
                    <span className="flex justify-end gap-3">
                      <Button variant="ghost" onClick={() => setEditing(supplier)}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={async () => {
                          await setSupplierActive(supplier.id, !supplier.is_active)
                          router.refresh()
                        }}
                      >
                        {supplier.is_active ? 'Deactivate' : 'Reactivate'}
                      </Button>
                    </span>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>

        {suppliers.length === 0 && (
          <EmptyState>
            No suppliers yet. Use <strong>New supplier</strong> above — items reference a
            supplier, and its lead time drives reorder urgency.
          </EmptyState>
        )}
      </Card>
    </>
  )
}

function SupplierForm({
  supplier,
  onDone,
}: {
  supplier: Supplier | null
  onDone: () => void
}) {
  const [name, setName] = useState(supplier?.name ?? '')
  const [contactName, setContactName] = useState(supplier?.contact_name ?? '')
  const [contactEmail, setContactEmail] = useState(supplier?.contact_email ?? '')
  const [phone, setPhone] = useState(supplier?.phone ?? '')
  const [leadTime, setLeadTime] = useState(supplier?.lead_time_days?.toString() ?? '')
  const [currency, setCurrency] = useState(supplier?.currency ?? 'USD')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    const result = await upsertSupplier({
      id: supplier?.id,
      name,
      contactName: contactName || null,
      contactEmail: contactEmail || null,
      phone: phone || null,
      leadTimeDays: leadTime ? Number(leadTime) : null,
      currency,
    })

    setBusy(false)

    if (!result.ok) {
      setError(result.error ?? 'Could not save that supplier.')
      return
    }

    onDone()
  }

  return (
    <Card className="mb-4 p-4">
      <form onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={fieldClass}
            />
          </Field>

          <Field label="Contact name">
            <input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              className={fieldClass}
            />
          </Field>

          <Field label="Contact email">
            <input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              className={fieldClass}
            />
          </Field>

          <Field label="Phone">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={fieldClass}
            />
          </Field>

          <Field
            label="Lead time (days)"
            hint="How long between ordering and arrival. Reorder urgency depends on this."
          >
            <input
              type="number"
              min="1"
              value={leadTime}
              onChange={(e) => setLeadTime(e.target.value)}
              className={fieldClass}
            />
          </Field>

          <Field label="Currency">
            <input
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              maxLength={3}
              className={`${fieldClass} uppercase`}
            />
          </Field>
        </div>

        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="mt-4 flex items-center gap-3">
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  )
}
