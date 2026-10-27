import { mock } from 'bun:test'

import { createBunDb, migrationsFolder } from '#/db/bun'
import type { Db } from '#/db/types'

/** Fresh in-memory SQLite with the real migrations applied. */
export async function createTestDb(): Promise<Db> {
  const db = await createBunDb(':memory:')
  const migratorModule = 'drizzle-orm/bun-sqlite/migrator'
  const { migrate } = await import(/* @vite-ignore */ migratorModule)
  migrate(db, { migrationsFolder })
  return db
}

/**
 * Point `#/db` at a fresh test DB. Call at the top of a test file, before
 * dynamically importing the module under test.
 */
export async function mockDb(): Promise<Db> {
  const db = await createTestDb()
  mock.module('#/db', () => ({ db }))
  return db
}
