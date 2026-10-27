import { and, asc, eq, lte } from 'drizzle-orm'

import { db as defaultDb } from '#/db'
import { notifications, telegramLinks } from '#/db/schema'
import type { Db } from '#/db/types'
import type { Notifier } from './types'

export const MAX_ATTEMPTS = 6
const LEASE_MS = 5 * 60_000

/** 2, 4, 8… minutes, capped at 6 hours. */
export function backoffMs(attempts: number) {
  return Math.min(2 ** attempts * 60_000, 6 * 60 * 60_000)
}

export type OutboxItem = {
  userId: string
  event: string
  dedupeKey: string
  text: string
}

/** Idempotent: a second call with the same dedupeKey is a no-op. */
export async function enqueue(
  item: OutboxItem,
  { db = defaultDb, now = new Date() }: { db?: Db; now?: Date } = {},
) {
  const inserted = await db
    .insert(notifications)
    .values({ id: crypto.randomUUID(), ...item, nextAttemptAt: now })
    .onConflictDoNothing()
    .returning({ id: notifications.id })
  return inserted.length > 0
}

export type DrainResult = {
  sent: number
  retried: number
  dead: number
  skipped: number
}

/**
 * Send due notifications. Each row is claimed with a compare-and-set lease so
 * two workers can't send the same message, and a crashed worker's rows
 * reappear when the lease expires.
 */
export async function drainOutbox({
  notifier,
  db = defaultDb,
  now = new Date(),
  batch = 25,
}: {
  notifier: Notifier
  db?: Db
  now?: Date
  batch?: number
}): Promise<DrainResult> {
  const result: DrainResult = { sent: 0, retried: 0, dead: 0, skipped: 0 }
  const due = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.status, 'queued'),
        lte(notifications.nextAttemptAt, now),
      ),
    )
    .orderBy(asc(notifications.nextAttemptAt))
    .limit(batch)

  for (const { id } of due) {
    const [row] = await db
      .update(notifications)
      .set({ nextAttemptAt: new Date(now.getTime() + LEASE_MS) })
      .where(
        and(
          eq(notifications.id, id),
          eq(notifications.status, 'queued'),
          lte(notifications.nextAttemptAt, now),
        ),
      )
      .returning()
    if (!row) continue // another worker took it

    const [link] = await db
      .select()
      .from(telegramLinks)
      .where(eq(telegramLinks.userId, row.userId))
      .limit(1)
    if (!link) {
      await db
        .update(notifications)
        .set({ status: 'skipped', lastError: 'no linked channel' })
        .where(eq(notifications.id, id))
      result.skipped++
      continue
    }

    let outcome: Awaited<ReturnType<Notifier['send']>>
    try {
      outcome = await notifier.send(link.chatId, row.text)
    } catch (error) {
      outcome = {
        ok: false,
        error: error instanceof Error ? error.message : 'send failed',
      }
    }

    if (outcome.ok) {
      await db
        .update(notifications)
        .set({ status: 'sent', sentAt: now, lastError: null })
        .where(eq(notifications.id, id))
      result.sent++
      continue
    }

    if (outcome.unlink) {
      await db.delete(telegramLinks).where(eq(telegramLinks.userId, row.userId))
    }
    const attempts = row.attempts + 1
    if (outcome.permanent || attempts >= MAX_ATTEMPTS) {
      await db
        .update(notifications)
        .set({ status: 'dead', attempts, lastError: outcome.error })
        .where(eq(notifications.id, id))
      result.dead++
    } else {
      const wait = Math.max(backoffMs(attempts), outcome.retryAfterMs ?? 0)
      await db
        .update(notifications)
        .set({
          attempts,
          lastError: outcome.error,
          nextAttemptAt: new Date(now.getTime() + wait),
        })
        .where(eq(notifications.id, id))
      result.retried++
    }
  }
  return result
}
