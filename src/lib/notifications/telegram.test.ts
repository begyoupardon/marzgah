import { expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'

import { createTestDb } from '../../../test/helpers/db'
import { makeReseller, makeVpnUser } from '../../../test/helpers/factories'
import { auditLogs, telegramLinkCodes, telegramLinks } from '#/db/schema'
import {
  confirmLink,
  createLinkCode,
  createTelegramNotifier,
  getTelegramConfig,
  handleTelegramUpdate,
  saveTelegramConfig,
} from './telegram'
import type { Notifier } from './types'

const db = await createTestDb()
const T0 = new Date('2026-03-01T10:00:00Z')
const TOKEN = '123456:SECRET-TOKEN'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })

it('sends plain text without parse mode and never leaks the token in errors', async () => {
  let captured: { url: string; body: Record<string, unknown> } | null = null
  const ok = createTelegramNotifier(TOKEN, (async (
    url: string,
    init: RequestInit,
  ) => {
    captured = { url, body: JSON.parse(init.body as string) }
    return json({ ok: true })
  }) as unknown as typeof fetch)
  expect(await ok.send('42', '<b>hi</b>')).toEqual({ ok: true })
  expect(captured!.body).toEqual({
    chat_id: '42',
    text: '<b>hi</b>',
    disable_web_page_preview: true,
  })
  expect(captured!.body).not.toHaveProperty('parse_mode')

  const leaky = createTelegramNotifier(TOKEN, (async () => {
    throw new Error(
      `connect failed for https://api.telegram.org/bot${TOKEN}/sendMessage`,
    )
  }) as unknown as typeof fetch)
  const r = await leaky.send('1', 'x')
  expect(r.ok).toBe(false)
  expect(JSON.stringify(r)).not.toContain('SECRET-TOKEN')
})

it('classifies Telegram errors', async () => {
  const make = (status: number, body: unknown) =>
    createTelegramNotifier(TOKEN, (async () =>
      json(body, status)) as unknown as typeof fetch)
  expect(
    await make(429, {
      ok: false,
      description: 'Too Many Requests',
      parameters: { retry_after: 7 },
    }).send('1', 'x'),
  ).toMatchObject({ ok: false, retryAfterMs: 7000 })
  expect(
    await make(403, {
      ok: false,
      description: 'bot was blocked by the user',
    }).send('1', 'x'),
  ).toMatchObject({ permanent: true, unlink: true })
  expect(
    await make(400, {
      ok: false,
      description: 'Bad Request: chat not found',
    }).send('1', 'x'),
  ).toMatchObject({ permanent: true, unlink: true })
  expect(
    await make(400, {
      ok: false,
      description: 'Bad Request: message is too long',
    }).send('1', 'x'),
  ).toMatchObject({ permanent: true })
  const transient = await make(502, {
    ok: false,
    description: 'Bad Gateway',
  }).send('1', 'x')
  expect(transient).toMatchObject({ ok: false })
  expect((transient as { permanent?: boolean }).permanent).toBeUndefined()
})

it('stores the bot token encrypted and keeps it when only other fields change', async () => {
  await saveTelegramConfig(
    { botToken: TOKEN, botUsername: '@my_bot', enabled: true },
    db,
  )
  const a = await getTelegramConfig(db)
  expect(a).toMatchObject({
    botToken: TOKEN,
    botUsername: 'my_bot',
    enabled: true,
  })
  await saveTelegramConfig({ botUsername: 'my_bot', enabled: false }, db)
  const b = await getTelegramConfig(db)
  expect(b?.botToken).toBe(TOKEN)
  expect(b?.webhookSecret).toBe(a?.webhookSecret)
  expect(b?.enabled).toBe(false)
  await saveTelegramConfig({ botUsername: 'my_bot', enabled: true }, db)
})

it('link codes are single use, expire, and are stored hashed', async () => {
  const r = await makeReseller(db)
  const { code } = await createLinkCode(r.id, { db, now: T0 })
  const [stored] = await db
    .select()
    .from(telegramLinkCodes)
    .where(eq(telegramLinkCodes.userId, r.id))
  expect(stored?.codeHash).not.toContain(code)

  expect(await confirmLink('WRONGCODE', '555', { db, now: T0 })).toBeNull()
  expect(
    await confirmLink(code.toLowerCase(), '555', {
      db,
      now: new Date(T0.getTime() + 16 * 60_000),
    }),
  ).toBeNull() // expired
  const fresh = await createLinkCode(r.id, { db, now: T0 })
  expect(
    await confirmLink(fresh.code, '555', {
      db,
      now: new Date(T0.getTime() + 60_000),
    }),
  ).toEqual({ userId: r.id })
  expect(await confirmLink(fresh.code, '555', { db, now: T0 })).toBeNull() // already used
  const [link] = await db
    .select()
    .from(telegramLinks)
    .where(eq(telegramLinks.userId, r.id))
  expect(link?.chatId).toBe('555')
})

