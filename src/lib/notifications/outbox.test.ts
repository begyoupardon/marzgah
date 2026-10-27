import { expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'

import { createTestDb } from '../../../test/helpers/db'
import { makeReseller } from '../../../test/helpers/factories'
import { notifications, telegramLinks } from '#/db/schema'
import { MAX_ATTEMPTS, backoffMs, drainOutbox, enqueue } from './outbox'
import type { Notifier, SendResult } from './types'

const db = await createTestDb()
const T0 = new Date('2026-03-01T10:00:00Z')

function fakeNotifier(
  results: SendResult[] | ((chat: string, text: string) => SendResult),
) {
  const sent: Array<{ chat: string; text: string }> = []
  let i = 0
  const notifier: Notifier = {
    async send(chat, text) {
      sent.push({ chat, text })
      return typeof results === 'function'
        ? results(chat, text)
        : (results[Math.min(i++, results.length - 1)] ?? { ok: true })
    },
  }
  return { notifier, sent }
}

async function linked() {
  const r = await makeReseller(db)
  await db
    .insert(telegramLinks)
    .values({ userId: r.id, chatId: `chat-${r.id}` })
  return r
}
const row = async (key: string) =>
  (
    await db
      .select()
      .from(notifications)
      .where(eq(notifications.dedupeKey, key))
  )[0]

it('is idempotent per dedupeKey', async () => {
  const r = await linked()
  expect(
    await enqueue(
      { userId: r.id, event: 'e', dedupeKey: `${r.id}:a`, text: 'hi' },
      { db, now: T0 },
    ),
  ).toBe(true)
  expect(
    await enqueue(
      { userId: r.id, event: 'e', dedupeKey: `${r.id}:a`, text: 'hi again' },
      { db, now: T0 },
    ),
  ).toBe(false)
  const { notifier, sent } = fakeNotifier([{ ok: true }])
  await drainOutbox({ notifier, db, now: T0 })
  expect(sent.filter((s) => s.chat === `chat-${r.id}`)).toHaveLength(1)
  expect(sent[0]?.text).toBe('hi')
})

it('sends once and never resends a delivered message', async () => {
  const r = await linked()
  await enqueue(
    { userId: r.id, event: 'e', dedupeKey: `${r.id}:once`, text: 'x' },
    { db, now: T0 },
  )
  const { notifier, sent } = fakeNotifier([{ ok: true }])
  const first = await drainOutbox({ notifier, db, now: T0 })
  const second = await drainOutbox({
    notifier,
    db,
    now: new Date(T0.getTime() + 3_600_000),
  })
  expect(first.sent).toBeGreaterThanOrEqual(1)
  expect(second.sent).toBe(0)
  expect(sent.filter((s) => s.text === 'x')).toHaveLength(1)
  expect((await row(`${r.id}:once`)).status).toBe('sent')
})

it('retries with exponential backoff, then goes dead after the max attempts', async () => {
  const r = await linked()
  const key = `${r.id}:flaky`
  await enqueue(
    { userId: r.id, event: 'e', dedupeKey: key, text: 'flaky' },
    { db, now: T0 },
  )
  const { notifier } = fakeNotifier([{ ok: false, error: 'boom' }])
  let now = T0
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await drainOutbox({ notifier, db, now })
    const current = await row(key)
    expect(current.attempts).toBe(attempt)
    if (attempt < MAX_ATTEMPTS) {
      expect(current.status).toBe('queued')
      expect(current.nextAttemptAt.getTime()).toBe(
        now.getTime() + backoffMs(attempt),
      )
      // not due yet one minute earlier
      const early = await drainOutbox({
        notifier,
        db,
        now: new Date(current.nextAttemptAt.getTime() - 60_000),
      })
      expect(early.retried + early.dead + early.sent).toBe(0)
      now = current.nextAttemptAt
    }
  }
  const final = await row(key)
  expect(final.status).toBe('dead')
  expect(final.lastError).toBe('boom')
})

it('honours Telegram retry-after when it is longer than the backoff', async () => {
  const r = await linked()
  const key = `${r.id}:rate`
  await enqueue(
    { userId: r.id, event: 'e', dedupeKey: key, text: 'rate' },
    { db, now: T0 },
  )
  await drainOutbox({
    notifier: fakeNotifier([
      { ok: false, error: 'slow down', retryAfterMs: 3_600_000 },
    ]).notifier,
    db,
    now: T0,
  })
  expect((await row(key)).nextAttemptAt.getTime()).toBe(
    T0.getTime() + 3_600_000,
  )
})

it('stops retrying a blocked chat and removes the link', async () => {
  const r = await linked()
  const key = `${r.id}:blocked`
  await enqueue(
    { userId: r.id, event: 'e', dedupeKey: key, text: 'b' },
    { db, now: T0 },
  )
  await drainOutbox({
    notifier: fakeNotifier([
      { ok: false, permanent: true, unlink: true, error: 'blocked' },
    ]).notifier,
    db,
    now: T0,
  })
  expect((await row(key)).status).toBe('dead')
  expect(
    await db.select().from(telegramLinks).where(eq(telegramLinks.userId, r.id)),
  ).toHaveLength(0)
})

it('skips recipients with no linked channel', async () => {
  const r = await makeReseller(db)
  await enqueue(
    { userId: r.id, event: 'e', dedupeKey: `${r.id}:nolink`, text: 'n' },
    { db, now: T0 },
  )
  const { notifier, sent } = fakeNotifier([{ ok: true }])
  const result = await drainOutbox({ notifier, db, now: T0 })
  expect(result.skipped).toBeGreaterThanOrEqual(1)
  expect(sent.find((s) => s.text === 'n')).toBeUndefined()
  expect((await row(`${r.id}:nolink`)).status).toBe('skipped')
})

it('a thrown notifier counts as a transient failure and does not block other rows', async () => {
  const a = await linked()
  const b = await linked()
  await enqueue(
    { userId: a.id, event: 'e', dedupeKey: `${a.id}:throw`, text: 'throws' },
    { db, now: T0 },
  )
  await enqueue(
    { userId: b.id, event: 'e', dedupeKey: `${b.id}:fine`, text: 'fine' },
    { db, now: T0 },
  )
  const notifier: Notifier = {
    async send(_chat, text) {
      if (text === 'throws') throw new Error('network down')
      return { ok: true }
    },
  }
  await drainOutbox({ notifier, db, now: T0 })
  expect((await row(`${a.id}:throw`)).status).toBe('queued')
  expect((await row(`${b.id}:fine`)).status).toBe('sent')
})

it('two workers cannot send the same row', async () => {
  const r = await linked()
  await enqueue(
    { userId: r.id, event: 'e', dedupeKey: `${r.id}:race`, text: 'race' },
    { db, now: T0 },
  )
  const { notifier, sent } = fakeNotifier([{ ok: true }])
  await Promise.all([
    drainOutbox({ notifier, db, now: T0 }),
    drainOutbox({ notifier, db, now: T0 }),
  ])
  expect(sent.filter((s) => s.text === 'race')).toHaveLength(1)
})
