#!/usr/bin/env node
/**
 * Asserts the admin screens' action controls survive into the build output.
 *
 * Exists because the admin routes need an authenticated session against the
 * live database, which this machine has no credentials for — so a regression
 * there is invisible to me. When the "New item" button went missing I guessed
 * twice at the cause and was wrong both times.
 *
 * Reads the compiled chunks under .next rather than rendering the components.
 * Rendering was the obvious approach and does not work: Node strips
 * TypeScript types but not JSX, so importing a .tsx file throws
 * ERR_UNKNOWN_FILE_EXTENSION. Adding a bundler purely for this check would
 * cost more than the check is worth.
 *
 * This cannot catch a purely visual fault — an element can be present and
 * still be clipped, transparent, or positioned off-screen. It does catch a
 * control vanishing from the output, which is the failure that actually
 * happened.
 *
 * Run after `npm run build`:  node scripts/verify-layout.mjs
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = join(root, '.next')

if (!existsSync(buildDir)) {
  console.error('No .next directory. Run `npm run build` first.')
  process.exit(1)
}

/** Every JS chunk in the build, concatenated. */
function collectChunks(dir) {
  let out = ''
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (entry === 'cache') continue // large, and never contains component output
      out += collectChunks(full)
    } else if (entry.endsWith('.js')) {
      out += readFileSync(full, 'utf8')
    }
  }
  return out
}

const bundle = collectChunks(buildDir)

let passed = 0
let failed = 0

function check(name, fn) {
  try {
    fn()
    console.log(`  PASS  ${name}`)
    passed += 1
  } catch (error) {
    console.log(`  FAIL  ${name}`)
    console.log(`        ${error.message}`)
    failed += 1
  }
}

function mustContain(needle, context) {
  if (!bundle.includes(needle)) {
    throw new Error(`"${needle}" is not in the build output — ${context}`)
  }
}

console.log('\nAdmin screen controls\n')

check('items page keeps its three action controls', () => {
  // The reported failure: the table rendered, these did not.
  mustContain('New item', 'the only way to create an item through the UI')
  mustContain('Import CSV', 'the path for the client\'s existing spreadsheet (§14.8)')
  mustContain('Print labels', 'barcode label generation (§8)')
})

check('locations page keeps its action control', () => {
  mustContain('New location', 'stock cannot move until a location exists')
})

check('suppliers page keeps its action control', () => {
  mustContain('New supplier', 'lead time drives reorder urgency (§5.4)')
})

check('empty states tell a new user what to do', () => {
  // A first-run screen that does not say where to start is a defect in a
  // system whose §3 argument depends on people actually using it.
  mustContain('No items yet', 'the empty items page')
  mustContain('No locations yet', 'the empty locations page')
})

check('admin screens carry no hardcoded neutral colours', () => {
  // These were styled for a white background. On the tinted surface they
  // drift out of the palette instead of following it — which is how the
  // Import CSV border ended up at 1.38:1 against the page.
  const adminSources = [
    'src/app/(app)/admin/items/items-admin.tsx',
    'src/app/(app)/admin/locations/locations-admin.tsx',
    'src/app/(app)/admin/suppliers/suppliers-admin.tsx',
    'src/app/(app)/admin/import-panel.tsx',
    'src/app/(app)/admin/layout.tsx',
  ]

  const offenders = []
  for (const rel of adminSources) {
    const source = readFileSync(join(root, rel), 'utf8')
    const hits = [...source.matchAll(/(?:border|text|bg)-neutral-\d+/g)].map((m) => m[0])
    if (hits.length > 0) offenders.push(`${rel}: ${[...new Set(hits)].join(', ')}`)
  }

  if (offenders.length > 0) throw new Error(offenders.join(' | '))
})

check('admin layout does not nest a second container', () => {
  // The app layout already supplies padding and the sidebar offset. Wrapping
  // again applied both twice and constrained the content column — the most
  // likely reason the action buttons left the visible area.
  const layout = readFileSync(join(root, 'src/app/(app)/admin/layout.tsx'), 'utf8')
  if (/mx-auto|max-w-|px-4|py-6/.test(layout)) {
    throw new Error('admin/layout.tsx has reintroduced its own container')
  }
})

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
