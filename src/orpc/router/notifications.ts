import { ORPCError } from '@orpc/server'
import { desc, eq, sql } from 'drizzle-orm'
import * as z from 'zod'

import { db } from '#/db'
import { notifications, telegramLinks, user } from '#/db/schema'
import { getEnv } from '#/lib/env'
import { writeAuditLog } from '#/lib/ledger'
import {
  createLinkCode,
  createTelegramNotifier,
  BOT_COMMANDS,
  getTelegramConfig,
  getPlatformTelegramBot,
  getResellerTelegramBot,
  listTelegramBots,
  saveTelegramBot,
  isLinked,
  saveTelegramConfig,
  unlinkTelegram,
} from '#/lib/notifications/telegram'
import { adminOnly, authed } from '../middleware'
import { outputSpec } from '../openapi-response'

export const telegramStatus = authed
  .route({
    summary: 'Get Telegram status',
    description:
      'Use this operation to get Telegram status under the caller’s current role and ownership rules.',
    tags: ['Notifications'],
    spec: outputSpec('notifications.telegramStatus'),
  })
  .handler(async ({ context }) => {
    const ownBot =
      context.user.role === 'reseller'
        ? await getResellerTelegramBot(context.user.id)
        : await getPlatformTelegramBot()
    const legacy =
      context.user.role === 'reseller' && !ownBot
        ? await getPlatformTelegramBot()
        : null
    const config = ownBot?.enabled
      ? ownBot
      : legacy?.enabled && legacy.legacyShared
        ? legacy
        : null
    const [link] = await db
      .select({ botId: telegramLinks.botId })
      .from(telegramLinks)
      .where(eq(telegramLinks.userId, context.user.id))
      .limit(1)
    return {
      available: Boolean(config),
      botUsername: config?.enabled ? config.botUsername : null,
      linked: await isLinked(context.user.id),
      role: context.user.role,
      botKind: config?.kind ?? null,
      configuredOwnBot: Boolean(ownBot),
      linkedBotId: link?.botId ?? null,
    }
  })

export const startTelegramLink = authed
  .route({
    summary: 'Start Telegram account link',
    description:
      'Use this operation to start Telegram account link under the caller’s current role and ownership rules.',
    tags: ['Notifications'],
    spec: outputSpec('notifications.startTelegramLink'),
  })
  .handler(async ({ context }) => {
    const ownBot =
      context.user.role === 'reseller'
        ? await getResellerTelegramBot(context.user.id)
        : await getPlatformTelegramBot()
    const legacy =
      context.user.role === 'reseller' && !ownBot
        ? await getPlatformTelegramBot()
        : null
    const config = ownBot?.enabled
      ? ownBot
      : legacy?.enabled && legacy.legacyShared
        ? legacy
        : null
    if (!config?.enabled)
      throw new ORPCError('BAD_REQUEST', { message: 'اتصال تلگرام فعال نیست' })
    const { code, expiresAt } = await createLinkCode(context.user.id, {
      botId: config.id,
    })
    return {
      code,
      expiresAt: expiresAt.toISOString(),
      deepLink: `https://t.me/${config.botUsername}?start=${code}`,
    }
  })

export const unlinkMyTelegram = authed
  .route({
    summary: 'Unlink my Telegram account',
    description:
      'Use this operation to unlink my Telegram account under the caller’s current role and ownership rules.',
    tags: ['Notifications'],
    spec: outputSpec('notifications.unlinkMyTelegram'),
  })
  .handler(async ({ context }) => {
    await unlinkTelegram(context.user.id)
    await writeAuditLog({
      actorUserId: context.user.id,
      actorRole: context.user.role === 'admin' ? 'admin' : 'reseller',
      action: 'telegram.unlink',
      entityType: 'telegram',
      entityId: context.user.id,
      resellerId: context.user.role === 'reseller' ? context.user.id : null,
      payload: { channel: 'panel' },
    })
    return { ok: true }
  })

