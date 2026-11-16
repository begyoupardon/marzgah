import { existsSync } from 'node:fs'
import { Database } from 'bun:sqlite'

const accessTables = [
  'access_policies',
  'access_assignments',
  'access_operations',
  'access_tasks',
  'access_leases',
]

/** Inspect only: doctor must never create a database or apply migrations. */
export function inspectAccessSchema(path: string) {
  if (!existsSync(path))
    return {
      ok: false,
      detail: 'Database is missing; run the panel upgrade first.',
    }
  let database: Database | undefined
  try {
    database = new Database(path, { readonly: true })
    const tables = new Set(
      (
        database
          .query("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all() as Array<{ name: string }>
      ).map((row) => row.name),
    )
    const missing = accessTables.filter((name) => !tables.has(name))
    if (missing.length)
      return {
        ok: false,
        detail: `Missing ${missing.join(', ')}. Run the matching CLI upgrade/migrate command.`,
      }
    const columns = database
      .query('PRAGMA table_info(access_assignments)')
      .all() as Array<{ name: string }>
    if (!columns.some((column) => column.name === 'protected_inbounds'))
      return {
        ok: false,
        detail:
          'Protected inbound grants migration (0020) is missing. Run the matching CLI upgrade/migrate command.',
      }
    return {
      ok: true,
      detail: 'Connection access migrations 0019 and 0020 are installed.',
    }
  } catch {
    return {
      ok: false,
      detail:
        'Could not inspect the SQLite database. Check its path and permissions.',
    }
  } finally {
    database?.close()
  }
}

export function accessUpgradeSteps() {
  return [
    '1. Restart your panel service to load the new build (for example: sudo systemctl start marzgah).',
    '2. From this directory, run: bun run cli doctor',
    '3. Sign in and open Administration → Connection access; check the inbound catalog and shared templates.',
    '4. Test one disposable user before previewing and confirming Required for everyone.',
    'Keep the Bun scheduler enabled (SCHEDULER must not be off) to apply queued access changes.',
    'Existing users keep their access until you explicitly manage them or enable a global requirement.',
    'Full instructions: docs/connection-access.md and docs/npm-cli.md',
  ].join('\n')
}
