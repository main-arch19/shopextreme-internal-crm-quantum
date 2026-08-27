import {
  cell,
  headerIndex,
  parseBoolean,
  parseCsv,
  parseInteger,
  parseNumber,
  summarize,
  type ImportPreview,
  type ParsedRow,
} from './csv'
import { ITEM_UNITS, type Item, type ItemUnit } from './types'

const SKU_FORMAT = /^[A-Z]{2,6}-[0-9]{3,6}$/

export interface ItemImportContext {
  /** SKU (uppercased) to existing item id, for create-vs-update. */
  existingSkus: Map<string, string>
  /** Supplier name (lowercased) to id, so the CSV can name suppliers not UUIDs. */
  suppliersByName: Map<string, string>
  /** Barcode to the item id holding it, so duplicates are caught before insert. */
  barcodeOwners: Map<string, string>
}

/**
 * Validates an item CSV against every constraint in migration 0003, so a
 * malformed row is reported in the dry run rather than raising at commit.
 *
 * The duplicate checks track values seen within the file as well as those
 * already in the database — a spreadsheet that lists the same SKU twice would
 * otherwise pass the dry run and fail halfway through the commit.
 */
export function previewItemImport(
  text: string,
  context: ItemImportContext,
): ImportPreview<Item> {
  const table = parseCsv(text)
  if (table.length < 2) {
    return summarize<Item>([])
  }

  const headers = headerIndex(table[0])
  const rows: ParsedRow<Item>[] = []

  const seenSkus = new Set<string>()
  const seenBarcodes = new Set<string>()

  for (let i = 1; i < table.length; i++) {
    const raw = table[i]
    const problems: string[] = []
    const values: Partial<Item> = {}

    // --- SKU ---------------------------------------------------------------
    const skuRaw = cell(raw, headers, 'sku')
    const sku = skuRaw ? skuRaw.toUpperCase().trim() : null

    if (!sku) {
      problems.push('sku: required')
    } else if (!SKU_FORMAT.test(sku)) {
      problems.push(
        `sku: "${skuRaw}" does not match PREFIX-NNNN (two to six letters, dash, three to six digits)`,
      )
    } else if (seenSkus.has(sku)) {
      problems.push(`sku: ${sku} appears more than once in this file`)
    } else {
      seenSkus.add(sku)
      values.sku = sku
    }

    // --- Name --------------------------------------------------------------
    const name = cell(raw, headers, 'name')
    if (!name) problems.push('name: required')
    else values.name = name

    // --- Unit --------------------------------------------------------------
    const unitRaw = cell(raw, headers, 'unit')
    const unit = (unitRaw?.toLowerCase() ?? 'each') as ItemUnit
    if (!ITEM_UNITS.includes(unit)) {
      problems.push(`unit: "${unitRaw}" is not one of ${ITEM_UNITS.join(', ')}`)
    } else {
      values.unit = unit
    }

    // --- Serialized --------------------------------------------------------
    const isSerialized = parseBoolean(cell(raw, headers, 'is_serialized')) ?? false
    values.is_serialized = isSerialized

    const unitsPerCase = parseInteger(cell(raw, headers, 'units_per_case'), 'units_per_case', problems)
    if (unitsPerCase !== null) {
      if (unitsPerCase < 1) problems.push('units_per_case: must be at least 1')
      else values.units_per_case = unitsPerCase
    }

    // Mirrors the serialized_items_are_discrete constraint. Checking it here
    // means the message names the actual conflict rather than a constraint.
    if (isSerialized) {
      if (unit !== 'each') {
        problems.push('is_serialized: a serialized item must be measured in "each"')
      }
      if ((values.units_per_case ?? 1) !== 1) {
        problems.push('is_serialized: a serialized item must have units_per_case of 1')
      }
    }

    // --- Barcode -----------------------------------------------------------
    const barcode = cell(raw, headers, 'barcode')
    if (barcode) {
      const owner = context.barcodeOwners.get(barcode)
      const existingId = sku ? context.existingSkus.get(sku) : undefined

      if (seenBarcodes.has(barcode)) {
        problems.push(`barcode: ${barcode} appears more than once in this file`)
      } else if (owner && owner !== existingId) {
        problems.push(`barcode: ${barcode} already belongs to another item`)
      } else {
        seenBarcodes.add(barcode)
        values.barcode = barcode
      }
    }

    // --- Supplier, by name -------------------------------------------------
    const supplierName = cell(raw, headers, 'supplier')
    if (supplierName) {
      const supplierId = context.suppliersByName.get(supplierName.toLowerCase())
      if (!supplierId) {
        problems.push(`supplier: "${supplierName}" is not on record — create it first`)
      } else {
        values.supplier_id = supplierId
      }
    }

    // --- Money -------------------------------------------------------------
    const unitCost = parseNumber(cell(raw, headers, 'unit_cost'), 'unit_cost', problems)
    if (unitCost !== null) {
      if (unitCost < 0) problems.push('unit_cost: cannot be negative')
      else values.unit_cost = unitCost
    }

    const sellPrice = parseNumber(cell(raw, headers, 'sell_price'), 'sell_price', problems)
    if (sellPrice !== null) {
      if (sellPrice < 0) problems.push('sell_price: cannot be negative')
      else values.sell_price = sellPrice
    }

    // --- Reorder policy ----------------------------------------------------
    const moq = parseInteger(cell(raw, headers, 'moq'), 'moq', problems)
    if (moq !== null) {
      if (moq < 1) problems.push('moq: must be at least 1')
      else values.moq = moq
    }

    const cover = parseInteger(cell(raw, headers, 'target_cover_days'), 'target_cover_days', problems)
    if (cover !== null) {
      if (cover <= 0) problems.push('target_cover_days: must be greater than 0')
      else values.target_cover_days = cover
    }

    const serviceLevel = parseNumber(cell(raw, headers, 'service_level'), 'service_level', problems)
    if (serviceLevel !== null) {
      // Z is unbounded as service level approaches 1, so the schema caps it.
      if (serviceLevel <= 0.5 || serviceLevel > 0.999) {
        problems.push('service_level: must be above 0.5 and at most 0.999')
      } else {
        values.service_level = serviceLevel
      }
    }

    const category = cell(raw, headers, 'category')
    if (category) values.category = category

    // --- Verdict -----------------------------------------------------------
    const existingId = values.sku ? context.existingSkus.get(values.sku) : undefined

    rows.push({
      line: i + 1, // 1-indexed, and row 1 is the header
      action: problems.length > 0 ? 'reject' : existingId ? 'update' : 'create',
      values,
      existingId,
      problems,
    })
  }

  return summarize(rows)
}