export const sendTestMessage = authed
  .route({
    summary: 'Send Telegram test message',
    description:
      'Use this operation to send Telegram test message under the caller’s current role and ownership rules.',
    tags: ['Notifications'],
    spec: outputSpec('notifications.sendTestMessage'),
  })
  .handler(async ({ context }) => {
    const { telegramLinks } = await import('#/db/schema')
    const [link] = await db
      .select()
      .from(telegramLinks)
      .where(eq(telegramLinks.userId, context.user.id))
      .limit(1)
    if (!link)
      throw new ORPCError('BAD_REQUEST', {
        message: 'ابتدا تلگرام را متصل کنید',
      })
    const config = link.botId
      ? await (
          await import('#/lib/notifications/telegram')
        ).getBotById(link.botId)
      : await getTelegramConfig()
    if (!config?.enabled)
      throw new ORPCError('BAD_REQUEST', { message: 'اتصال تلگرام فعال نیست' })
    const result = await createTelegramNotifier(config.botToken).send(
      link.chatId,
      '🔔 پیام آزمایشی از پنل',
    )
    if (!result.ok)
      throw new ORPCError('BAD_GATEWAY', { message: 'ارسال پیام ناموفق بود' })
    return { ok: true }
  })

// ── admin ────────────────────────────────────────────────────────────────

export const getTelegramAdmin = adminOnly
  .route({
    summary: 'Get administrator Telegram settings',
    description:
      'Use this operation to get administrator Telegram settings under the caller’s current role and ownership rules.',
    tags: ['Notifications'],
    spec: outputSpec('notifications.getTelegramAdmin'),
  })
  .handler(async () => {
    const config = await getTelegramConfig()
    const webhookUrl = `${getEnv().BETTER_AUTH_URL ?? ''}/api/telegram/webhook`
    let webhook: {
      state:
        | 'unconfigured'
        | 'unreachable'
        | 'matching'
        | 'missing'
        | 'mismatch'
      urlMatches: boolean
      pendingUpdateCount: number | null
      lastErrorDate: number | null
      lastErrorMessage: string | null
    } = {
      state: 'unconfigured',
      urlMatches: false,
      pendingUpdateCount: null,
      lastErrorDate: null,
      lastErrorMessage: null,
    }
    if (config) {
      try {
        const result = await createTelegramNotifier(config.botToken).call(
          'getWebhookInfo',
          {},
        )
        if (result.ok && result.result && typeof result.result === 'object') {
          const info = result.result as {
            url?: string
            pending_update_count?: number
            last_error_date?: number
            last_error_message?: string
          }
          const urlMatches = info.url === webhookUrl
          webhook = {
            state: !info.url ? 'missing' : urlMatches ? 'matching' : 'mismatch',
            urlMatches,
            pendingUpdateCount: Number.isFinite(info.pending_update_count)
              ? info.pending_update_count!
              : 0,
            lastErrorDate: Number.isFinite(info.last_error_date)
              ? info.last_error_date!
              : null,
            lastErrorMessage:
              info.last_error_message
                ?.split(config.botToken)
                .join('***')
                .split(config.webhookSecret)
                .join('***') ?? null,
          }
        } else {
          webhook = { ...webhook, state: 'unreachable' }
        }
      } catch {
        webhook = { ...webhook, state: 'unreachable' }
      }
    }
    return {
      configured: Boolean(config),
      enabled: config?.enabled ?? false,
      botUsername: config?.botUsername ?? '',
      webhookUrl,
      webhook,
      bots: await listTelegramBots(),
    }
  })

