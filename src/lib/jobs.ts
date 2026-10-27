import { isNull } from 'drizzle-orm'

import { db } from '#/db'
import { vpnUsers } from '#/db/schema'
import { backupDatabase, backupFileName, rotateBackups } from '#/lib/backup'
import { getEnv } from '#/lib/env'
import { writeAuditLog } from '#/lib/ledger'
import { refreshVpnUserMirrors } from '#/lib/marzban/sync'
import { runAllScans } from '#/lib/notifications/events'
import { drainOutbox } from '#/lib/notifications/outbox'
import {
  createTelegramNotifier,
  getTelegramConfig,
} from '#/lib/notifications/telegram'
import { createScheduler } from '#/lib/scheduler'

/** Refresh every active mirror from Marzban (rows synced <30s ago are skipped). */
export async function syncAllUsers() {
  const rows = await db
    .select()
    .from(vpnUsers)
    .where(isNull(vpnUsers.removedAt))
  const { failed } = await refreshVpnUserMirrors(rows)
  if (failed) throw new Error('Marzban sync stopped after an upstream failure')
  return { users: rows.length }
}

/** Queue expiry / traffic / wallet warnings. Safe to run often: keys dedupe. */
export async function scanNotifications() {
  const config = await getTelegramConfig()
  if (!config?.enabled) return null
  return runAllScans()
}

/** Send whatever is due. A no-op until the Telegram integration is enabled. */
export async function drainNotifications() {
  const config = await getTelegramConfig()
  if (!config?.enabled) return null
  return drainOutbox({ notifier: createTelegramNotifier(config.botToken) })
}

export async function autoBackup() {
  const env = getEnv()
  const dir = env.BACKUP_DIR ?? './backups'
  const source = env.DATABASE_PATH ?? './data/panel.db'
  const file = await backupDatabase(source, `${dir}/${backupFileName()}`)
  const removed = rotateBackups(dir, env.BACKUP_KEEP)
  return { file, removed: removed.length }
}

const HOUR = 60 * 60 * 1000

export function buildScheduler(opts: { backups: boolean }) {
  const scheduler = createScheduler({
    onFailure: (job, error) => {
      void writeAuditLog({
        actorRole: 'system',
        action: 'job.failed',
        entityType: 'job',
        entityId: job,
        payload: { error: String(error) },
      }).catch(() => {})
    },
  })
  const env = getEnv()
  if (env.MARZBAN_BASE_URL) {
    scheduler.register({
      name: 'sync-users',
      intervalMs: 10 * 60 * 1000,
      run: syncAllUsers,
    })
  }
  scheduler.register({
    name: 'scan-notifications',
    intervalMs: HOUR,
    run: scanNotifications,
    initialDelayMs: 90_000,
  })
  scheduler.register({
    name: 'drain-notifications',
    intervalMs: 60_000,
    run: drainNotifications,
    initialDelayMs: 30_000,
  })
  if (opts.backups) {
    scheduler.register({
      name: 'auto-backup',
      intervalMs: 24 * HOUR,
      run: autoBackup,
      initialDelayMs: 60_000,
    })
  }
  return scheduler
}

const g = globalThis as typeof globalThis & { __vpnPanelScheduler?: boolean }

/** Idempotent per process. Skipped on Cloudflare (cron triggers call the jobs). */
export function startBackground() {
  if (g.__vpnPanelScheduler || !getEnv().SCHEDULER) return
  if (globalThis.navigator?.userAgent === 'Cloudflare-Workers') return
  g.__vpnPanelScheduler = true
  buildScheduler({ backups: true }).start()
}
