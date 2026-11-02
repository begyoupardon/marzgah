import { and, asc, eq, gt, isNull, lt, ne } from 'drizzle-orm'

import { db as defaultDb } from '#/db'
import {
  auditLogs,
  telegramBots,
  telegramConfirmations,
  telegramLinkCodes,
  telegramLinks,
  telegramUpdates,
  user,
} from '#/db/schema'
import type { Db } from '#/db/types'
import { createRateLimiter } from '#/lib/rate-limit'
import { mainMenu, type Keyboard } from './telegram-ui'
import { decryptJson, encryptJson, getSetting } from '#/lib/settings'
import type { Notifier, SendResult } from './types'

export type TelegramConfig = {
  botToken: string
  botUsername: string
  /** Sent back by Telegram in X-Telegram-Bot-Api-Secret-Token. */
  webhookSecret: string
  enabled: boolean
}

export type TelegramBot = {
  id: string
  kind: 'platform' | 'reseller'
  ownerUserId: string | null
  botUsername: string
  botToken: string
  webhookSecret: string
  enabled: boolean
  legacyShared: boolean
}

const LEGACY_BOT_ID = 'telegram-platform-legacy'

const CONFIG_KEY = 'telegram'
const API = 'https://api.telegram.org'
const CODE_TTL_MS = 15 * 60_000
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const telegramRequestLimit = createRateLimiter({ windowMs: 60_000, max: 30 })

async function hashText(text: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  )
  return Buffer.from(digest).toString('hex')
}

