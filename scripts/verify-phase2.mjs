#!/usr/bin/env node
/**
 * Phase 1-2 verification: catalog, ledger, posting engine.
 *
 * Proves the claims in §2 and §4 hold in the database. Everything runs inside
 * one transaction that is always rolled back, so this leaves no data behind
 * and can be run against a database with real rows in it.
 *
 * The exception is the audit chain: write_audit() is called by posting, and
 * those entries roll back with everything else, so the chain stays intact.
 *
 * Run AFTER `npm run migrate`:  node scripts/verify-phase2.mjs
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import dotenv from 'dotenv'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: join(root, '.env.local'), quiet: true })

const connectionString = process.env.SUPABASE_DB_URL
if (!connectionString) {
  console.error('SUPABASE_DB_URL is not set in .env.local')
  process.exit(1)
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
await client.connect()

let passed = 0
let failed = 0

async function check(name, fn) {
  try {
    await fn()
    console.log(`  PASS  ${name}`)
    passed += 1
  } catch (error) {
    console.log(`  FAIL  ${name}`)
    console.log(`        ${error.message.split('\n')[0]}`)
    failed += 1
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function mustReject(sql, params, fragment) {
  try {
    await client.query(sql, params)
  } catch (error) {
    if (!error.message.includes(fragment)) {
      throw new Error(`rejected, but not as expected: ${error.message}`)
    }
    return
  }
  throw new Error('the operation succeeded, but should have been rejected')
}

/** Runs a body inside a savepoint that is always released back. */
async function isolated(fn) {
  await client.query('savepoint s')
  try {
    await fn()
  } finally {
    await client.query('rollback to savepoint s')
  }
}

console.log('\nPhase 1-2 verification\n')

await client.query('begin')

// Impersonate a manager for the whole run. post_document() gates on
// has_role(), which reads auth.uid() — so a stub is needed outside Supabase's
// auth context. This is the one place the test rig has to stand in for the
// platform.
const MANAGER = '00000000-0000-0000-0000-00000000a001'

await client.query('alter table employees drop constraint if exists employees_id_fkey')
await client.query(
  `insert into employees (id, email, full_name, role, status)
   values ($1, 'verify-manager@test', 'Verify Manager', 'manager', 'active')
   on conflict (id) do nothing`,
  [MANAGER],
)

// auth.uid() reads the sub claim out of request.jwt.claims. Setting it here
// makes the posting engine's role gates resolve exactly as they would for a
// signed-in manager, without needing a real JWT.
await client.query(
  `select set_config('request.jwt.claims', json_build_object('sub', $1::text)::text, true)`,
  [MANAGER],
)

// Confirm the stub took before running anything that depends on it. If
// auth.uid() comes back null, every posting test fails on the role gate and
// the output would blame the posting engine for a broken test rig.
{
  const { rows } = await client.query('select auth.uid() as uid, has_role($1) as ok', ['buyer'])
  if (rows[0].uid !== MANAGER || rows[0].ok !== true) {
    console.error(
      '\nCould not impersonate a manager: auth.uid() returned ' +
        `${rows[0].uid ?? 'null'}.\n` +
        'The posting engine gates on has_role(), so every test below would fail\n' +
        'for the wrong reason. Check that the auth schema exists in this database.\n',
    )
    await client.query('rollback')
    await client.end()
    process.exit(1)
  }
}

// --- Catalog constraints (§4.1) --------------------------------------------

await check('SKU format is enforced', async () => {
  await isolated(async () => {
    await mustReject(
      `insert into items (sku, name) values ('mug 12', 'Bad SKU')`,
      [],
      'item_sku_format',
    )
  })
})

await check('SKU is normalized to uppercase', async () => {
  await isolated(async () => {
    const { rows } = await client.query(
      `insert into items (sku, name) values ('  mug-0001  ', 'Mug') returning sku`,
    )
    assert(rows[0].sku === 'MUG-0001', `expected MUG-0001, got ${rows[0].sku}`)
  })
})