it('a new code replaces the old one, and a chat can belong to only one user', async () => {
  const a = await makeReseller(db)
  const b = await makeReseller(db)
  const first = await createLinkCode(a.id, { db, now: T0 })
  const second = await createLinkCode(a.id, { db, now: T0 })
  expect(await confirmLink(first.code, '900', { db, now: T0 })).toBeNull()
  await confirmLink(second.code, '900', { db, now: T0 })
  const bCode = await createLinkCode(b.id, { db, now: T0 })
  await confirmLink(bCode.code, '900', { db, now: T0 })
  const rows = await db
    .select()
    .from(telegramLinks)
    .where(eq(telegramLinks.chatId, '900'))
  expect(rows.map((r) => r.userId)).toEqual([b.id])
})

function update(
  secret: string,
  text: string,
  type = 'private',
  senderId = 777,
) {
  return new Request('https://panel.test/api/telegram/webhook', {
    method: 'POST',
    headers: { 'x-telegram-bot-api-secret-token': secret },
    body: JSON.stringify({
      message: {
        text,
        from: { id: senderId },
        chat: { id: senderId, type },
      },
    }),
  })
}

it('the bot webhook rejects bad secrets and links on a valid /start code', async () => {
  const config = (await getTelegramConfig(db))!
  const replies: string[] = []
  const notifier: Notifier = {
    send: async (_c, t) => (replies.push(t), { ok: true }),
  }
  const r = await makeReseller(db)

  expect(
    (
      await handleTelegramUpdate(update('wrong', '/start ABCDEFGH'), {
        db,
        notifier,
      })
    ).status,
  ).toBe(403)
  expect(
    (
      await handleTelegramUpdate(update('', '/start ABCDEFGH'), {
        db,
        notifier,
      })
    ).status,
  ).toBe(403)

  const { code } = await createLinkCode(r.id, { db })
  expect(
    (
      await handleTelegramUpdate(
        update(config.webhookSecret, `/start ${code}`, 'group'),
        { db, notifier },
      )
    ).status,
  ).toBe(200)
  expect(
    await db.select().from(telegramLinks).where(eq(telegramLinks.userId, r.id)),
  ).toHaveLength(0) // groups ignored

  expect(
    (
      await handleTelegramUpdate(
        update(config.webhookSecret, `/start ${code}`),
        { db, notifier },
      )
    ).status,
  ).toBe(200)
  expect(
    (
      await db
        .select()
        .from(telegramLinks)
        .where(eq(telegramLinks.userId, r.id))
    )[0]?.chatId,
  ).toBe('777')
  expect(replies.at(-1)).toContain('متصل شد')

  await handleTelegramUpdate(update(config.webhookSecret, `/start ${code}`), {
    db,
    notifier,
  })
  expect(replies.at(-1)).toContain('نامعتبر')
})

it('refuses webhook calls while the integration is disabled', async () => {
  const config = (await getTelegramConfig(db))!
  await saveTelegramConfig({ botUsername: 'my_bot', enabled: false }, db)
  expect(
    (await handleTelegramUpdate(update(config.webhookSecret, 'hi'), { db }))
      .status,
  ).toBe(403)
  await saveTelegramConfig({ botUsername: 'my_bot', enabled: true }, db)
})

it('scopes reseller bot lookups, audits commands, and lets the owner unlink', async () => {
  const config = (await getTelegramConfig(db))!
  const reseller = await makeReseller(db)
  const otherReseller = await makeReseller(db)
  const owned = await makeVpnUser(db, reseller.id)
  await makeVpnUser(db, otherReseller.id, {
    marzbanUsername: 'someone_else',
  })
  const { code } = await createLinkCode(reseller.id, { db })
  await confirmLink(code, '808', { db })
  const replies: string[] = []
  const notifier: Notifier = {
    send: async (_chatId, text) => (replies.push(text), { ok: true }),
  }

  await handleTelegramUpdate(
    update(
      config.webhookSecret,
      `/status ${owned.marzbanUsername}`,
      'private',
      808,
    ),
    { db, notifier },
  )
  expect(replies.at(-1)).toContain(owned.marzbanUsername)

  await handleTelegramUpdate(
    update(config.webhookSecret, '/status someone_else', 'private', 808),
    { db, notifier },
  )
  expect(replies.at(-1)).toBe('مشتری پیدا نشد.')

  const logs = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.actorUserId, reseller.id))
  expect(
    logs.filter((row) => row.action === 'telegram.command/status'),
  ).toHaveLength(2)

  await handleTelegramUpdate(
    update(config.webhookSecret, '/unlink', 'private', 808),
    { db, notifier },
  )
  expect(
    await db
      .select()
      .from(telegramLinks)
      .where(eq(telegramLinks.userId, reseller.id)),
  ).toHaveLength(0)
})
