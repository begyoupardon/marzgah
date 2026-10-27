#!/usr/bin/env bun
import { defineCommand, runMain } from 'citty'

const lazy = <T>(load: () => Promise<{ default: T }>) =>
  load().then((m) => m.default)

const main = defineCommand({
  meta: { name: 'marzgah', description: 'Marzgah setup and admin CLI' },
  subCommands: {
    init: () => lazy(() => import('./commands/init.ts')),
    migrate: () => lazy(() => import('./commands/migrate.ts')),
    'create-admin': () => lazy(() => import('./commands/create-admin.ts')),
    'reset-password': () => lazy(() => import('./commands/reset-password.ts')),
    doctor: () => lazy(() => import('./commands/doctor.ts')),
    backup: () => lazy(() => import('./commands/backup.ts')),
    restore: () => lazy(() => import('./commands/restore.ts')),
  },
})

await runMain(main)
