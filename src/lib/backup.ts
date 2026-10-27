import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

const BACKUP_PATTERN = /^panel-.*\.db$/

export function backupFileName(now = new Date()) {
  return `panel-${now.toISOString().replace(/[:.]/g, '-')}.db`
}

/** Consistent online backup via VACUUM INTO (safe while the panel runs). */
export async function backupDatabase(sourcePath: string, outPath: string) {
  const sqliteModule = 'bun:sqlite'
  const { Database } = await import(/* @vite-ignore */ sqliteModule)
  mkdirSync(dirname(outPath), { recursive: true })
  const db = new Database(sourcePath, { readonly: true })
  try {
    db.run('VACUUM INTO ?', [outPath])
  } finally {
    db.close()
  }
  return outPath
}

/** Delete all but the newest `keep` backups in `dir`. Returns removed names. */
export function rotateBackups(dir: string, keep: number) {
  const files = readdirSync(dir)
    .filter((f) => BACKUP_PATTERN.test(f))
    .sort()
    .reverse()
  const removed = files.slice(keep)
  for (const f of removed) rmSync(join(dir, f))
  return removed
}
