import { defineCommand } from 'citty'

import {
  backupDatabase,
  backupFileName,
  rotateBackups,
} from '../../src/lib/backup.ts'
import { databasePath, loadEnvFile } from '../lib.ts'

export default defineCommand({
  meta: {
    name: 'backup',
    description: 'Consistent SQLite backup (VACUUM INTO)',
  },
  args: {
    out: { type: 'string', description: 'Output file' },
    keep: { type: 'string', description: 'Keep newest N backups in the dir' },
  },
  async run({ args }) {
    loadEnvFile()
    const out = args.out ?? `./backups/${backupFileName()}`
    await backupDatabase(databasePath(), out)
    console.log(`Backup written to ${out}`)
    if (args.keep) {
      const { dirname } = await import('node:path')
      rotateBackups(dirname(out), Number(args.keep))
    }
  },
})
