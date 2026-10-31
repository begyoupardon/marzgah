import { and, asc, eq, gt, isNull, lt, ne } from 'drizzle-orm'

import { db as defaultDb } from '#/db'
import {
  auditLogs,
  renewalRequests,
  telegramLinkCodes,
  telegramLinks,
  user,
  vpnUsers,
} from '#/db/schema'
import type { Db } from '#/db/types'
import { getBalance } from '#/lib/wallet'
import { viewCondition } from '#/lib/user-filters'
import { createRateLimiter } from '#/lib/rate-limit'
import { getSetting, setSetting } from '#/lib/settings'
import type { Notifier, SendResult } from './types'

export type TelegramConfig = {
  botToken: string
  botUsername: string
  /** Sent back by Telegram in X-Telegram-Bot-Api-Secret-Token. */
  webhookSecret: string
  enabled: boolean
}

const CONFIG_KEY = 'telegram'
const API = 'https://api.telegram.org'
const CODE_TTL_MS = 15 * 60_000
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const telegramRequestLimit = createRateLimiter({ windowMs: 60_000, max: 30 })

export const getTelegramConfig = (db: Db = defaultDb) =>
  getSetting<TelegramConfig>(CONFIG_KEY, db)

export async function saveTelegramConfig(
  input: { botToken?: string; botUsername: string; enabled: boolean },
  db: Db = defaultDb,
) {
  const existing = await getTelegramConfig(db)
  const botToken = input.botToken?.trim() || existing?.botToken
  if (!botToken) throw new Error('Bot token is required')
  const config: TelegramConfig = {
    botToken,
    botUsername: input.botUsername.trim().replace(/^@/, ''),
    webhookSecret: existing?.webhookSecret ?? randomToken(24),
    enabled: input.enabled,
  }
  await setSetting(CONFIG_KEY, config, { encrypted: true }, db)
  return config
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
): Notifier & {
  call: (
    method: string,
    body: unknown,
  ) => Promise<{ ok: boolean; description?: string; result?: unknown }>
} {
  async function call(method: string, body: unknown) {
    const res = await fetchImpl(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
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
      description: json.description,
      result: json.result,
      status: res.status,
      retryAfter: json.parameters?.retry_after,
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
          return { ok: false, retryAfterMs: (r.retryAfter ?? 30) * 1000, error }
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
  { db = defaultDb, now = new Date() }: { db?: Db; now?: Date } = {},
) {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  const code = Array.from(
    bytes,
    (b) => CODE_ALPHABET[b % CODE_ALPHABET.length],
  ).join('')
  await db.delete(telegramLinkCodes).where(eq(telegramLinkCodes.userId, userId))
  await db.delete(telegramLinkCodes).where(lt(telegramLinkCodes.expiresAt, now))
  await db.insert(telegramLinkCodes).values({
    codeHash: await sha256(code),
    userId,
    expiresAt: new Date(now.getTime() + CODE_TTL_MS),
  })
  return { code, expiresAt: new Date(now.getTime() + CODE_TTL_MS) }
}

/** Consume a code (single use) and bind the chat to the panel user. */
export async function confirmLink(
  code: string,
  chatId: string,
  { db = defaultDb, now = new Date() }: { db?: Db; now?: Date } = {},
): Promise<{ userId: string } | null> {
  const hash = await sha256(code.trim().toUpperCase())
  const [row] = await db
    .delete(telegramLinkCodes)
    .where(
      and(
        eq(telegramLinkCodes.codeHash, hash),
        gt(telegramLinkCodes.expiresAt, now),
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
    .values({ userId: row.userId, chatId })
    .onConflictDoUpdate({
      target: telegramLinks.userId,
      set: { chatId, linkedAt: now },
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

export async function adminUserIds(db: Db = defaultDb) {
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.role, 'admin'))
  return rows.map((r) => r.id)
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let out = 0
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return out === 0
}

type Update = {
  message?: {
    text?: string
    from?: { id: number }
    chat?: { id: number; type: string }
  }
}

const MENU = [
  'دستورهای ربات:',
  '/wallet — موجودی کیف پول',
  '/expiring — اشتراک‌های در حال انقضا',
  '/renewals — درخواست‌های تمدید',
  '/status نام‌کاربری — وضعیت یک مشتری',
  '/unlink — قطع اتصال تلگرام',
].join('\n')

const faNumber = (value: number) => value.toLocaleString('fa-IR')

function formatDate(value: Date | null) {
  return value
    ? new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium' }).format(value)
    : 'بدون تاریخ'
}

async function auditBotAction(userId: string, action: string, db: Db) {
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

async function runResellerCommand(
  text: string,
  userId: string,
  chatId: string,
  send: Notifier,
  db: Db,
) {
  const [account] = await db
    .select({ role: user.role })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  if (account?.role !== 'reseller') {
    await send.send(chatId, 'این ربات برای حساب‌های فروشنده فعال است.')
    return
  }

  const [command, ...args] = text.split(/\s+/)
  const normalizedCommand = command?.replace(/@\w+$/, '')
  const allowedCommands = [
    '/menu',
    '/help',
    '/wallet',
    '/expiring',
    '/renewals',
    '/status',
    '/unlink',
  ]
  if (normalizedCommand && allowedCommands.includes(normalizedCommand)) {
    await auditBotAction(userId, `command${normalizedCommand}`, db)
  }
  switch (normalizedCommand) {
    case '/menu':
    case '/help':
      await send.send(chatId, MENU)
      return
    case '/wallet': {
      const balance = await getBalance(userId, db)
      await send.send(chatId, `موجودی کیف پول: ${faNumber(balance)} تومان`)
      return
    }
    case '/expiring': {
      const rows = await db
        .select({
          username: vpnUsers.marzbanUsername,
          expireAt: vpnUsers.expireAt,
        })
        .from(vpnUsers)
        .where(and(eq(vpnUsers.resellerId, userId), viewCondition('expiring')))
        .orderBy(asc(vpnUsers.expireAt))
        .limit(10)
      await send.send(
        chatId,
        rows.length
          ? `اشتراک‌های در حال انقضا (حداکثر ۱۰ مورد):\n${rows
              .map((row) => `• ${row.username} — ${formatDate(row.expireAt)}`)
              .join('\n')}`
          : 'اشتراک در حال انقضایی ندارید.',
      )
      return
    }
    case '/renewals': {
      const rows = await db
        .select({
          username: vpnUsers.marzbanUsername,
          months: renewalRequests.months,
          message: renewalRequests.message,
          createdAt: renewalRequests.createdAt,
        })
        .from(renewalRequests)
        .innerJoin(vpnUsers, eq(vpnUsers.id, renewalRequests.vpnUserId))
        .where(
          and(
            eq(renewalRequests.resellerId, userId),
            eq(renewalRequests.status, 'pending'),
          ),
        )
        .orderBy(asc(renewalRequests.createdAt))
        .limit(10)
      await send.send(
        chatId,
        rows.length
          ? `درخواست‌های تمدید در انتظار (برای بررسی به پنل بروید):\n${rows
              .map(
                (row) =>
                  `• ${row.username} — ${faNumber(row.months)} ماه${
                    row.message ? `\n  ${row.message}` : ''
                  }`,
              )
              .join('\n')}`
          : 'درخواست تمدید در انتظاری ندارید.',
      )
      return
    }
    case '/status': {
      const username = args.join(' ').replace(/^@/, '').slice(0, 128)
      if (!username) {
        await send.send(chatId, 'روش استفاده: /status نام‌کاربری')
        return
      }
      const [row] = await db
        .select({
          username: vpnUsers.marzbanUsername,
          status: vpnUsers.status,
          used: vpnUsers.usedTrafficBytes,
          limit: vpnUsers.dataLimitBytes,
          expireAt: vpnUsers.expireAt,
        })
        .from(vpnUsers)
        .where(
          and(
            eq(vpnUsers.resellerId, userId),
            eq(vpnUsers.marzbanUsername, username),
            isNull(vpnUsers.removedAt),
          ),
        )
        .limit(1)
      if (!row) {
        await send.send(chatId, 'مشتری پیدا نشد.')
        return
      }
      const usage = `${(row.used / 1024 ** 3).toFixed(2)} / ${
        row.limit === null
          ? 'نامحدود'
          : `${(row.limit / 1024 ** 3).toFixed(2)} GB`
      }`
      await send.send(
        chatId,
        `وضعیت ${row.username}: ${row.status}\nمصرف: ${usage}\nانقضا: ${formatDate(row.expireAt)}`,
      )
      return
    }
    case '/unlink':
      await send.send(
        chatId,
        'اتصال تلگرام قطع شد. برای اتصال دوباره از پنل کد جدید بگیرید.',
      )
      await unlinkTelegram(userId, db)
      return
    default:
      await send.send(chatId, MENU)
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
  }: { db?: Db; notifier?: Notifier; now?: Date } = {},
) {
  const config = await getTelegramConfig(db)
  const header = request.headers.get('x-telegram-bot-api-secret-token') ?? ''
  if (!config?.enabled || !timingSafeEqual(header, config.webhookSecret)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const update = (await request.json().catch(() => null)) as Update | null
  const text = update?.message?.text?.trim()
  const chat = update?.message?.chat
  const senderId = update?.message?.from?.id
  if (
    !text ||
    !chat ||
    chat.type !== 'private' ||
    !senderId ||
    chat.id !== senderId
  )
    return Response.json({ ok: true })

  const send = notifier ?? createTelegramNotifier(config.botToken)
  if (!telegramRequestLimit.hit(String(senderId), now.getTime()).allowed) {
    await send.send(
      String(chat.id),
      'درخواست‌ها زیاد است. یک دقیقه دیگر دوباره تلاش کنید.',
    )
    return Response.json({ ok: true })
  }
  try {
    const match = /^\/start(?:@\w+)?\s+([A-Za-z0-9]{6,16})$/.exec(text)
    if (match) {
      const linked = await confirmLink(match[1], String(senderId), { db, now })
      let isReseller = false
      if (linked) {
        await auditBotAction(linked.userId, 'link', db)
        const [account] = await db
          .select({ role: user.role })
          .from(user)
          .where(eq(user.id, linked.userId))
          .limit(1)
        isReseller = account?.role === 'reseller'
      }
      await send.send(
        String(chat.id),
        linked
          ? `✅ حساب شما متصل شد. اعلان‌ها از این پس اینجا ارسال می‌شود.${
              isReseller ? `\n\n${MENU}` : ''
            }`
          : 'کد نامعتبر یا منقضی شده است. در پنل دوباره کد بگیرید.',
      )
      return Response.json({ ok: true })
    }

    const [link] = await db
      .select({ userId: telegramLinks.userId })
      .from(telegramLinks)
      .where(eq(telegramLinks.chatId, String(senderId)))
      .limit(1)
    if (!link) {
      await send.send(
        String(chat.id),
        'برای اتصال، از دکمه «اتصال تلگرام» داخل پنل استفاده کنید.',
      )
      return Response.json({ ok: true })
    }
    await runResellerCommand(text, link.userId, String(chat.id), send, db)
  } catch {
    await send.send(
      String(chat.id),
      'انجام درخواست ممکن نشد. کمی بعد دوباره تلاش کنید.',
    )
  }
  return Response.json({ ok: true })
}
