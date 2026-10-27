import { copyFileSync, existsSync, rmSync } from 'node:fs'

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
    if (existsSync(target)) copyFileSync(target, `${target}.pre-restore`)
    for (const ext of ['-wal', '-shm'])
      rmSync(`${target}${ext}`, { force: true })
    copyFileSync(args.file, target)
    console.log(`Restored ${args.file} -> ${target}`)
  },
})
