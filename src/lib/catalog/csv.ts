/**
 * CSV parsing and validation for catalog import (§14.8).
 *
 * This is how the client's existing spreadsheet arrives, which makes it the
 * opening-stock path rather than an admin convenience. It is also the first
 * contact between their real vocabulary and this schema's constraints, so
 * every rejection has to say what is wrong in terms they can act on.
 *
 * Validation happens before anything is written. A dry run that reports
 * "row 34: unknown supplier" is useful; a partial import that leaves 33 rows
 * committed and the rest missing is a mess to unpick.
 */

export type RowAction = 'create' | 'update' | 'reject'

export interface ParsedRow<T> {
  line: number
  action: RowAction
  values: Partial<T>
  existingId?: string
  problems: string[]
}

export interface ImportPreview<T> {
  rows: ParsedRow<T>[]
  creates: number
  updates: number
  rejects: number
}

/**
 * Minimal RFC 4180 parser: quoted fields, escaped quotes, embedded newlines.
 *
 * Written rather than pulled in because the alternative is a dependency for
 * roughly forty lines, and spreadsheet exports are the one input we can be
 * sure will contain a quoted comma in a product name.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  // Strip a UTF-8 BOM — Excel writes one, and it otherwise becomes part of
  // the first header name, which then matches nothing.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)

  while (i < text.length) {
    const char = text[i]

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += char
      i += 1
      continue
    }

    if (char === '"') {
      inQuotes = true
      i += 1
      continue
    }

    if (char === ',') {
      row.push(field)
      field = ''
      i += 1
      continue
    }

    if (char === '\r') {
      i += 1
      continue
    }

    if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i += 1
      continue
    }

    field += char
    i += 1
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter((r) => r.some((cell) => cell.trim().length > 0))
}

/** Header lookup that tolerates case, spaces, and underscores. */
export function headerIndex(headers: string[]): Map<string, number> {
  const map = new Map<string, number>()
  headers.forEach((header, index) => {
    map.set(header.trim().toLowerCase().replace(/[\s_-]+/g, ''), index)
  })
  return map
}

export function cell(
  row: string[],
  headers: Map<string, number>,
  name: string,
): string | null {
  const index = headers.get(name.toLowerCase().replace(/[\s_-]+/g, ''))
  if (index === undefined) return null
  const value = (row[index] ?? '').trim()
  return value.length > 0 ? value : null
}

export function parseNumber(
  value: string | null,
  field: string,
  problems: string[],
): number | null {
  if (value === null) return null
  // Tolerate currency symbols and thousands separators — spreadsheets export
  // them, and rejecting "1,250.00" as unparseable helps nobody.
  const cleaned = value.replace(/[^0-9.-]/g, '')
  const parsed = Number(cleaned)
  if (!Number.isFinite(parsed)) {
    problems.push(`${field}: "${value}" is not a number`)
    return null
  }
  return parsed
}

export function parseInteger(
  value: string | null,
  field: string,
  problems: string[],
): number | null {
  const parsed = parseNumber(value, field, problems)
  if (parsed === null) return null
  if (!Number.isInteger(parsed)) {
    problems.push(`${field}: ${value} must be a whole number`)
    return null
  }
  return parsed
}

export function parseBoolean(value: string | null): boolean | null {
  if (value === null) return null
  return ['true', 'yes', 'y', '1'].includes(value.toLowerCase())
}

export function summarize<T>(rows: ParsedRow<T>[]): ImportPreview<T> {
  return {
    rows,
    creates: rows.filter((r) => r.action === 'create').length,
    updates: rows.filter((r) => r.action === 'update').length,
    rejects: rows.filter((r) => r.action === 'reject').length,
  }
}
