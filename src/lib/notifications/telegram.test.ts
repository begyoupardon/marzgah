import { expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'

import { createTestDb } from '../../../test/helpers/db'
import { makeReseller } from '../../../test/helpers/factories'
import { telegramLinkCodes, telegramLinks } from '#/db/schema'
import { setSetting } from '#/lib/settings'
import {
  confirmLink,
  createLinkCode,
  createTelegramNotifier,
  getTelegramConfig,
  handleTelegramUpdate,
  saveTelegramConfig,
  saveTelegramBot,
  claimTelegramUpdate,
  createTelegramConfirmation,
  consumeTelegramConfirmation,
  getPlatformTelegramBot,
} from './telegram'
import type { Notifier } from './types'

const db = await createTestDb()
const T0 = new Date('2026-03-01T10:00:00Z')
const TOKEN = '123456:SECRET-TOKEN'
let updateId = 0

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
      update_id: ++updateId,
      message: {
        text,
        from: { id: senderId },
        chat: { id: senderId, type },
      },
    }),
  })
}

it('the bot webhook rejects bad secrets and links on a valid /start code', async () => {
  const r = await makeReseller(db)
  const bot = await saveTelegramBot(
    {
      kind: 'reseller',
      ownerUserId: r.id,
      botToken: '123456:OWN-TOKEN',
      botUsername: 'own_bot',
      enabled: true,
    },
    db,
  )
  const replies: string[] = []
  const notifier: Notifier = {
    send: async (_c, t) => (replies.push(t), { ok: true }),
  }

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

  const { code } = await createLinkCode(r.id, { db, botId: bot.id })
  expect(
    (
      await handleTelegramUpdate(
        update(bot.webhookSecret, `/start ${code}`, 'group'),
        { db, notifier },
      )
    ).status,
  ).toBe(200)
  expect(
    await db.select().from(telegramLinks).where(eq(telegramLinks.userId, r.id)),
  ).toHaveLength(0) // groups ignored

  expect(
    (
      await handleTelegramUpdate(update(bot.webhookSecret, `/start ${code}`), {
        db,
        notifier,
      })
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

  await handleTelegramUpdate(update(bot.webhookSecret, `/start ${code}`), {
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
  const reseller = await makeReseller(db)
  const bot = await saveTelegramBot(
    {
      kind: 'reseller',
      ownerUserId: reseller.id,
      botToken: '123456:OWN-TOKEN-2',
      botUsername: 'seller_bot',
      enabled: true,
    },
    db,
  )
  const { code } = await createLinkCode(reseller.id, { db, botId: bot.id })
  await confirmLink(code, '808', { db })
  const replies: string[] = []
  const notifier: Notifier = {
    send: async (_chatId, text) => (replies.push(text), { ok: true }),
  }

  await handleTelegramUpdate(
    update(bot.webhookSecret, '/help', 'private', 808),
    { db, notifier },
  )
  expect(replies.at(-1)).toContain('/create')

  await handleTelegramUpdate(
    update(bot.webhookSecret, '/help', 'private', 808),
    { db, notifier },
  )
  expect(replies.at(-1)).toContain('/wallet')

  await handleTelegramUpdate(
    update(bot.webhookSecret, '/unlink', 'private', 808),
    { db, notifier },
  )
  expect(
    await db
      .select()
      .from(telegramLinks)
      .where(eq(telegramLinks.userId, reseller.id)),
  ).toHaveLength(0)
})

it('deduplicates updates and binds one-use confirmations to bot, user, and chat', async () => {
  const r = await makeReseller(db)
  const bot = await saveTelegramBot(
    {
      kind: 'reseller',
      ownerUserId: r.id,
      botToken: '123456:CONFIRM-TOKEN',
      botUsername: 'confirm_bot',
    },
    db,
  )
  expect(await claimTelegramUpdate(bot.id, 'dup-1', { db, now: T0 })).toBe(true)
  expect(await claimTelegramUpdate(bot.id, 'dup-1', { db, now: T0 })).toBe(
    false,
  )
  const confirmation = await createTelegramConfirmation(
    {
      botId: bot.id,
      actorUserId: r.id,
      chatId: '123',
      action: 'update',
      payload: { status: 'disabled' },
    },
    { db, now: T0 },
  )
  expect(
    await consumeTelegramConfirmation(
      confirmation.token,
      { botId: bot.id, actorUserId: r.id, chatId: 'wrong' },
      { db, now: T0 },
    ),
  ).toBeNull()
  expect(
    await consumeTelegramConfirmation(
      confirmation.token,
      { botId: bot.id, actorUserId: r.id, chatId: '123' },
      { db, now: T0 },
    ),
  ).toMatchObject({ action: 'update' })
  expect(
    await consumeTelegramConfirmation(
      confirmation.token,
      { botId: bot.id, actorUserId: r.id, chatId: '123' },
      { db, now: T0 },
    ),
  ).toBeNull()
  expect(
    await consumeTelegramConfirmation(
      confirmation.token,
      { botId: bot.id, actorUserId: r.id, chatId: '123' },
      { db, now: new Date(T0.getTime() + 6 * 60_000) },
    ),
  ).toBeNull()
})

it('does not accept a Telegram link on a different reseller bot', async () => {
  const owner = await makeReseller(db)
  const intruder = await makeReseller(db)
  const ownerBot = await saveTelegramBot(
    {
      kind: 'reseller',
      ownerUserId: owner.id,
      botToken: '123456:OWNER-BOT',
      botUsername: 'owner_only_bot',
    },
    db,
  )
  const intruderBot = await saveTelegramBot(
    {
      kind: 'reseller',
      ownerUserId: intruder.id,
      botToken: '123456:INTRUDER-BOT',
      botUsername: 'intruder_bot',
    },
    db,
  )
  const { code } = await createLinkCode(intruder.id, {
    db,
    botId: intruderBot.id,
  })
  await confirmLink(code, '899', { db, botId: intruderBot.id })
  expect(
    await db
      .select()
      .from(telegramLinks)
      .where(eq(telegramLinks.chatId, '899')),
  ).toHaveLength(1)
  const replies: string[] = []
  await handleTelegramUpdate(
    update(ownerBot.webhookSecret, '/menu', 'private', 899),
    {
      db,
      notifier: {
        send: async (_chat, text) => (replies.push(text), { ok: true }),
      },
    },
  )
  expect(replies.at(-1)).toContain('اتصال تلگرام')
  expect(replies.at(-1)).not.toContain('/create')
})

it('migrates the former shared bot config and preserves linked reseller chats', async () => {
  const legacyDb = await createTestDb()
  const reseller = await makeReseller(legacyDb)
  await setSetting(
    'telegram',
    {
      botToken: '123456:LEGACY-TOKEN',
      botUsername: 'legacy_bot',
      webhookSecret: 'legacy-webhook-secret',
      enabled: true,
    },
    { encrypted: true },
    legacyDb,
  )
  await legacyDb
    .insert(telegramLinks)
    .values({ userId: reseller.id, chatId: 'legacy-chat' })
  const migrated = await getPlatformTelegramBot(legacyDb)
  expect(migrated).toMatchObject({
    kind: 'platform',
    legacyShared: true,
    botUsername: 'legacy_bot',
    botToken: '123456:LEGACY-TOKEN',
  })
  expect(
    (
      await legacyDb
        .select()
        .from(telegramLinks)
        .where(eq(telegramLinks.userId, reseller.id))
    )[0],
  ).toMatchObject({ botId: migrated?.id, chatId: 'legacy-chat' })
})
