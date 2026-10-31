#!/usr/bin/env bun
import { defineCommand, runMain } from 'citty'
import { readFileSync } from 'node:fs'
import { packagedAsset } from './paths'

const version = (() => {
  try {
    return (
      JSON.parse(readFileSync(packagedAsset('package.json'), 'utf8')).version ??
      'dev'
    )
  } catch {
    return 'dev'
  }
})()

const lazy = <T>(load: () => Promise<{ default: T }>) =>
  load().then((m) => m.default)

const main = defineCommand({
  meta: {
    name: 'marzgah',
    version,
    description: 'Marzgah setup and admin CLI (requires Bun)',
  },
  subCommands: {
    init: () => lazy(() => import('./commands/init.ts')),
    upgrade: () => lazy(() => import('./commands/upgrade.ts')),
    migrate: () => lazy(() => import('./commands/migrate.ts')),
    'create-admin': () => lazy(() => import('./commands/create-admin.ts')),
    'reset-password': () => lazy(() => import('./commands/reset-password.ts')),
    doctor: () => lazy(() => import('./commands/doctor.ts')),
    backup: () => lazy(() => import('./commands/backup.ts')),
    restore: () => lazy(() => import('./commands/restore.ts')),
  },
})

await runMain(main)
