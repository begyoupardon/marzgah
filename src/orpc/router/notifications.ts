import { ORPCError } from '@orpc/server'
import { desc, eq, sql } from 'drizzle-orm'
import * as z from 'zod'

import { db } from '#/db'
import { notifications } from '#/db/schema'
import { getEnv } from '#/lib/env'
import { writeAuditLog } from '#/lib/ledger'
import {
  createLinkCode,
  createTelegramNotifier,
  getTelegramConfig,
  isLinked,
  saveTelegramConfig,
  unlinkTelegram,
} from '#/lib/notifications/telegram'
import { adminOnly, authed } from '../middleware'

export const telegramStatus = authed.handler(async ({ context }) => {
  const config = await getTelegramConfig()
  return {
    available: Boolean(config?.enabled),
    botUsername: config?.enabled ? config.botUsername : null,
    linked: await isLinked(context.user.id),
  }
})

export const startTelegramLink = authed.handler(async ({ context }) => {
  const config = await getTelegramConfig()
  if (!config?.enabled)
    throw new ORPCError('BAD_REQUEST', { message: 'اتصال تلگرام فعال نیست' })
  const { code, expiresAt } = await createLinkCode(context.user.id)
  return {
    code,
    expiresAt: expiresAt.toISOString(),
    deepLink: `https://t.me/${config.botUsername}?start=${code}`,
  }
})

export const unlinkMyTelegram = authed.handler(async ({ context }) => {
  await unlinkTelegram(context.user.id)
  return { ok: true }
})

export const sendTestMessage = authed.handler(async ({ context }) => {
  const config = await getTelegramConfig()
  if (!config?.enabled)
    throw new ORPCError('BAD_REQUEST', { message: 'اتصال تلگرام فعال نیست' })
  const { telegramLinks } = await import('#/db/schema')
  const [link] = await db
    .select()
    .from(telegramLinks)
    .where(eq(telegramLinks.userId, context.user.id))
    .limit(1)
  if (!link)
    throw new ORPCError('BAD_REQUEST', { message: 'ابتدا تلگرام را متصل کنید' })
  const result = await createTelegramNotifier(config.botToken).send(
    link.chatId,
    '🔔 پیام آزمایشی از پنل',
  )
  if (!result.ok)
    throw new ORPCError('BAD_GATEWAY', { message: 'ارسال پیام ناموفق بود' })
  return { ok: true }
})

// ── admin ────────────────────────────────────────────────────────────────

export const getTelegramAdmin = adminOnly.handler(async () => {
  const config = await getTelegramConfig()
  return {
    configured: Boolean(config),
    enabled: config?.enabled ?? false,
    botUsername: config?.botUsername ?? '',
    webhookUrl: `${getEnv().BETTER_AUTH_URL ?? ''}/api/telegram/webhook`,
  }
})

export const saveTelegramAdmin = adminOnly
  .input(
    z.object({
      botToken: z.string().trim().min(10).max(200).optional(),
      botUsername: z.string().trim().min(3).max(64),
      enabled: z.boolean(),
    }),
  )
  .handler(async ({ input, context }) => {
    try {
      await saveTelegramConfig(input)
    } catch {
      throw new ORPCError('BAD_REQUEST', { message: 'توکن ربات الزامی است' })
    }
    await writeAuditLog({
      actorUserId: context.user.id,
      actorRole: 'admin',
      action: 'telegram.config',
      entityType: 'settings',
      payload: {
        enabled: input.enabled,
        tokenChanged: Boolean(input.botToken),
      },
    })
    return { ok: true }
  })

/** Validate the token (getMe) and point Telegram at this panel. */
export const registerTelegramWebhook = adminOnly.handler(
  async ({ context }) => {
    const config = await getTelegramConfig()
    if (!config)
      throw new ORPCError('BAD_REQUEST', {
        message: 'ابتدا توکن را ذخیره کنید',
      })
    const base = getEnv().BETTER_AUTH_URL
    if (!base?.startsWith('https://')) {
      throw new ORPCError('BAD_REQUEST', {
        message:
          'تلگرام فقط آدرس HTTPS را می‌پذیرد؛ BETTER_AUTH_URL را بررسی کنید',
      })
    }
    const bot = createTelegramNotifier(config.botToken)
    const me = await bot.call('getMe', {})
    if (!me.ok)
      throw new ORPCError('BAD_REQUEST', { message: 'توکن ربات معتبر نیست' })
    const set = await bot.call('setWebhook', {
      url: `${base}/api/telegram/webhook`,
      secret_token: config.webhookSecret,
      allowed_updates: ['message'],
    })
    if (!set.ok)
      throw new ORPCError('BAD_GATEWAY', { message: 'ثبت وب‌هوک ناموفق بود' })
    await writeAuditLog({
      actorUserId: context.user.id,
      actorRole: 'admin',
      action: 'telegram.webhook',
      entityType: 'settings',
    })
    return {
      ok: true,
      username:
        (me.result as { username?: string } | undefined)?.username ?? null,
    }
  },
)

export const outboxStats = adminOnly.handler(async () => {
  const counts = await db
    .select({ status: notifications.status, c: sql<number>`count(*)` })
    .from(notifications)
    .groupBy(notifications.status)
  const failures = await db
    .select({
      id: notifications.id,
      event: notifications.event,
      lastError: notifications.lastError,
      attempts: notifications.attempts,
      status: notifications.status,
    })
    .from(notifications)
    .where(
      sql`${notifications.lastError} is not null and ${notifications.status} in ('queued','dead')`,
    )
    .orderBy(desc(notifications.createdAt))
    .limit(10)
  return {
    counts: Object.fromEntries(counts.map((r) => [r.status, Number(r.c)])),
    failures,
  }
})
