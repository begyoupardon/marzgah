import { expect, it } from 'bun:test'
import { sql } from 'drizzle-orm'
import { Database } from 'bun:sqlite'

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
  const billingColumns = await db.all<{ name: string }>(
    sql`pragma table_info('billing_events')`,
  )
  const requestColumns = await db.all<{ name: string }>(
    sql`pragma table_info('renewal_requests')`,
  )
  expect(billingColumns.map((c) => c.name)).toContain('duration_days')
  expect(requestColumns.map((c) => c.name)).toContain('duration_days')
})

it('keeps the journal in step with the sql files', async () => {
  const { readdirSync, readFileSync } = await import('node:fs')
  const sqlFiles = readdirSync('drizzle').filter((f) => f.endsWith('.sql'))
  const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'))
  expect(
    journal.entries.map((e: { tag: string }) => `${e.tag}.sql`).sort(),
  ).toEqual(sqlFiles.sort())
})

it('adds day-based columns without changing legacy month values', async () => {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    create table billing_events (id text, duration_months integer);
    insert into billing_events values ('old-bill', 2);
    create table renewal_requests (id text, months integer);
    insert into renewal_requests values ('old-request', 3);
  `)
  sqlite.exec(await Bun.file('drizzle/0013_days_renewals.sql').text())
  expect(
    sqlite
      .query('select duration_months, duration_days from billing_events')
      .get(),
  ).toEqual({ duration_months: 2, duration_days: null })
  expect(
    sqlite.query('select months, duration_days from renewal_requests').get(),
  ).toEqual({ months: 3, duration_days: null })
  sqlite.close()
})