export const saveTelegramAdmin = adminOnly
  .route({
    summary: 'Save administrator Telegram settings',
    description:
      'Use this operation to save administrator Telegram settings under the caller’s current role and ownership rules.',
    tags: ['Notifications'],
    spec: outputSpec('notifications.saveTelegramAdmin'),
  })
  .input(
    z.object({
      botToken: z.string().trim().min(10).max(200).optional(),
      botUsername: z.string().trim().min(3).max(64),
      enabled: z.boolean(),
    }),
  )
  .handler(async ({ input, context }) => {
    try {
      const token = input.botToken?.trim()
      if (token) {
        const me = await createTelegramNotifier(token).call('getMe', {})
        if (
          !me.ok ||
          !me.result ||
          typeof me.result !== 'object' ||
          !('username' in me.result)
        )
          throw new Error('Invalid token')
        input.botUsername = String((me.result as { username: string }).username)
      }
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

export const saveTelegramReseller = authed
  .route({
    summary: 'Save reseller Telegram bot',
    description:
      'Use this operation to save reseller Telegram bot under the caller’s current role and ownership rules.',
    tags: ['Notifications'],
    spec: outputSpec('notifications.saveTelegramReseller'),
  })
  .input(
    z.object({
      botToken: z.string().trim().min(10).max(200),
      enabled: z.boolean().default(true),
    }),
  )
  .handler(async ({ input, context }) => {
    if (context.user.role !== 'reseller') throw new ORPCError('FORBIDDEN')
    const base = getEnv().BETTER_AUTH_URL
    if (!base?.startsWith('https://'))
      throw new ORPCError('BAD_REQUEST', {
        message: 'BETTER_AUTH_URL باید HTTPS باشد',
      })
    const me = await createTelegramNotifier(input.botToken).call('getMe', {})
    if (
      !me.ok ||
      !me.result ||
      typeof me.result !== 'object' ||
      !('username' in me.result)
    )
      throw new ORPCError('BAD_REQUEST', { message: 'توکن ربات معتبر نیست' })
    const username = String((me.result as { username: string }).username)
    let saved
    try {
      saved = await saveTelegramBot({
        kind: 'reseller',
        ownerUserId: context.user.id,
        botToken: input.botToken,
        botUsername: username,
        enabled: input.enabled,
      })
    } catch {
      throw new ORPCError('CONFLICT', {
        message: 'این ربات قبلاً در یک حساب ثبت شده است',
      })
    }
    const set = await createTelegramNotifier(saved.botToken).call(
      'setWebhook',
      {
        url: `${base}/api/telegram/webhook`,
        secret_token: saved.webhookSecret,
        allowed_updates: ['message', 'callback_query'],
      },
    )
    if (!set.ok)
      throw new ORPCError('BAD_GATEWAY', { message: 'ثبت وب‌هوک ناموفق بود' })
    await createTelegramNotifier(saved.botToken)
      .call('setMyCommands', { commands: BOT_COMMANDS })
      .catch(() => {})
    await writeAuditLog({
      actorUserId: context.user.id,
      actorRole: 'reseller',
      action: 'telegram.reseller_bot_config',
      entityType: 'telegram',
      entityId: saved.id,
      resellerId: context.user.id,
      payload: { username, enabled: input.enabled },
    })
    return { ok: true, botUsername: username, enabled: saved.enabled }
  })

export const resellerTelegramBotStatus = authed
  .route({
    summary: 'Get reseller Telegram bot status',
    description:
      'Use this operation to get reseller Telegram bot status under the caller’s current role and ownership rules.',
    tags: ['Notifications'],
    spec: outputSpec('notifications.resellerTelegramBotStatus'),
  })
  .handler(async ({ context }) => {
    if (context.user.role !== 'reseller') throw new ORPCError('FORBIDDEN')
    const bot = await getResellerTelegramBot(context.user.id)
    if (!bot)
      return {
        configured: false,
        enabled: false,
        botUsername: null,
        webhook: {
          state: 'unconfigured' as const,
          urlMatches: false,
          pendingUpdateCount: null,
          lastErrorDate: null,
          lastErrorMessage: null,
        },
      }
    const base = getEnv().BETTER_AUTH_URL
    try {
      const result = await createTelegramNotifier(bot.botToken).call(
        'getWebhookInfo',
        {},
      )
      const info = result.result as
        | {
            url?: string
            pending_update_count?: number
            last_error_date?: number
            last_error_message?: string
          }
        | undefined
      const urlMatches = info?.url === `${base}/api/telegram/webhook`
      return {
        configured: true,
        enabled: bot.enabled,
        botUsername: bot.botUsername,
        webhook: {
          state: !result.ok
            ? ('unreachable' as const)
            : urlMatches
              ? ('matching' as const)
              : info?.url
                ? ('mismatch' as const)
                : ('missing' as const),
          urlMatches,
          pendingUpdateCount: Number.isFinite(info?.pending_update_count)
            ? info!.pending_update_count!
            : result.ok
              ? 0
              : null,
          lastErrorDate: Number.isFinite(info?.last_error_date)
            ? info!.last_error_date!
            : null,
          lastErrorMessage:
            info?.last_error_message
              ?.split(bot.botToken)
              .join('***')
              .split(bot.webhookSecret)
              .join('***') ?? null,
        },
      }
    } catch {
      return {
        configured: true,
        enabled: bot.enabled,
        botUsername: bot.botUsername,
        webhook: {
          state: 'unreachable' as const,
          urlMatches: false,
          pendingUpdateCount: null,
          lastErrorDate: null,
          lastErrorMessage: null,
        },
      }
    }
  })

/** Validate the token (getMe) and point Telegram at this panel. */
export const registerTelegramWebhook = adminOnly
  .route({
    summary: 'Register Telegram webhook',
    description:
      'Use this operation to register Telegram webhook under the caller’s current role and ownership rules.',
    tags: ['Notifications'],
    spec: outputSpec('notifications.registerTelegramWebhook'),
  })
  .handler(async ({ context }) => {
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
      allowed_updates: ['message', 'callback_query'],
    })
    if (!set.ok)
      throw new ORPCError('BAD_GATEWAY', { message: 'ثبت وب‌هوک ناموفق بود' })
    await bot.call('setMyCommands', { commands: BOT_COMMANDS }).catch(() => {})
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
  })

export const outboxStats = adminOnly
  .route({
    summary: 'Get notification outbox stats',
    description:
      'Use this operation to get notification outbox stats under the caller’s current role and ownership rules.',
    tags: ['Notifications'],
    spec: outputSpec('notifications.outboxStats'),
  })
  .handler(async () => {
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

export const telegramLinkedAccounts = adminOnly
  .route({
    summary: 'List linked Telegram accounts',
    description:
      'Use this operation to list linked Telegram accounts under the caller’s current role and ownership rules.',
    tags: ['Notifications'],
    spec: outputSpec('notifications.telegramLinkedAccounts'),
  })
  .handler(async () => {
    const rows = await db
      .select({
        userId: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        linkedAt: telegramLinks.linkedAt,
      })
      .from(telegramLinks)
      .innerJoin(user, eq(user.id, telegramLinks.userId))
      .orderBy(desc(telegramLinks.linkedAt))
      .limit(100)
    return rows.map((row) => ({ ...row, linkedAt: row.linkedAt.toISOString() }))
  })

export const adminUnlinkTelegram = adminOnly
  .route({
    summary: 'Unlink a Telegram account',
    description:
      'Use this operation to unlink a Telegram account under the caller’s current role and ownership rules.',
    tags: ['Notifications'],
    spec: outputSpec('notifications.adminUnlinkTelegram'),
  })
  .input(z.object({ userId: z.string().min(1).max(128) }))
  .handler(async ({ input, context }) => {
    const [target] = await db
      .select({ id: user.id, role: user.role })
      .from(telegramLinks)
      .innerJoin(user, eq(user.id, telegramLinks.userId))
      .where(eq(telegramLinks.userId, input.userId))
      .limit(1)
    if (!target)
      throw new ORPCError('NOT_FOUND', { message: 'اتصال تلگرام پیدا نشد' })
    await unlinkTelegram(target.id)
    await writeAuditLog({
      actorUserId: context.user.id,
      actorRole: 'admin',
      action: 'telegram.admin_unlink',
      entityType: 'telegram',
      entityId: target.id,
      resellerId: target.role === 'reseller' ? target.id : null,
      payload: { channel: 'panel' },
    })
    return { ok: true }
  })
