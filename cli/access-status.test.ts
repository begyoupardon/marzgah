import { afterAll, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createTestDb } from '../test/helpers/db'
import { accessUpgradeSteps, inspectAccessSchema } from './access-status'
const directory = mkdtempSync(join(tmpdir(), 'marzgah-access-doctor-'))
afterAll(() => rmSync(directory, { recursive: true, force: true }))
test('does not create a missing database', () => {
  const path = join(directory, 'missing.db')
  expect(inspectAccessSchema(path).ok).toBe(false)
  expect(existsSync(path)).toBe(false)
})
test('reports legacy schemas without modifying them', () => {
  const path = join(directory, 'legacy.db')
  const db = new Database(path, { create: true })
  db.exec('CREATE TABLE user (id TEXT PRIMARY KEY)')
  db.exec("INSERT INTO user VALUES ('preserved')")
  db.close()
  expect(inspectAccessSchema(path)).toMatchObject({ ok: false })
  const read = new Database(path, { readonly: true })
  expect(read.query('SELECT id FROM user').get()).toEqual({ id: 'preserved' })
  expect(
    read.query("SELECT name FROM sqlite_master WHERE type='table'").all(),
  ).toEqual([{ name: 'user' }])
  read.close()
})
test('detects a missing protected-grant migration and accepts the full real migration set', async () => {
  const path = join(directory, 'partial.db')
  const db = new Database(path, { create: true })
  for (const table of [
    'access_policies',
    'access_assignments',
    'access_operations',
    'access_tasks',
    'access_leases',
  ])
    db.exec(`CREATE TABLE ${table} (id TEXT)`)
  db.close()
  expect(inspectAccessSchema(path).detail).toContain('0020')
  const migrated = await createTestDb()
  const fullPath = join(directory, 'migrated.db')
  ;(migrated.$client as Database).exec(`VACUUM INTO '${fullPath}'`)
  expect(inspectAccessSchema(fullPath)).toMatchObject({ ok: true })
  ;(migrated.$client as Database).close()
})
test('post-upgrade guidance explains explicit activation and the scheduler', () => {
  const steps = accessUpgradeSteps()
  expect(steps).toContain('bun run cli doctor')
  expect(steps).toContain('SCHEDULER')
  expect(steps).toContain('Required for everyone')
  expect(steps).toContain('Existing users keep their access')
})
