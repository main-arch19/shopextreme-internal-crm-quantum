#!/usr/bin/env node
/**
 * Migration runner.
 *
 * Applies supabase/migrations/*.sql in filename order, tracking what has run
 * in a schema_migrations table. Each file runs inside its own transaction, so
 * a failure leaves that migration fully rolled back rather than half-applied.
 *
 *   node scripts/migrate.mjs           apply pending migrations
 *   node scripts/migrate.mjs --status  list applied and pending
 *   node scripts/migrate.mjs --dry     print what would run, change nothing
 */

import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import dotenv from 'dotenv'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const migrationsDir = join(root, 'supabase', 'migrations')

dotenv.config({ path: join(root, '.env.local'), quiet: true })

const connectionString = process.env.SUPABASE_DB_URL
if (!connectionString) {
  console.error(
    'SUPABASE_DB_URL is not set.\n' +
      'Add it to .env.local — Supabase dashboard → Project Settings → Database → Connection string (URI).',
  )
  process.exit(1)
}

const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry')
const statusOnly = args.has('--status')

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()

const client = new pg.Client({
  connectionString,
  // Supabase requires TLS but presents a cert this client will not chain to a
  // local root. The connection is still encrypted; we are not verifying the
  // server identity, which is acceptable for a migration run against a host
  // taken from our own env file.
  ssl: { rejectUnauthorized: false },
})

await client.connect()

await client.query(`
  create table if not exists schema_migrations (
    filename    text primary key,
    checksum    text not null,
    applied_at  timestamptz not null default now()
  );
`)

const { rows: applied } = await client.query(
  'select filename, checksum from schema_migrations',
)
const appliedMap = new Map(applied.map((r) => [r.filename, r.checksum]))

let failed = false
let ran = 0

for (const file of files) {
  const sql = readFileSync(join(migrationsDir, file), 'utf8')
  const checksum = createHash('sha256').update(sql).digest('hex')
  const previous = appliedMap.get(file)

  if (previous) {
    // An edited migration that has already run is a real problem: the
    // database no longer matches the file, and nothing downstream will say
    // so. Report it rather than silently skipping.
    if (previous !== checksum) {
      console.error(`  ! ${file} — ALREADY APPLIED BUT FILE HAS CHANGED`)
      console.error(
        '    The database does not match this file. Write a new migration ' +
          'rather than editing an applied one.',
      )
      failed = true
    } else if (statusOnly) {
      console.log(`  · ${file} — applied`)
    }
    continue
  }

  if (statusOnly || dryRun) {
    console.log(`  + ${file} — pending`)
    continue
  }

  process.stdout.write(`  + ${file} … `)

  try {
    await client.query('begin')
    await client.query(sql)
    await client.query(
      'insert into schema_migrations (filename, checksum) values ($1, $2)',
      [file, checksum],
    )
    await client.query('commit')
    console.log('ok')
    ran += 1
  } catch (error) {
    await client.query('rollback')
    console.log('FAILED')
    console.error(`\n${error.message}\n`)
    if (error.position) {
      const upto = sql.slice(0, Number(error.position))
      const line = upto.split('\n').length
      console.error(`  at ${file}:${line}\n`)
    }
    failed = true
    break
  }
}

await client.end()

if (!statusOnly && !dryRun) {
  console.log(ran === 0 && !failed ? '\nNothing to apply.' : `\n${ran} migration(s) applied.`)
}

process.exit(failed ? 1 : 0)
