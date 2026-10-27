import { expect, it } from 'bun:test'
import { sql } from 'drizzle-orm'

import { createTestDb } from '../../test/helpers/db'

it('applies every migration on a fresh database', async () => {
  const db = await createTestDb()
  const rows = await db.all<{ name: string }>(
    sql`select name from sqlite_master where type = 'table'`,
  )
  const names = rows.map((r) => r.name)
  for (const t of [
    'user',
    'vpn_users',
    'reseller_profiles',
    'billing_events',
    'audit_logs',
    'webhook_events',
  ]) {
    expect(names).toContain(t)
  }
})

it('keeps the journal in step with the sql files', async () => {
  const { readdirSync, readFileSync } = await import('node:fs')
  const sqlFiles = readdirSync('drizzle').filter((f) => f.endsWith('.sql'))
  const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'))
  expect(
    journal.entries.map((e: { tag: string }) => `${e.tag}.sql`).sort(),
  ).toEqual(sqlFiles.sort())
})
