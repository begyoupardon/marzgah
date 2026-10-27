import * as schema from './schema.ts'
import type { Db } from './types.ts'

export const migrationsFolder = process.env.MIGRATIONS_DIR ?? './drizzle'

export async function createBunDb(path: string): Promise<Db> {
  const sqliteModule = 'bun:sqlite'
  const drizzleModule = 'drizzle-orm/bun-sqlite'
  const { Database } = await import(/* @vite-ignore */ sqliteModule)
  const { drizzle } = await import(/* @vite-ignore */ drizzleModule)

  if (path !== ':memory:') {
    const { mkdirSync } = await import('node:fs')
    const { dirname } = await import('node:path')
    mkdirSync(dirname(path), { recursive: true })
  }

  const sqlite = new Database(path, { create: true })
  sqlite.exec('PRAGMA journal_mode = WAL')
  sqlite.exec('PRAGMA busy_timeout = 5000')
  sqlite.exec('PRAGMA synchronous = NORMAL')
  sqlite.exec('PRAGMA foreign_keys = ON')

  const db = drizzle(sqlite, { schema })
  // D1 exposes batch(); emulate it with a single synchronous transaction.
  db.batch = async (queries: Array<{ run: () => unknown }>) =>
    sqlite.transaction(() => queries.map((q) => q.run()))()
  return db
}
