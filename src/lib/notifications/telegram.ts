import { and, eq, gt, lt, ne } from 'drizzle-orm'

import { db as defaultDb } from '#/db'
import { telegramLinkCodes, telegramLinks, user } from '#/db/schema'
import type { Db } from '#/db/types'
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
  message?: { text?: string; chat?: { id: number; type: string } }
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
  if (!text || !chat || chat.type !== 'private')
    return Response.json({ ok: true })

  const match = /^\/start(?:@\w+)?\s+([A-Za-z0-9]{6,16})$/.exec(text)
  const send = notifier ?? createTelegramNotifier(config.botToken)
  if (!match) {
    await send.send(
      String(chat.id),
      'برای اتصال، از دکمه «اتصال تلگرام» داخل پنل استفاده کنید.',
    )
    return Response.json({ ok: true })
  }
  const linked = await confirmLink(match[1], String(chat.id), { db, now })
  await send.send(
    String(chat.id),
    linked
      ? '✅ حساب شما به پنل متصل شد. اعلان‌ها از این پس اینجا ارسال می‌شود.'
      : 'کد نامعتبر یا منقضی شده است. در پنل دوباره کد بگیرید.',
  )
  return Response.json({ ok: true })
}
