'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { setLocationActive, upsertLocation } from '../actions'
import { LOCATION_TYPES, type Location, type LocationType } from '@/lib/catalog/types'
import {
  Button,
  Card,
  EmptyState,
  Field,
  PageTitle,
  Table,
  TableWrap,
  Td,
  Th,
  Tr,
  fieldClass,
} from '@/components/ui'

export function LocationsAdmin({ locations }: { locations: Location[] }) {
  const router = useRouter()
  const [editing, setEditing] = useState<Location | 'new' | null>(null)

  return (
    <>
      <PageTitle actions={<Button onClick={() => setEditing('new')}>New location</Button>}>
        Locations
      </PageTitle>

      {editing && (
        <LocationForm
          location={editing === 'new' ? null : editing}
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
                <Th>Code</Th>
                <Th>Name</Th>
                <Th>Type</Th>
                <Th align="right"> </Th>
              </tr>
            </thead>
            <tbody>
              {locations.map((location) => (
                <Tr key={location.id} muted={!location.is_active}>
                  <Td className="font-mono">{location.code}</Td>
                  <Td>{location.name}</Td>
                  <Td>{location.type}</Td>
                  <Td align="right">
                    <span className="flex justify-end gap-3">
                      <Button variant="ghost" onClick={() => setEditing(location)}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={async () => {
                          await setLocationActive(location.id, !location.is_active)
                          router.refresh()
                        }}
                      >
                        {location.is_active ? 'Deactivate' : 'Reactivate'}
                      </Button>
                    </span>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>

        {locations.length === 0 && (
          <EmptyState>
            No locations yet. Stock cannot move until at least one exists — use{' '}
            <strong>New location</strong> above.
          </EmptyState>
        )}
      </Card>
    </>
  )
}

function LocationForm({
  location,
  onDone,
}: {
  location: Location | null
  onDone: () => void
}) {
  const [code, setCode] = useState(location?.code ?? '')
  const [name, setName] = useState(location?.name ?? '')
  const [type, setType] = useState<LocationType>(location?.type ?? 'warehouse')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    const result = await upsertLocation({
      id: location?.id,
      code: code.toUpperCase().trim(),
      name,
      type,
    })

    setBusy(false)

    if (!result.ok) {
      setError(result.error ?? 'Could not save that location.')
      return
    }

    onDone()
  }

  return (
    <Card className="mb-4 p-4">
      <form onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Code">
            <input
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="WH1"
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

          <Field label="Type">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as LocationType)}
              className={fieldClass}
            >
              {LOCATION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
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