await check('next_sku continues an existing sequence', async () => {
  await isolated(async () => {
    await client.query(`insert into items (sku, name) values ('MUG-0007','Mug')`)
    const { rows } = await client.query(`select next_sku('MUG') as sku`)
    assert(rows[0].sku === 'MUG-0008', `expected MUG-0008, got ${rows[0].sku}`)
  })
})

await check('a serialized item cannot be measured in kg', async () => {
  await isolated(async () => {
    await mustReject(
      `insert into items (sku, name, unit, is_serialized) values ('SER-0001','Serial thing','kg',true)`,
      [],
      'serialized_items_are_discrete',
    )
  })
})

// --- Fixtures for the ledger tests -----------------------------------------

const fixture = async () => {
  const { rows: loc } = await client.query(
    `insert into locations (code, name) values ('WH1','Warehouse 1'),('WH2','Warehouse 2')
     returning id, code`,
  )
  const { rows: item } = await client.query(
    `insert into items (sku, name, unit_cost, sell_price) values ('WID-0001','Widget',4.00,10.00)
     returning id`,
  )
  const { rows: ser } = await client.query(
    `insert into items (sku, name, unit_cost, is_serialized) values ('SER-0001','Serial Widget',100.00,true)
     returning id`,
  )
  return {
    wh1: loc.find((l) => l.code === 'WH1').id,
    wh2: loc.find((l) => l.code === 'WH2').id,
    widget: item[0].id,
    serialItem: ser[0].id,
  }
}

