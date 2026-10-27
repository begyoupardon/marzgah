import { defineCommand } from 'citty'

import { loadEnvFile } from '../lib.ts'

export default defineCommand({
  meta: { name: 'migrate', description: 'Apply pending SQLite migrations' },
  async run() {
    loadEnvFile()
    process.env.AUTO_MIGRATE = 'false'
    const { createBunDb, migrationsFolder } =
      await import('../../src/db/bun.ts')
    const { migrate } = await import('drizzle-orm/bun-sqlite/migrator')
    const { databasePath } = await import('../lib.ts')
    const db = await createBunDb(databasePath())
    migrate(db as never, { migrationsFolder })
    console.log(`Migrations applied to ${databasePath()}`)
  },
})
