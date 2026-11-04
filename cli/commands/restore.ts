import { copyFileSync, existsSync, renameSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { Database } from 'bun:sqlite'

import { defineCommand } from 'citty'

import { databasePath, loadEnvFile } from '../lib.ts'

export default defineCommand({
  meta: {
    name: 'restore',
    description: 'Restore the DB from a backup (stop the panel first)',
  },
  args: {
    file: { type: 'positional', description: 'Backup file', required: true },
  },
  run({ args }) {
    loadEnvFile()
    if (!existsSync(args.file)) throw new Error(`Not found: ${args.file}`)
    const target = databasePath()
    const staged = join(
      dirname(target),
      `.${basename(target)}.${crypto.randomUUID()}.restore`,
    )
    try {
      copyFileSync(args.file, staged)
      const backup = new Database(staged, { readonly: true })
      try {
        const check = backup.query('PRAGMA quick_check').get() as {
          quick_check: string
        }
        const schema = backup
          .query(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user'",
          )
          .get()
        if (check.quick_check !== 'ok' || !schema)
          throw new Error('Invalid Marzgah backup')
      } finally {
        backup.close()
      }
      if (existsSync(target)) copyFileSync(target, `${target}.pre-restore`)
      for (const ext of ['-wal', '-shm'])
        rmSync(`${target}${ext}`, { force: true })
      renameSync(staged, target)
    } finally {
      rmSync(staged, { force: true })
    }
    console.log(`Restored ${args.file} -> ${target}`)
  },
})