const postDoc = async (type, locationId, lines, extra = {}) => {
  const { rows: doc } = await client.query(
    `insert into documents (doc_type, location_id, to_location_id, reason, issue_reason, created_by)
     values ($1,$2,$3,$4,$5,$6) returning id, doc_number`,
    [type, locationId, extra.to ?? null, extra.reason ?? null, extra.issueReason ?? null, MANAGER],
  )
  for (const line of lines) {
    await client.query(
      `insert into document_lines
         (document_id, item_id, quantity, unit_cost, direction, serial_unit_id, counted_qty, expected_qty)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        doc[0].id, line.item, line.qty, line.cost ?? null, line.direction ?? null,
        line.serial ?? null, line.counted ?? null, line.expected ?? null,
      ],
    )
  }
  await client.query('select post_document($1)', [doc[0].id])
  return doc[0]
}

const onHand = async (itemId, locationId) => {
  const { rows } = await client.query(
    `select coalesce(sum(quantity),0)::numeric as q from stock_movements
     where item_id = $1 and location_id = $2`,
    [itemId, locationId],
  )
  return Number(rows[0].q)
}

// --- Posting (§2, §4.3) ----------------------------------------------------

await check('a receipt increases on-hand', async () => {
  await isolated(async () => {
    const f = await fixture()
    await postDoc('RECEIPT', f.wh1, [{ item: f.widget, qty: 100, cost: 4.0 }])
    assert((await onHand(f.widget, f.wh1)) === 100, 'expected 100 on hand')
  })
})

await check('an issue decreases on-hand', async () => {
  await isolated(async () => {
    const f = await fixture()
    await postDoc('RECEIPT', f.wh1, [{ item: f.widget, qty: 100 }])
    await postDoc('ISSUE', f.wh1, [{ item: f.widget, qty: 30 }], { issueReason: 'sale' })
    assert((await onHand(f.widget, f.wh1)) === 70, 'expected 70 on hand')
  })
})

await check('stock_on_hand matches the ledger sum', async () => {
  await isolated(async () => {
    const f = await fixture()
    await postDoc('RECEIPT', f.wh1, [{ item: f.widget, qty: 42 }])
    const { rows } = await client.query(
      `select on_hand::numeric as q from stock_on_hand where item_id = $1 and location_id = $2`,
      [f.widget, f.wh1],
    )
    assert(Number(rows[0].q) === 42, `view says ${rows[0].q}, ledger says 42`)
  })
})

await check('a transfer writes both legs', async () => {
  await isolated(async () => {
    const f = await fixture()
    await postDoc('RECEIPT', f.wh1, [{ item: f.widget, qty: 50 }])
    await postDoc('TRANSFER', f.wh1, [{ item: f.widget, qty: 20 }], { to: f.wh2 })
    assert((await onHand(f.widget, f.wh1)) === 30, 'source should be 30')
    assert((await onHand(f.widget, f.wh2)) === 20, 'destination should be 20')
  })
})

await check('an adjustment can DECREASE stock (shrinkage is measurable)', async () => {
  await isolated(async () => {
    const f = await fixture()
    await postDoc('RECEIPT', f.wh1, [{ item: f.widget, qty: 100 }])
    await postDoc('ADJUSTMENT', f.wh1, [{ item: f.widget, qty: 8, direction: 'decrease' }], {
      reason: 'Breakage in aisle 3',
    })
    assert((await onHand(f.widget, f.wh1)) === 92, 'expected 92 after a decrease of 8')
  })
})

await check('an adjustment without a direction is rejected', async () => {
  await isolated(async () => {
    const f = await fixture()
    const { rows: doc } = await client.query(
      `insert into documents (doc_type, location_id, reason, created_by)
       values ('ADJUSTMENT',$1,'no direction',$2) returning id`,
      [f.wh1, MANAGER],
    )
    await client.query(
      `insert into document_lines (document_id, item_id, quantity) values ($1,$2,5)`,
      [doc[0].id, f.widget],
    )
    await mustReject('select post_document($1)', [doc[0].id], 'must state a direction')
  })
})

await check('an adjustment without a reason is rejected', async () => {
  await isolated(async () => {
    const f = await fixture()
    const { rows: doc } = await client.query(
      `insert into documents (doc_type, location_id, created_by)
       values ('ADJUSTMENT',$1,$2) returning id`,
      [f.wh1, MANAGER],
    )
    await client.query(
      `insert into document_lines (document_id, item_id, quantity, direction)
       values ($1,$2,5,'increase')`,
      [doc[0].id, f.widget],
    )
    await mustReject('select post_document($1)', [doc[0].id], 'requires a reason')
  })
})

await check('a count posts only its variance', async () => {
  await isolated(async () => {
    const f = await fixture()
    await postDoc('RECEIPT', f.wh1, [{ item: f.widget, qty: 50 }])
    await postDoc('COUNT', f.wh1, [{ item: f.widget, qty: 1, counted: 47, expected: 50 }])
    assert((await onHand(f.widget, f.wh1)) === 47, 'expected 47 after counting 47 against 50')
  })
})

await check('negative stock is allowed, not blocked (§4.4)', async () => {
  await isolated(async () => {
    const f = await fixture()
    await postDoc('ISSUE', f.wh1, [{ item: f.widget, qty: 10 }], { issueReason: 'sale' })
    assert((await onHand(f.widget, f.wh1)) === -10, 'expected -10; a missing receipt must surface, not block')
  })
})

// --- Immutability (§4.2, §4.3) ---------------------------------------------

await check('stock_movements rejects UPDATE', async () => {
  await isolated(async () => {
    const f = await fixture()
    await postDoc('RECEIPT', f.wh1, [{ item: f.widget, qty: 10 }])
    await mustReject(`update stock_movements set quantity = 999`, [], 'append-only')
  })
})

await check('a posted document cannot be edited', async () => {
  await isolated(async () => {
    const f = await fixture()
    const doc = await postDoc('RECEIPT', f.wh1, [{ item: f.widget, qty: 10 }])
    await mustReject(
      `update documents set reference = 'changed' where id = $1`,
      [doc.id],
      'cannot be edited',
    )
  })
})

await check("a posted document's lines cannot be changed", async () => {
  await isolated(async () => {
    const f = await fixture()
    const doc = await postDoc('RECEIPT', f.wh1, [{ item: f.widget, qty: 10 }])
    await mustReject(
      `update document_lines set quantity = 999 where document_id = $1`,
      [doc.id],
      'cannot be changed',
    )
  })
})

await check('posting twice is rejected', async () => {
  await isolated(async () => {
    const f = await fixture()
    const doc = await postDoc('RECEIPT', f.wh1, [{ item: f.widget, qty: 10 }])
    await mustReject('select post_document($1)', [doc.id], 'already posted')
  })
})

// --- Voiding (§4.2) --------------------------------------------------------

await check('voiding reverses the balance without deleting anything', async () => {
  await isolated(async () => {
    const f = await fixture()
    const doc = await postDoc('RECEIPT', f.wh1, [{ item: f.widget, qty: 100 }])
    await client.query('select void_document($1, $2)', [doc.id, 'Received in error'])

    assert((await onHand(f.widget, f.wh1)) === 0, 'balance should return to 0')

    const { rows: movements } = await client.query(
      `select count(*)::int as n from stock_movements where item_id = $1`,
      [f.widget],
    )
    assert(movements[0].n === 2, `expected 2 movement rows (original + reversal), found ${movements[0].n}`)

    const { rows: docs } = await client.query(
      `select count(*)::int as n from documents where id = $1 or voids_document = $1`,
      [doc.id],
    )
    assert(docs[0].n === 2, 'both the original and the reversing document must remain visible')
  })
})

await check('voiding without a reason is rejected', async () => {
  await isolated(async () => {
    const f = await fixture()
    const doc = await postDoc('RECEIPT', f.wh1, [{ item: f.widget, qty: 10 }])
    await mustReject('select void_document($1,$2)', [doc.id, '  '], 'requires a reason')
  })
})

// --- Serials (§14.6) -------------------------------------------------------

const makeSerial = async (itemId, serial) => {
  const { rows } = await client.query(
    `insert into serial_units (item_id, serial, status, location_id)
     values ($1,$2,'written_off',null) returning id`,
    [itemId, serial],
  )
  return rows[0].id
}

await check('receiving a serial puts it in stock at the location', async () => {
  await isolated(async () => {
    const f = await fixture()
    const s = await makeSerial(f.serialItem, 'ABC123')
    await postDoc('RECEIPT', f.wh1, [{ item: f.serialItem, qty: 1, serial: s }])

    const { rows } = await client.query(
      `select status, location_id from serial_units where id = $1`,
      [s],
    )
    assert(rows[0].status === 'in_stock', `expected in_stock, got ${rows[0].status}`)
    assert(rows[0].location_id === f.wh1, 'serial should be at WH1')
  })
})

await check('serialized on-hand reconciles against the ledger', async () => {
  await isolated(async () => {
    const f = await fixture()
    for (const code of ['S1', 'S2', 'S3', 'S4', 'S5']) {
      const s = await makeSerial(f.serialItem, code)
      await postDoc('RECEIPT', f.wh1, [{ item: f.serialItem, qty: 1, serial: s }])
    }

    const { rows: issued } = await client.query(
      `select id from serial_units where item_id = $1 and serial in ('S1','S2')`,
      [f.serialItem],
    )
    for (const row of issued) {
      await postDoc('ISSUE', f.wh1, [{ item: f.serialItem, qty: 1, serial: row.id }], {
        issueReason: 'sale',
      })
    }

    assert((await onHand(f.serialItem, f.wh1)) === 3, 'ledger should show 3')

    const { rows: count } = await client.query(
      `select count(*)::int as n from serial_units
       where item_id = $1 and status = 'in_stock' and location_id = $2`,
      [f.serialItem, f.wh1],
    )
    assert(count[0].n === 3, `serial count should be 3, got ${count[0].n}`)

    const { rows: recon } = await client.query('select * from serial_reconciliation')
    assert(recon.length === 0, `reconciliation found ${recon.length} discrepancy row(s)`)
  })
})

await check('issuing an already-issued serial is rejected by name', async () => {
  await isolated(async () => {
    const f = await fixture()
    const s = await makeSerial(f.serialItem, 'DUP001')
    await postDoc('RECEIPT', f.wh1, [{ item: f.serialItem, qty: 1, serial: s }])
    await postDoc('ISSUE', f.wh1, [{ item: f.serialItem, qty: 1, serial: s }], {
      issueReason: 'sale',
    })

    const { rows: doc } = await client.query(
      `insert into documents (doc_type, location_id, issue_reason, created_by)
       values ('ISSUE',$1,'sale',$2) returning id`,
      [f.wh1, MANAGER],
    )
    await client.query(
      `insert into document_lines (document_id, item_id, quantity, serial_unit_id)
       values ($1,$2,1,$3)`,
      [doc[0].id, f.serialItem, s],
    )
    await mustReject('select post_document($1)', [doc[0].id], 'DUP001')
  })
})

await check('a serialized line without a serial is rejected', async () => {
  await isolated(async () => {
    const f = await fixture()
    const { rows: doc } = await client.query(
      `insert into documents (doc_type, location_id, created_by)
       values ('RECEIPT',$1,$2) returning id`,
      [f.wh1, MANAGER],
    )
    await client.query(
      `insert into document_lines (document_id, item_id, quantity) values ($1,$2,1)`,
      [doc[0].id, f.serialItem],
    )
    await mustReject('select post_document($1)', [doc[0].id], 'a serial is required')
  })
})

await check('a serialized line for more than one unit is rejected', async () => {
  await isolated(async () => {
    const f = await fixture()
    const s = await makeSerial(f.serialItem, 'MULTI1')
    const { rows: doc } = await client.query(
      `insert into documents (doc_type, location_id, created_by)
       values ('RECEIPT',$1,$2) returning id`,
      [f.wh1, MANAGER],
    )
    await client.query(
      `insert into document_lines (document_id, item_id, quantity, serial_unit_id)
       values ($1,$2,5,$3)`,
      [doc[0].id, f.serialItem, s],
    )
    await mustReject('select post_document($1)', [doc[0].id], 'exactly 1 unit')
  })
})

await check('transferring a serial moves it and keeps it in stock', async () => {
  await isolated(async () => {
    const f = await fixture()
    const s = await makeSerial(f.serialItem, 'MOVE01')
    await postDoc('RECEIPT', f.wh1, [{ item: f.serialItem, qty: 1, serial: s }])
    await postDoc('TRANSFER', f.wh1, [{ item: f.serialItem, qty: 1, serial: s }], { to: f.wh2 })

    const { rows } = await client.query(
      `select status, location_id from serial_units where id = $1`,
      [s],
    )
    assert(rows[0].status === 'in_stock', 'a transferred serial stays in stock')
    assert(rows[0].location_id === f.wh2, 'serial should now be at WH2')
  })
})

await check('voiding an issue returns the serial to stock', async () => {
  await isolated(async () => {
    const f = await fixture()
    const s = await makeSerial(f.serialItem, 'VOID01')
    await postDoc('RECEIPT', f.wh1, [{ item: f.serialItem, qty: 1, serial: s }])
    const issue = await postDoc('ISSUE', f.wh1, [{ item: f.serialItem, qty: 1, serial: s }], {
      issueReason: 'sale',
    })

    await client.query('select void_document($1,$2)', [issue.id, 'Wrong unit picked'])

    const { rows } = await client.query(
      `select status, location_id from serial_units where id = $1`,
      [s],
    )
    assert(rows[0].status === 'in_stock', `expected in_stock after void, got ${rows[0].status}`)
    assert(rows[0].location_id === f.wh1, 'serial should be back at WH1')
  })
})

// --- Silence detection (§3, §7.9) ------------------------------------------

await check('location_activity reports the last movement per location', async () => {
  await isolated(async () => {
    const f = await fixture()
    await postDoc('RECEIPT', f.wh1, [{ item: f.widget, qty: 5 }])

    const { rows } = await client.query(
      `select code, last_movement_at from location_activity order by code`,
    )
    const wh1 = rows.find((r) => r.code === 'WH1')
    const wh2 = rows.find((r) => r.code === 'WH2')
    assert(wh1?.last_movement_at !== null, 'WH1 should report a movement')
    assert(wh2?.last_movement_at === null, 'WH2 has no movements and must report null, not be hidden')
  })
})

await client.query('rollback')
await client.end()

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
