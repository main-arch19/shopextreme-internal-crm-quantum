#!/usr/bin/env node
/**
 * Phase 0 verification.
 *
 * Proves the security claims in §9 and §10 actually hold in the database,
 * rather than only in the migration text. Every check here corresponds to a
 * line in the plan's verification section.
 *
 * Run AFTER `npm run migrate`:  node scripts/verify-phase0.mjs
 *
 * Connects as the database owner — the strongest credential available. That
 * is deliberate: if the append-only guarantees hold against this connection,
 * they hold against the application's weaker roles too.
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

/** Asserts the query throws, and that the message matches. */
async function mustReject(sql, params, expectedFragment) {
  try {
    await client.query(sql, params)
  } catch (error) {
    if (!error.message.includes(expectedFragment)) {
      throw new Error(`rejected, but not as expected: ${error.message}`)
    }
    return
  }
  throw new Error('the operation succeeded, but should have been rejected')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

console.log('\nPhase 0 verification\n')

// --- Schema is present -----------------------------------------------------

await check('core tables exist', async () => {
  const { rows } = await client.query(`
    select table_name from information_schema.tables
    where table_schema = 'public'
      and table_name in ('employees','employee_invites','audit_log')
  `)
  assert(rows.length === 3, `expected 3 tables, found ${rows.length}`)
})

await check('authorization helpers exist', async () => {
  const { rows } = await client.query(`
    select routine_name from information_schema.routines
    where routine_schema = 'public'
      and routine_name in ('is_active_employee','has_role','write_audit','verify_audit_chain')
  `)
  assert(rows.length === 4, `expected 4 functions, found ${rows.length}`)
})

await check('RLS is enabled on every gated table', async () => {
  const { rows } = await client.query(`
    select relname from pg_class
    where relname in ('employees','employee_invites','audit_log')
      and relrowsecurity = false
  `)
  assert(rows.length === 0, `RLS disabled on: ${rows.map((r) => r.relname).join(', ')}`)
})

// --- Append-only enforcement (§10.3) ---------------------------------------
// Seeded through write_audit() so the chain stays valid.

await check('audit entries can be written', async () => {
  await client.query(`select write_audit('system.chain_verify','test','seed-1',null,'{"n":1}'::jsonb)`)
  await client.query(`select write_audit('system.chain_verify','test','seed-2',null,'{"n":2}'::jsonb)`)
  const { rows } = await client.query('select count(*)::int as n from audit_log')
  assert(rows[0].n >= 2, `expected at least 2 entries, found ${rows[0].n}`)
})

await check('audit_log rejects UPDATE', () =>
  mustReject(`update audit_log set action = 'tampered' where id = (select min(id) from audit_log)`, [], 'append-only'))

await check('audit_log rejects DELETE', () =>
  mustReject(`delete from audit_log where id = (select min(id) from audit_log)`, [], 'append-only'))

await check('employees rejects DELETE for the application role', async () => {
  const { rows } = await client.query(`
    select count(*)::int as n from information_schema.role_table_grants
    where table_name = 'employees' and privilege_type = 'DELETE'
      and grantee in ('anon','authenticated')
  `)
  assert(rows[0].n === 0, `DELETE is still granted to ${rows[0].n} application role(s)`)
})

// --- Hash chain (§10.4) ----------------------------------------------------

await check('chain links: each prev_hash matches the prior row_hash', async () => {
  const { rows } = await client.query(`
    select a.id from audit_log a
    left join lateral (
      select row_hash from audit_log b where b.id < a.id order by b.id desc limit 1
    ) prior on true
    where a.prev_hash is distinct from prior.row_hash
  `)
  assert(rows.length === 0, `chain break at entries: ${rows.map((r) => r.id).join(', ')}`)
})

await check('verify_audit_chain reports a valid chain', async () => {
  const { rows } = await client.query('select * from verify_audit_chain(0)')
  assert(rows[0].ok === true, `chain reported invalid: ${rows[0].reason}`)
  assert(Number(rows[0].entry_count) >= 2, 'chain verified but covered no entries')
})

await check('tampering is DETECTED by verify_audit_chain', async () => {
  // The trigger blocks ordinary UPDATE, so simulate an attacker with rights to
  // drop it — the exact threat model the chain exists for (§10.1 layer 3).
  await client.query('begin')
  try {
    await client.query('alter table audit_log disable trigger no_audit_update')
    await client.query(
      `update audit_log set after_state = '{"n":999}'::jsonb where id = (select min(id) from audit_log)`,
    )

    const { rows } = await client.query('select * from verify_audit_chain(0)')
    assert(rows[0].ok === false, 'the chain still verified after a row was altered')
    assert(rows[0].broken_at !== null, 'chain reported a failure but named no entry')
  } finally {
    // Undo the tamper regardless, so a failed assertion does not leave the
    // log corrupted.
    await client.query('rollback')
  }
})

await check('chain is intact again after the tamper test rolled back', async () => {
  const { rows } = await client.query('select * from verify_audit_chain(0)')
  assert(rows[0].ok === true, `chain left broken: ${rows[0].reason}`)
})

// --- Guardrails (§9.3) -----------------------------------------------------

await check('the last active executive cannot be demoted', async () => {
  await client.query('begin')
  try {
    const id = '00000000-0000-0000-0000-0000000000e1'
    // Bypass the auth.users FK for this isolated test.
    await client.query('alter table employees drop constraint employees_id_fkey')
    await client.query(
      `insert into employees (id, email, role, status) values ($1,'exec@test','executive','active')`,
      [id],
    )
    await mustReject(
      `update employees set role = 'viewer' where id = $1`,
      [id],
      'last active executive',
    )
  } finally {
    await client.query('rollback')
  }
})

await check('offboarding without a reason is rejected', async () => {
  await client.query('begin')
  try {
    const id = '00000000-0000-0000-0000-0000000000e2'
    await client.query('alter table employees drop constraint employees_id_fkey')
    await client.query(
      `insert into employees (id, email, role, status) values ($1,'buyer@test','buyer','active')`,
      [id],
    )
    await mustReject(
      `update employees set status = 'offboarded' where id = $1`,
      [id],
      'offboard_requires_reason',
    )
  } finally {
    await client.query('rollback')
  }
})

await check('an invite cannot be issued at the pending role', async () => {
  await client.query('begin')
  try {
    await client.query('alter table employee_invites drop constraint employee_invites_invited_by_fkey')
    await mustReject(
      `insert into employee_invites (email, role, token_hash, invited_by)
       values ('x@test','pending','hash-x','00000000-0000-0000-0000-0000000000e3')`,
      [],
      'invite_role_is_grantable',
    )
  } finally {
    await client.query('rollback')
  }
})

await client.end()

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
