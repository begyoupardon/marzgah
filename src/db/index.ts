import { createBunDb, migrationsFolder } from './bun.ts'
import * as schema from './schema.ts'
import type { Db } from './types.ts'

export type { Db }
export { createBunDb, migrationsFolder }

type Driver = 'd1' | 'bun-sqlite'

/**
 * `d1` runs on Cloudflare Workers; `bun-sqlite` is the self-hosted default.
 * Override with DB_DRIVER. Module specifiers are held in variables so the
 * bundler never tries to resolve the driver the current target lacks.
 */
function detectDriver(): Driver {
  const forced = process.env.DB_DRIVER
  if (forced === 'd1' || forced === 'bun-sqlite') return forced
  return globalThis.navigator?.userAgent === 'Cloudflare-Workers'
    ? 'd1'
    : 'bun-sqlite'
}

async function createDefaultDb(): Promise<Db> {
  if (detectDriver() === 'd1') {
    const workersModule = 'cloudflare:workers'
    const { env } = await import(/* @vite-ignore */ workersModule)
    const { drizzle } = await import('drizzle-orm/d1')
    return drizzle(env.DB, { schema })
  }

  const db = await createBunDb(process.env.DATABASE_PATH ?? './data/panel.db')
  if (process.env.AUTO_MIGRATE !== 'false') {
    const migratorModule = 'drizzle-orm/bun-sqlite/migrator'
    const { migrate } = await import(/* @vite-ignore */ migratorModule)
    migrate(db, { migrationsFolder })
  }
  return db
}

// Vite dev can evaluate this module in several module graphs; share one
// connection (and one migration run) per process.
const globalForDb = globalThis as typeof globalThis & {
  __vpnPanelDb?: Promise<Db>
}
globalForDb.__vpnPanelDb ??= createDefaultDb()

export const db: Db = await globalForDb.__vpnPanelDb
