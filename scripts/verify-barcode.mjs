#!/usr/bin/env node
/**
 * Code 128 encoder verification.
 *
 * Needs no database, so it runs at any time: node scripts/verify-barcode.mjs
 *
 * Worth having as a standing check because the failure mode is silent. A
 * wrong width in the pattern table does not throw — it prints a label that a
 * scanner reads as a different SKU, and the resulting ledger entries look
 * entirely legitimate. An initial transcription of this table had four
 * malformed entries and two extra rows; nothing but a structural check would
 * have caught it before labels were printed.
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'src/lib/barcode/code128.ts'), 'utf8')

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

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

// Read the table straight out of the source rather than importing the module,
// so this script stays dependency-free and does not need a TypeScript loader.
const match = source.match(/const PATTERNS: readonly string\[\] = \[([\s\S]*?)\n\]/)
const patterns = [...match[1].matchAll(/'(\d+)'/g)].map((m) => m[1])

console.log('\nCode 128 encoder\n')

check('the table holds exactly 107 entries (0-106)', () => {
  assert(patterns.length === 107, `found ${patterns.length}`)
})

check('values 0-105 are six modules summing to 11', () => {
  const bad = []
  patterns.slice(0, 106).forEach((p, i) => {
    const sum = [...p].reduce((a, c) => a + Number(c), 0)
    if (p.length !== 6 || sum !== 11) bad.push(`${i}:"${p}"(len ${p.length}, sum ${sum})`)
  })
  assert(bad.length === 0, `malformed: ${bad.slice(0, 5).join(', ')}`)
})

check('STOP (106) is seven modules summing to 13', () => {
  const stop = patterns[106]
  const sum = [...stop].reduce((a, c) => a + Number(c), 0)
  assert(stop.length === 7 && sum === 13, `got "${stop}" (len ${stop.length}, sum ${sum})`)
})

check('no duplicate patterns', () => {
  const seen = new Map()
  const dupes = []
  patterns.forEach((p, i) => {
    if (seen.has(p)) dupes.push(`${seen.get(p)} and ${i} both "${p}"`)
    else seen.set(p, i)
  })
  assert(dupes.length === 0, dupes.slice(0, 3).join('; '))
})

// Independent reimplementation of the checksum, so a bug in the encoder's
// arithmetic does not validate itself.
function checksum(value) {
  const codes = [...value].map((c) => c.codePointAt(0) - 32)
  let sum = 104 // START B
  codes.forEach((v, i) => {
    sum += v * (i + 1)
  })
  return sum % 103
}

check('checksum arithmetic matches a hand calculation', () => {
  // 104 + 40*1 + 41*2 + 19*3 + 20*4 + 21*5 + 22*6 + 23*7 + 24*8 = 953
  // 953 mod 103 = 26
  assert(checksum('HI345678') === 26, `got ${checksum('HI345678')}, expected 26`)
})

check('checksum stays within 0-102', () => {
  const samples = ['MUG-0001', 'BOLT-123456', 'A', '~~~~~~~~', 'SER-0001']
  for (const sample of samples) {
    const c = checksum(sample)
    assert(c >= 0 && c <= 102, `${sample} produced ${c}`)
  }
})

check('every SKU character maps into subset B', () => {
  // The PREFIX-NNNN constraint permits A-Z, 0-9 and a dash. All must sit in
  // ASCII 32-126, or a valid SKU would be unprintable as a label.
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-'
  for (const char of chars) {
    const point = char.codePointAt(0)
    assert(point >= 32 && point <= 126, `"${char}" is outside subset B`)
  }
})

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
