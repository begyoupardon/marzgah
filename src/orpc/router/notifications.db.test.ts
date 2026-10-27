import { afterAll, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'

import { callAs, setupRouterTest } from '../../../test/helpers/orpc'
import { makeReseller, makeUser } from '../../../test/helpers/factories'
import { notifications } from '#/db/schema'

const db = await setupRouterTest()
const api = await import('./notifications')
const { handleTelegramUpdate } = await import('#/lib/notifications/telegram')
const { enqueue } = await import('#/lib/notifications/outbox')

const realFetch = globalThis.fetch
const calls: Array<{ url: string; body: Record<string, unknown> }> = []
globalThis.fetch = (async (url: string, init?: RequestInit) => {
  calls.push({
    url: String(url),
    body: init?.body ? JSON.parse(init.body as string) : {},
  })
  if (String(url).endsWith('/getMe'))
    return Response.json({ ok: true, result: { username: 'my_bot' } })
  return Response.json({ ok: true, result: true })
}) as unknown as typeof fetch
afterAll(() => {
  globalThis.fetch = realFetch
})

const admin = await makeUser(db, 'admin')
const alice = await makeReseller(db)
const bob = await makeReseller(db)
const TOKEN = '999999:ABCDEF-secret'

it('is unavailable until an admin configures the bot', async () => {
  expect(await callAs(api.telegramStatus, undefined, alice.id)).toMatchObject({
    available: false,
    linked: false,
    botUsername: null,
  })
  await expect(
    callAs(api.startTelegramLink, undefined, alice.id),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
})

it('only admins can configure the bot, and the token is never returned', async () => {
  const input = { botToken: TOKEN, botUsername: '@my_bot', enabled: true }
  await expect(
    callAs(api.saveTelegramAdmin, input, alice.id),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  await expect(
    callAs(api.getTelegramAdmin, undefined, alice.id),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  await callAs(api.saveTelegramAdmin, input, admin.id)
  const view = JSON.stringify(
    await callAs(api.getTelegramAdmin, undefined, admin.id),
  )
  expect(view).toContain('my_bot')
  expect(view).not.toContain('ABCDEF')
  expect(
    JSON.stringify(await callAs(api.telegramStatus, undefined, alice.id)),
  ).not.toContain('ABCDEF')
})

it('walks a seller through linking, then unlinking', async () => {
  const started = (await callAs(
    api.startTelegramLink,
    undefined,
    alice.id,
  )) as { code: string; deepLink: string }
  expect(started.deepLink).toBe(`https://t.me/my_bot?start=${started.code}`)

  const { getTelegramConfig } = await import('#/lib/notifications/telegram')
  const config = (await getTelegramConfig(db))!
  const res = await handleTelegramUpdate(
    new Request('https://panel.test/api/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': config.webhookSecret },
      body: JSON.stringify({
        message: {
          text: `/start ${started.code}`,
          chat: { id: 4242, type: 'private' },
        },
      }),
    }),
    { db, notifier: { send: async () => ({ ok: true }) } },
  )
  expect(res.status).toBe(200)
  expect(await callAs(api.telegramStatus, undefined, alice.id)).toMatchObject({
    linked: true,
  })
  expect(await callAs(api.telegramStatus, undefined, bob.id)).toMatchObject({
    linked: false,
  })

  calls.length = 0
  await callAs(api.sendTestMessage, undefined, alice.id)
  expect(calls.at(-1)).toMatchObject({ body: { chat_id: '4242' } })
  await expect(
    callAs(api.sendTestMessage, undefined, bob.id),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' })

  await callAs(api.unlinkMyTelegram, undefined, alice.id)
  expect(await callAs(api.telegramStatus, undefined, alice.id)).toMatchObject({
    linked: false,
  })
})

it('registers the webhook only over https, with the secret token', async () => {
  const before = process.env.BETTER_AUTH_URL
  process.env.BETTER_AUTH_URL = 'http://localhost:3000'
  await expect(
    callAs(api.registerTelegramWebhook, undefined, admin.id),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  process.env.BETTER_AUTH_URL = 'https://panel.example.com'
  calls.length = 0
  const r = (await callAs(
    api.registerTelegramWebhook,
    undefined,
    admin.id,
  )) as { username: string }
  expect(r.username).toBe('my_bot')
  const set = calls.find((c) => c.url.endsWith('/setWebhook'))!
  expect(set.body.url).toBe('https://panel.example.com/api/telegram/webhook')
  expect(typeof set.body.secret_token).toBe('string')
  expect(set.body.allowed_updates).toEqual(['message'])
  await expect(
    callAs(api.registerTelegramWebhook, undefined, alice.id),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  process.env.BETTER_AUTH_URL = before
})

it('queues a notification for every admin without duplicates', async () => {
  const second = await makeUser(db, 'admin')
  for (const adminId of [admin.id, second.id]) {
    await enqueue(
      {
        userId: adminId,
        event: 'announcement',
        dedupeKey: `announcement-test:${adminId}`,
        text: 'test notification',
      },
      { db },
    )
    await enqueue(
      {
        userId: adminId,
        event: 'announcement',
        dedupeKey: `announcement-test:${adminId}`,
        text: 'test notification',
      },
      { db },
    )
  }
  for (const id of [admin.id, second.id]) {
    expect(
      await db.select().from(notifications).where(eq(notifications.userId, id)),
    ).toHaveLength(1)
  }
})

it('shows admins outbox health only', async () => {
  const stats = (await callAs(api.outboxStats, undefined, admin.id)) as {
    counts: Record<string, number>
  }
  expect(stats.counts.queued).toBeGreaterThanOrEqual(2)
  await expect(
    callAs(api.outboxStats, undefined, alice.id),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' })
})