async function ensureLegacyBot(db: Db) {
  const [existing] = await db
    .select({ id: telegramBots.id })
    .from(telegramBots)
    .where(eq(telegramBots.kind, 'platform'))
    .limit(1)
  if (existing) return existing.id

  const legacy = await getSetting<TelegramConfig>(CONFIG_KEY, db)
  if (!legacy?.botToken || !legacy.webhookSecret) return null
  const now = new Date()
  await db
    .insert(telegramBots)
    .values({
      id: LEGACY_BOT_ID,
      kind: 'platform',
      ownerUserId: null,
      botUsername: legacy.botUsername.replace(/^@/, ''),
      tokenCiphertext: await encryptJson(legacy.botToken),
      webhookSecretHash: await hashText(legacy.webhookSecret),
      webhookSecretCiphertext: await encryptJson(legacy.webhookSecret),
      enabled: legacy.enabled,
      legacyShared: true,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
  await db
    .update(telegramLinks)
    .set({ botId: LEGACY_BOT_ID })
    .where(isNull(telegramLinks.botId))
  await db
    .update(telegramLinkCodes)
    .set({ botId: LEGACY_BOT_ID })
    .where(isNull(telegramLinkCodes.botId))
  return LEGACY_BOT_ID
}

async function decryptBot(
  row: typeof telegramBots.$inferSelect | undefined,
): Promise<TelegramBot | null> {
  if (!row) return null
  const [botToken, webhookSecret] = await Promise.all([
    decryptJson<string>(row.tokenCiphertext),
    decryptJson<string>(row.webhookSecretCiphertext),
  ])
  return { ...row, botToken, webhookSecret }
}

export async function getPlatformTelegramBot(db: Db = defaultDb) {
  await ensureLegacyBot(db)
  const [row] = await db
    .select()
    .from(telegramBots)
    .where(eq(telegramBots.kind, 'platform'))
    .limit(1)
  return decryptBot(row)
}

export async function getResellerTelegramBot(
  ownerUserId: string,
  db: Db = defaultDb,
) {
  const [row] = await db
    .select()
    .from(telegramBots)
    .where(
      and(
        eq(telegramBots.kind, 'reseller'),
        eq(telegramBots.ownerUserId, ownerUserId),
      ),
    )
    .limit(1)
  return decryptBot(row)
}

export async function getTelegramBotByWebhookSecret(
  secret: string,
  db: Db = defaultDb,
) {
  await ensureLegacyBot(db)
  const hash = await hashText(secret)
  const [row] = await db
    .select()
    .from(telegramBots)
    .where(
      and(
        eq(telegramBots.webhookSecretHash, hash),
        eq(telegramBots.enabled, true),
      ),
    )
    .limit(1)
  return decryptBot(row)
}

export async function listTelegramBots(db: Db = defaultDb) {
  await ensureLegacyBot(db)
  return db
    .select({
      id: telegramBots.id,
      kind: telegramBots.kind,
      ownerUserId: telegramBots.ownerUserId,
      botUsername: telegramBots.botUsername,
      enabled: telegramBots.enabled,
      legacyShared: telegramBots.legacyShared,
      createdAt: telegramBots.createdAt,
    })
    .from(telegramBots)
    .orderBy(asc(telegramBots.createdAt))
}

export async function saveTelegramBot(
  input: {
    kind: 'platform' | 'reseller'
    ownerUserId: string | null
    botToken?: string
    botUsername: string
    enabled?: boolean
  },
  db: Db = defaultDb,
) {
  if (input.kind === 'platform') await ensureLegacyBot(db)
  const existing =
    input.kind === 'platform'
      ? await getPlatformTelegramBot(db)
      : input.ownerUserId
        ? await getResellerTelegramBot(input.ownerUserId, db)
        : null
  const token = input.botToken?.trim() || existing?.botToken
  if (!token) throw new Error('Bot token is required')
  const tokenChanged = Boolean(
    input.botToken?.trim() && input.botToken.trim() !== existing?.botToken,
  )
  const webhookSecret =
    tokenChanged || !existing ? randomToken(24) : existing.webhookSecret
  const id = existing?.id ?? crypto.randomUUID()
  const configured = await db.select().from(telegramBots)
  for (const row of configured) {
    if (row.id === id) continue
    const other = await decryptBot(row)
    if (other?.botToken === token)
      throw new Error('This Telegram bot is already configured')
  }
  const now = new Date()
  const values = {
    id,
    kind: input.kind,
    ownerUserId: input.kind === 'reseller' ? input.ownerUserId : null,
    botUsername: input.botUsername.trim().replace(/^@/, ''),
    tokenCiphertext: await encryptJson(token),
    webhookSecretHash: await hashText(webhookSecret),
    webhookSecretCiphertext: await encryptJson(webhookSecret),
    enabled: input.enabled ?? existing?.enabled ?? true,
    legacyShared: existing?.legacyShared ?? false,
    updatedAt: now,
    ...(!existing ? { createdAt: now } : {}),
  }
  await db
    .insert(telegramBots)
    .values(values)
    .onConflictDoUpdate({
      target: telegramBots.id,
      set: {
        botUsername: values.botUsername,
        tokenCiphertext: values.tokenCiphertext,
        webhookSecretHash: values.webhookSecretHash,
        webhookSecretCiphertext: values.webhookSecretCiphertext,
        enabled: values.enabled,
        updatedAt: now,
      },
    })
  return { ...(await getBotById(id, db))!, tokenChanged }
}

export async function getBotById(id: string, db: Db = defaultDb) {
  const [row] = await db
    .select()
    .from(telegramBots)
    .where(eq(telegramBots.id, id))
    .limit(1)
  return decryptBot(row)
}

export async function disableTelegramBot(id: string, db: Db = defaultDb) {
  await db
    .update(telegramBots)
    .set({ enabled: false, updatedAt: new Date() })
    .where(eq(telegramBots.id, id))
}

export async function getTelegramConfig(db: Db = defaultDb) {
  const bot = await getPlatformTelegramBot(db)
  return bot
    ? {
        botToken: bot.botToken,
        botUsername: bot.botUsername,
        webhookSecret: bot.webhookSecret,
        enabled: bot.enabled,
      }
    : null
}

export async function saveTelegramConfig(
  input: { botToken?: string; botUsername: string; enabled: boolean },
  db: Db = defaultDb,
) {
  const bot = await saveTelegramBot(
    { kind: 'platform', ownerUserId: null, ...input },
    db,
  )
  return {
    botToken: bot.botToken,
    botUsername: bot.botUsername,
    webhookSecret: bot.webhookSecret,
    enabled: bot.enabled,
  }
}

function randomToken(bytes: number) {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString(
    'base64url',
  )
}

/** Remove anything that looks like the bot token from an error string. */
function scrub(message: string, token: string) {
  return message.split(token).join('***')
}

export function createTelegramNotifier(
  token: string,
  fetchImpl: typeof fetch = fetch,
  apiBase = API,
): Notifier & {
  call: (
    method: string,
    body: unknown,
  ) => Promise<{ ok: boolean; description?: string; result?: unknown }>
} {
  async function call(method: string, body: unknown) {
    try {
      const res = await fetchImpl(`${apiBase}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        // A slow or filtered route to Telegram must not hang the webhook.
        signal: AbortSignal.timeout(15_000),
      })
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        description?: string
        result?: unknown
        error_code?: number
        parameters?: { retry_after?: number }
      }
      return {
        ok: Boolean(json.ok),
        description: json.description
          ? scrub(json.description, token)
          : undefined,
        result: json.result,
        status: res.status,
        retryAfter: json.parameters?.retry_after,
      }
    } catch (error) {
      throw new Error(
        scrub(
          error instanceof Error
            ? error.message
            : 'Telegram API request failed',
          token,
        ),
      )
    }
  }
  return {
    call,
    async send(chatId, text): Promise<SendResult> {
      try {
        const r = await call('sendMessage', {
          chat_id: chatId,
          text,
          disable_web_page_preview: true,
        })
        if (r.ok) return { ok: true }
        const error = scrub(r.description ?? `HTTP ${r.status}`, token)
        if (r.status === 429)
          return {
            ok: false,
            retryAfterMs: (r.retryAfter ?? 30) * 1000,
            error,
          }
        if (r.status === 403)
          return { ok: false, permanent: true, unlink: true, error }
        if (r.status === 400 && /chat not found/i.test(error))
          return { ok: false, permanent: true, unlink: true, error }
        if (r.status >= 400 && r.status < 500)
          return { ok: false, permanent: true, error }
        return { ok: false, error }
      } catch (error) {
        return {
          ok: false,
          error: scrub(
            error instanceof Error ? error.message : 'network error',
            token,
          ),
        }
      }
    },
  }
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  )
  return Buffer.from(digest).toString('hex')
}

/** One active code per user; shown once, valid for 15 minutes. */
export async function createLinkCode(
  userId: string,
  {
    db = defaultDb,
    now = new Date(),
    botId,
  }: { db?: Db; now?: Date; botId?: string } = {},
) {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  const code = Array.from(
    bytes,
    (b) => CODE_ALPHABET[b % CODE_ALPHABET.length],
  ).join('')
  const targetBotId = botId ?? (await getPlatformTelegramBot(db))?.id ?? null
  if (!targetBotId) throw new Error('Telegram bot is not configured')
  await db.delete(telegramLinkCodes).where(eq(telegramLinkCodes.userId, userId))
  await db.delete(telegramLinkCodes).where(lt(telegramLinkCodes.expiresAt, now))
  await db.insert(telegramLinkCodes).values({
    codeHash: await sha256(code),
    userId,
    botId: targetBotId,
    expiresAt: new Date(now.getTime() + CODE_TTL_MS),
  })
  return { code, expiresAt: new Date(now.getTime() + CODE_TTL_MS) }
}

/** Consume a code (single use) and bind the chat to the panel user. */
export async function confirmLink(
  code: string,
  chatId: string,
  {
    db = defaultDb,
    now = new Date(),
    botId,
  }: { db?: Db; now?: Date; botId?: string } = {},
): Promise<{ userId: string } | null> {
  const hash = await sha256(code.trim().toUpperCase())
  const [row] = await db
    .delete(telegramLinkCodes)
    .where(
      and(
        eq(telegramLinkCodes.codeHash, hash),
        gt(telegramLinkCodes.expiresAt, now),
        ...(botId ? [eq(telegramLinkCodes.botId, botId)] : []),
      ),
    )
    .returning()
  if (!row) return null
  // A chat belongs to exactly one panel user.
  await db
    .delete(telegramLinks)
    .where(
      and(
        eq(telegramLinks.chatId, chatId),
        ne(telegramLinks.userId, row.userId),
      ),
    )
  await db
    .insert(telegramLinks)
    .values({ userId: row.userId, chatId, botId: row.botId ?? botId ?? null })
    .onConflictDoUpdate({
      target: telegramLinks.userId,
      set: { chatId, botId: row.botId ?? botId ?? null, linkedAt: now },
    })
  return { userId: row.userId }
}

export async function unlinkTelegram(userId: string, db: Db = defaultDb) {
  await db.delete(telegramLinks).where(eq(telegramLinks.userId, userId))
}

export async function isLinked(userId: string, db: Db = defaultDb) {
  const [row] = await db
    .select({ u: telegramLinks.userId })
    .from(telegramLinks)
    .where(eq(telegramLinks.userId, userId))
    .limit(1)
  return Boolean(row)
}

export async function createTelegramConfirmation(
  input: {
    botId: string
    actorUserId: string
    chatId: string
    action: string
    payload: unknown
  },
  { db = defaultDb, now = new Date() }: { db?: Db; now?: Date } = {},
) {
  const token = randomToken(12)
  await db.insert(telegramConfirmations).values({
    id: await hashText(token),
    botId: input.botId,
    actorUserId: input.actorUserId,
    chatId: input.chatId,
    action: input.action,
    payloadJson: JSON.stringify(input.payload),
    expiresAt: new Date(now.getTime() + 5 * 60_000),
  })
  return { token, expiresAt: new Date(now.getTime() + 5 * 60_000) }
}

export async function consumeTelegramConfirmation(
  token: string,
  expected: { botId: string; actorUserId: string; chatId: string },
  { db = defaultDb, now = new Date() }: { db?: Db; now?: Date } = {},
) {
  const [row] = await db
    .update(telegramConfirmations)
    .set({ consumedAt: now })
    .where(
      and(
        eq(telegramConfirmations.id, await hashText(token)),
        eq(telegramConfirmations.botId, expected.botId),
        eq(telegramConfirmations.actorUserId, expected.actorUserId),
        eq(telegramConfirmations.chatId, expected.chatId),
        isNull(telegramConfirmations.consumedAt),
        gt(telegramConfirmations.expiresAt, now),
      ),
    )
    .returning()
  if (!row) return null
  return {
    action: row.action,
    payload: JSON.parse(row.payloadJson) as unknown,
  }
}

export async function cancelTelegramConfirmation(
  token: string,
  expected: { botId: string; actorUserId: string; chatId: string },
  db: Db = defaultDb,
) {
  await db
    .update(telegramConfirmations)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(telegramConfirmations.id, await hashText(token)),
        eq(telegramConfirmations.botId, expected.botId),
        eq(telegramConfirmations.actorUserId, expected.actorUserId),
        eq(telegramConfirmations.chatId, expected.chatId),
        isNull(telegramConfirmations.consumedAt),
      ),
    )
}

export async function claimTelegramUpdate(
  botId: string,
  updateId: string | number,
  { db = defaultDb, now = new Date() }: { db?: Db; now?: Date } = {},
) {
  const [inserted] = await db
    .insert(telegramUpdates)
    .values({ botId, updateId: String(updateId), receivedAt: now })
    .onConflictDoNothing()
    .returning({ updateId: telegramUpdates.updateId })
  return Boolean(inserted)
}

export async function adminUserIds(db: Db = defaultDb) {
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.role, 'admin'))
  return rows.map((r) => r.id)
}

function stripTags(html: string) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let out = 0
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return out === 0
}

type Update = {
  update_id?: number
  message?: {
    text?: string
    from?: { id: number }
    chat?: { id: number; type: string }
  }
  callback_query?: {
    id: string
    data?: string
    from?: { id: number }
    message?: { message_id?: number; chat?: { id: number; type: string } }
  }
}

export async function auditBotAction(userId: string, action: string, db: Db) {
  try {
    const [account] = await db
      .select({ role: user.role })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
    if (!account) return
    await db.insert(auditLogs).values({
      id: crypto.randomUUID(),
      actorUserId: userId,
      actorRole: account.role,
      action: `telegram.${action}`,
      entityType: 'telegram',
      entityId: userId,
      resellerId: account.role === 'reseller' ? userId : null,
      payloadJson: JSON.stringify({ channel: 'bot' }),
    })
  } catch {
    // A logging outage must not turn Telegram's webhook into a retry loop.
    console.error('Telegram audit write failed')
  }
}

/**
 * Telegram bot webhook. Always answers 200 for authenticated calls so
 * Telegram doesn't retry; unauthenticated calls get 403.
 */
export async function handleTelegramUpdate(
  request: Request,
  {
    db = defaultDb,
    notifier,
    now = new Date(),
  }: {
    db?: Db
    notifier?: Notifier & {
      call?: ReturnType<typeof createTelegramNotifier>['call']
    }
    now?: Date
  } = {},
) {
  const header = request.headers.get('x-telegram-bot-api-secret-token') ?? ''
  const bot = header ? await getTelegramBotByWebhookSecret(header, db) : null
  if (!bot || !timingSafeEqual(header, bot.webhookSecret)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const update = (await request.json().catch(() => null)) as Update | null
  if (!update || !Number.isSafeInteger(update.update_id))
    return Response.json({ ok: true })
  if (!(await claimTelegramUpdate(bot.id, update.update_id!, { db, now })))
    return Response.json({ ok: true })
  const text = update?.message?.text?.trim()
  const chat = update?.message?.chat
  const callback = update.callback_query
  const senderId = update?.message?.from?.id ?? callback?.from?.id
  const activeChat = chat ?? callback?.message?.chat
  if (
    (!text && !callback?.data) ||
    !activeChat ||
    activeChat.type !== 'private' ||
    !senderId ||
    activeChat.id !== senderId
  )
    return Response.json({ ok: true })

  const send = notifier ?? createTelegramNotifier(bot.botToken)
  if (!telegramRequestLimit.hit(String(senderId), now.getTime()).allowed) {
    await send
      .send(
        String(activeChat.id),
        'درخواست‌ها زیاد است. یک دقیقه دیگر دوباره تلاش کنید.',
      )
      .catch(() => {})
    return Response.json({ ok: true })
  }
  const sendRich = async (
    chatId: string,
    text: string,
    keyboard?: Keyboard,
    editMessageId?: number,
  ) => {
    const body = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: keyboard?.length
        ? {
            inline_keyboard: keyboard.map((row) =>
              row.map((b) => ({ text: b.text, callback_data: b.data })),
            ),
          }
        : undefined,
    }
    const attempt = async (
      method: string,
      payload: Record<string, unknown>,
    ) => {
      const result = await send.call!(method, payload)
      if (!result.ok && !/not modified/i.test(result.description ?? ''))
        console.error(`Telegram ${method} failed: ${result.description}`)
      return result
    }
    if (editMessageId) {
      const edited = await attempt('editMessageText', {
        ...body,
        message_id: editMessageId,
      })
      if (edited.ok || /not modified/i.test(edited.description ?? '')) return
    }
    const sent = await attempt('sendMessage', body)
    // A formatting error must never leave the user with a dead button.
    if (!sent.ok && /parse entities/i.test(sent.description ?? ''))
      await attempt('sendMessage', {
        ...body,
        text: stripTags(text),
        parse_mode: undefined,
      })
  }
  // Stop the button's loading spinner at once, in parallel with the work, and
  // never let a failed acknowledgement turn into a 500 (the retry would be deduped away).
  const ack = callback
    ? Promise.resolve(
        send.call?.('answerCallbackQuery', { callback_query_id: callback.id }),
      ).catch(() => {})
    : undefined
  try {
    const match = /^\/start(?:@\w+)?\s+([A-Za-z0-9]{6,16})$/.exec(text ?? '')
    if (match) {
      const linked = await confirmLink(match[1], String(senderId), {
        db,
        now,
        botId: bot.id,
      })
      let role = 'reseller'
      if (linked) {
        await auditBotAction(linked.userId, 'link', db)
        const [account] = await db
          .select({ role: user.role })
          .from(user)
          .where(eq(user.id, linked.userId))
          .limit(1)
        role = account?.role ?? 'reseller'
      }
      const { telegramMenu } = await import('./telegram-commands')
      const chatId = String(activeChat.id)
      if (!linked) {
        await send.send(
          chatId,
          'کد نامعتبر یا منقضی شده است. در پنل دوباره کد بگیرید.',
        )
      } else if (send.call) {
        await send.send(
          chatId,
          '✅ حساب شما متصل شد. اعلان‌ها از این پس اینجا ارسال می‌شود.',
        )
        const menu = mainMenu(role)
        await sendRich(chatId, menu.text, menu.keyboard)
      } else {
        await send.send(
          chatId,
          `✅ حساب شما متصل شد. اعلان‌ها از این پس اینجا ارسال می‌شود.\n\n${telegramMenu(role, bot.kind === 'reseller')}`,
        )
      }
      return Response.json({ ok: true })
    }

    const [link] = await db
      .select({ userId: telegramLinks.userId, botId: telegramLinks.botId })
      .from(telegramLinks)
      .where(eq(telegramLinks.chatId, String(senderId)))
      .limit(1)
    if (!link || link.botId !== bot.id) {
      await send.send(
        String(activeChat.id),
        'برای اتصال، از دکمه «اتصال تلگرام» داخل پنل استفاده کنید.',
      )
      return Response.json({ ok: true })
    }
    const [account] = await db
      .select({ role: user.role })
      .from(user)
      .where(eq(user.id, link.userId))
      .limit(1)
    const permitted =
      bot.kind === 'platform'
        ? account?.role === 'admin' ||
          (bot.legacyShared && account?.role === 'reseller')
        : bot.ownerUserId === link.userId && account?.role === 'reseller'
    if (!permitted) {
      await send.send(
        String(activeChat.id),
        'این ربات برای حساب شما مجاز نیست. از پنل ربات مناسب را متصل کنید.',
      )
      return Response.json({ ok: true })
    }
    const actor = {
      userId: link.userId,
      botId: bot.id,
      botOwnerId: bot.ownerUserId,
      chatId: String(activeChat.id),
    }
    const { routeTelegramCommand, handleTelegramCallback } =
      await import('./telegram-commands')
    const sendText = async (message: string, keyboard?: Keyboard) => {
      if (!send.call)
        return void (await send.send(String(activeChat.id), stripTags(message)))
      // Button taps edit the message in place so the chat doesn't fill with menus.
      const messageId = callback?.message?.message_id
      await sendRich(String(activeChat.id), message, keyboard, messageId)
    }
    if (callback?.data)
      await handleTelegramCallback(callback.data, actor, {
        db,
        send: sendText,
        now,
      })
    else {
      const commandName = /^\/(\w+)/.exec(text ?? '')?.[1]
      if (commandName)
        await auditBotAction(link.userId, `command/${commandName}`, db)
      await routeTelegramCommand(text ?? '', actor, bot, {
        db,
        send: sendText,
        now,
      })
    }
  } catch {
    await send
      .send(
        String(activeChat.id),
        'انجام درخواست ممکن نشد. کمی بعد دوباره تلاش کنید.',
      )
      .catch(() => {})
  }
  await ack
  return Response.json({ ok: true })
}
