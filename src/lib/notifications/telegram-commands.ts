import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'

import { router } from '#/orpc/router'
import { user } from '#/db/schema'
import type { AppContext } from '#/orpc/middleware'
import {
  cancelTelegramConfirmation,
  consumeTelegramConfirmation,
  createTelegramConfirmation,
  unlinkTelegram,
  auditBotAction,
  type TelegramBot,
} from './telegram'
import type { Db } from '#/db/types'

const GB = 1024 ** 3
const commandProcedures: Record<string, any> = {
  dashboard: router.dashboard,
  users: router.vpnUsers.list,
  create: router.vpnUsers.create,
  update: router.vpnUsers.update,
  renew: router.vpnUsers.renew,
  archive: router.vpnUsers.delete,
  reset: router.vpnUsers.resetUsage,
  revoke: router.vpnUsers.revokeSub,
  renewals: router.customers.renewals,
  approve: router.customers.approveRenewal,
  reject: router.customers.rejectRenewal,
  wallet: router.wallet.mine,
  resellerWallet: router.wallet.forReseller,
  billing: router.billing.list,
  settle: router.billing.settle,
  resellers: router.admin.listResellers,
  suspend: router.tools.suspendReseller,
  resume: router.tools.resumeReseller,
  adjust: router.wallet.adjust,
  balance: router.wallet.setBalance,
  limits: router.tools.setResellerLimits,
}

type Actor = NonNullable<AppContext['telegramActor']>
type CommandAction = {
  command: keyof typeof commandProcedures
  input?: unknown
}

function words(text: string) {
  return text.trim().split(/\s+/).filter(Boolean)
}

function numberArg(value: string | undefined, label: string) {
  const n = Number(value)
  if (!Number.isSafeInteger(n)) throw new Error(`${label} باید عدد صحیح باشد.`)
  return n
}

function parseAction(text: string, role: string) {
  const [raw, ...args] = words(text)
  const command = raw?.replace(/@\w+$/, '')
  if (!command || !command.startsWith('/')) return null
  const username = args[0]
  const days = () => {
    const value = numberArg(args[1], 'مدت')
    if (![30, 60, 90].includes(value))
      throw new Error('مدت باید ۳۰، ۶۰ یا ۹۰ روز باشد.')
    return value
  }
  const userInput = (target: string) => ({ username: target })
  switch (command) {
    case '/menu':
    case '/help':
      return { help: true as const }
    case '/dashboard':
      return { read: { command: 'dashboard', input: {} } as CommandAction }
    case '/users':
      return {
        read: {
          command: 'users',
          input: { q: args.join(' ') || undefined, pageSize: 20 },
        } as CommandAction,
      }
    case '/wallet':
      return role === 'admin'
        ? {
            read: {
              command: 'resellerWallet',
              input: { resellerId: args[0] ?? '' },
            } as CommandAction,
          }
        : { read: { command: 'wallet', input: undefined } as CommandAction }
    case '/billing':
      return {
        read: {
          command: 'billing',
          input: { status: args[0] ?? 'outstanding' },
        } as CommandAction,
      }
    case '/renewals':
      return {
        read: { command: 'renewals', input: undefined } as CommandAction,
      }
    case '/status':
      if (!username) throw new Error('روش استفاده: /status نام‌کاربری')
      return {
        read: {
          command: 'users',
          input: { q: username, pageSize: 10 },
        } as CommandAction,
        findUsername: username,
      }
    case '/create': {
      const admin = role === 'admin'
      const resellerId = admin ? args[0] : undefined
      const name = admin ? args[1] : args[0]
      const gb = numberArg(admin ? args[2] : args[1], 'حجم گیگابایت')
      const duration = numberArg(admin ? args[3] : args[2], 'مدت')
      if (!name || gb < 10 || ![30, 60, 90].includes(duration))
        throw new Error(
          admin
            ? 'روش استفاده: /create شناسه‌نماینده نام‌کاربری گیگابایت روز'
            : 'روش استفاده: /create نام‌کاربری گیگابایت روز',
        )
      return {
        action: {
          command: 'create',
          input: {
            ...(resellerId ? { resellerId } : {}),
            username: name,
            dataLimitBytes: gb * GB,
            durationDays: duration,
          },
        } as CommandAction,
        summary: `ساخت کاربر ${name} با ${gb} گیگابایت برای ${duration} روز`,
      }
    }
    case '/renew': {
      if (!username)
        throw new Error('روش استفاده: /renew نام‌کاربری روز حجم‌افزوده-Gb')
      const durationDays = days()
      const additionalGb = numberArg(args[2], 'حجم افزوده')
      if (additionalGb < 10)
        throw new Error('حجم افزوده باید حداقل ۱۰ گیگابایت باشد.')
      return {
        action: {
          command: 'renew',
          input: {
            username,
            durationDays,
            additionalDataLimitBytes: additionalGb * GB,
            reactivate: true,
          },
        } as CommandAction,
        summary: `تمدید ${username} برای ${durationDays} روز و افزودن ${additionalGb} گیگابایت`,
      }
    }
    case '/disable':
    case '/enable':
      if (!username) throw new Error(`روش استفاده: ${command} نام‌کاربری`)
      return {
        action: {
          command: 'update',
          input: {
            ...userInput(username),
            status: command === '/disable' ? 'disabled' : 'active',
          },
        } as CommandAction,
        summary: `${command === '/disable' ? 'غیرفعال‌کردن' : 'فعال‌کردن'} ${username}`,
      }
    case '/archive':
      if (!username) throw new Error('روش استفاده: /archive نام‌کاربری')
      return {
        action: {
          command: 'archive',
          input: userInput(username),
        } as CommandAction,
        summary: `آرشیو و غیرفعال‌کردن ${username}`,
      }
    case '/reset':
      if (!username) throw new Error('روش استفاده: /reset نام‌کاربری')
      return {
        action: {
          command: 'reset',
          input: userInput(username),
        } as CommandAction,
        summary: `صفرکردن مصرف ${username}`,
      }
    case '/revoke':
      if (!username) throw new Error('روش استفاده: /revoke نام‌کاربری')
      return {
        action: {
          command: 'revoke',
          input: userInput(username),
        } as CommandAction,
        summary: `باطل‌کردن لینک اشتراک ${username}`,
      }
    case '/approve':
    case '/reject':
      if (!username) throw new Error(`روش استفاده: ${command} شناسه‌درخواست`)
      return {
        action: {
          command: command === '/approve' ? 'approve' : 'reject',
          input: { id: username },
        } as CommandAction,
        summary: `${command === '/approve' ? 'تأیید' : 'رد'} درخواست تمدید ${username}`,
      }
    case '/settle':
      if (!username) throw new Error('روش استفاده: /settle شناسه‌ردیف‌مالی')
      return {
        action: {
          command: 'settle',
          input: { eventId: username },
        } as CommandAction,
        summary: `تسویه ردیف مالی ${username}`,
      }
    case '/resellers':
      return {
        read: { command: 'resellers', input: undefined } as CommandAction,
      }
    case '/suspend':
    case '/resume':
      if (!username) throw new Error(`روش استفاده: ${command} شناسه‌نماینده`)
      return {
        action: {
          command: command === '/suspend' ? 'suspend' : 'resume',
          input: { resellerId: username },
        } as CommandAction,
        summary: `${command === '/suspend' ? 'تعلیق' : 'فعال‌سازی مجدد'} نماینده ${username}`,
      }
    case '/adjust': {
      if (!args[0] || !args[1] || !args[2] || !args.slice(3).length)
        throw new Error(
          'روش استفاده: /adjust شناسه‌نماینده credit|debit مبلغ دلیل',
        )
      if (!['credit', 'debit'].includes(args[1]!))
        throw new Error('نوع باید credit یا debit باشد.')
      const amountToman = numberArg(args[2], 'مبلغ')
      return {
        action: {
          command: 'adjust',
          input: {
            resellerId: args[0],
            type: args[1],
            amountToman,
            reason: args.slice(3).join(' '),
          },
        } as CommandAction,
        summary: `${args[1] === 'credit' ? 'افزایش' : 'کاهش'} کیف پول ${args[0]} به میزان ${amountToman} تومان`,
      }
    }
    case '/balance': {
      if (!args[0] || args[1] === undefined)
        throw new Error('روش استفاده: /balance شناسه‌نماینده موجودی‌هدف-تومان')
      const targetBalanceToman = numberArg(args[1], 'موجودی')
      return {
        action: {
          command: 'balance',
          input: {
            resellerId: args[0],
            targetBalanceToman,
            reason: 'Telegram admin action',
          },
        } as CommandAction,
        summary: `تنظیم موجودی نماینده ${args[0]} روی ${targetBalanceToman} تومان`,
      }
    }
    case '/limits': {
      if (!args[0] || args[1] === undefined || args[2] === undefined)
        throw new Error(
          'روش استفاده: /limits شناسه‌نماینده حداکثرکاربران حداکثرگیگابایت',
        )
      return {
        action: {
          command: 'limits',
          input: {
            resellerId: args[0],
            maxUsers:
              args[1] === 'none' ? null : numberArg(args[1], 'حداکثرکاربران'),
            maxTotalGb:
              args[2] === 'none' ? null : numberArg(args[2], 'حداکثرگیگابایت'),
          },
        } as CommandAction,
        summary: `تغییر سقف‌های نماینده ${args[0]}`,
      }
    }
    default:
      return null
  }
}

export const telegramMenu = (role: string, ownBot: boolean) =>
  [
    'دستورهای ربات:',
    '/dashboard — خلاصه پنل',
    '/users [جستجو] — فهرست کاربران',
    '/status نام‌کاربری — وضعیت کاربر',
    '/wallet — کیف پول',
    '/billing — گزارش مالی',
    '/renewals — درخواست‌های تمدید',
    '/create نام‌کاربری گیگابایت روز — ساخت کاربر',
    '/renew نام‌کاربری روز حجم‌افزوده — تمدید',
    '/disable|/enable نام‌کاربری — فعال یا غیرفعال‌کردن',
    '/reset نام‌کاربری — صفرکردن مصرف',
    '/revoke نام‌کاربری — باطل‌کردن لینک اشتراک',
    ...(role === 'admin'
      ? [
          '/archive نام‌کاربری — آرشیو کاربر',
          '/resellers — فهرست نمایندگان',
          '/suspend|/resume شناسه‌نماینده — مدیریت نماینده',
          '/settle شناسه‌مالی — تسویه',
          '/adjust شناسه credit|debit مبلغ دلیل — اصلاح کیف پول',
          '/balance شناسه موجودی — تنظیم موجودی',
          '/limits شناسه تعداد گیگ — تنظیم سقف‌ها',
        ]
      : []),
    '/approve|/reject شناسه‌درخواست — تصمیم تمدید',
    '/unlink — قطع اتصال تلگرام',
    ownBot ? 'این ربات به حساب شما متصل است.' : '',
  ]
    .filter(Boolean)
    .join('\n')

async function invoke(action: CommandAction, actor: Actor) {
  const procedure = commandProcedures[action.command]
  if (!procedure) throw new Error('این عملیات در ربات فعال نیست.')
  return call(procedure, action.input, {
    context: { headers: new Headers(), telegramActor: actor },
  })
}

function summarize(action: string, result: any, requestedUsername?: string) {
  if (action === 'users' || action === 'status') {
    const rows = result?.items ?? []
    const matched = requestedUsername
      ? rows.filter((row: any) => row.marzbanUsername === requestedUsername)
      : rows
    if (requestedUsername && !matched.length) return 'کاربر پیدا نشد.'
    return (
      matched
        .slice(0, 10)
        .map(
          (row: any) =>
            `• ${row.marzbanUsername} — ${row.status} — ${Math.round(row.usedTrafficBytes / GB)} / ${row.dataLimitBytes === null ? '∞' : Math.round(row.dataLimitBytes / GB)} GB`,
        )
        .join('\n') || 'کاربری پیدا نشد.'
    )
  }
  if (action === 'dashboard') {
    const stats = result?.stats
    return stats
      ? `کاربران: ${stats.totalUsers} · فعال: ${stats.activeUsers} · منقضی: ${stats.expiredUsers}\nمصرف: ${Math.round(stats.usedTrafficBytes / GB)} GB`
      : 'خلاصه دریافت شد.'
  }
  if (action === 'wallet' || action === 'resellerWallet')
    return `موجودی: ${Number(result?.balanceToman ?? 0).toLocaleString('fa-IR')} تومان`
  if (action === 'renewals')
    return (
      (result ?? [])
        .slice(0, 10)
        .map((row: any) => `• ${row.username} · ${row.status}`)
        .join('\n') || 'درخواستی نیست.'
    )
  if (action === 'resellers')
    return (
      (result ?? [])
        .slice(0, 20)
        .map((row: any) => `• ${row.name} · ${row.id} · ${row.status}`)
        .join('\n') || 'نماینده‌ای نیست.'
    )
  if (action === 'billing')
    return (
      (Array.isArray(result) ? result : (result?.items ?? []))
        .slice(0, 10)
        .map(
          (row: any) =>
            `• ${row.username} · ${Number(row.amountToman).toLocaleString('fa-IR')} تومان · ${row.settledAt ? 'تسویه' : 'بدهکار'}`,
        )
        .join('\n') || 'ردیف مالی نیست.'
    )
  return 'انجام شد.'
}

export async function executeTelegramAction(
  action: CommandAction,
  actor: Actor,
  requestedUsername?: string,
) {
  const result = await invoke(action, actor)
  return summarize(String(action.command), result, requestedUsername)
}

export async function routeTelegramCommand(
  text: string,
  actor: Actor,
  bot: TelegramBot,
  {
    db,
    send,
    now = new Date(),
  }: {
    db: Db
    send: (
      text: string,
      buttons?: Array<{ text: string; data: string }>,
    ) => Promise<void>
    now?: Date
  },
) {
  const [word, token] = words(text)
  if (word === '/unlink') {
    await auditBotAction(actor.userId, 'unlink', db)
    await unlinkTelegram(actor.userId, db)
    return send('اتصال تلگرام قطع شد.')
  }
  if (word === '/confirm' && token) {
    const confirmation = await consumeTelegramConfirmation(
      token,
      { botId: actor.botId, actorUserId: actor.userId, chatId: actor.chatId },
      { db, now },
    )
    if (!confirmation) return send('این تأیید منقضی یا نامعتبر است.')
    const payload = confirmation.payload as { command: string; input?: unknown }
    const result = await executeTelegramAction(
      { command: payload.command, input: payload.input } as CommandAction,
      actor,
    )
    return send(`✅ انجام شد\n${result}`)
  }
  if (word === '/cancel' && token) {
    await cancelTelegramConfirmation(
      token,
      { botId: actor.botId, actorUserId: actor.userId, chatId: actor.chatId },
      db,
    )
    return send('درخواست لغو شد.')
  }

  const [account] = await db
    .select({ role: user.role })
    .from(user)
    .where(eq(user.id, actor.userId))
    .limit(1)
  const role = account?.role ?? 'reseller'
  const parsed = parseAction(text, role)
  if (!parsed) return send(telegramMenu(role, bot.kind === 'reseller'))
  if ('help' in parsed) {
    return send(telegramMenu(role, bot.kind === 'reseller'))
  }
  if ('read' in parsed && parsed.read) {
    const result = await invoke(parsed.read, actor)
    return send(
      summarize(String(parsed.read.command), result, parsed.findUsername),
    )
  }
  if ('action' in parsed) {
    const confirmation = await createTelegramConfirmation(
      {
        botId: actor.botId,
        actorUserId: actor.userId,
        chatId: actor.chatId,
        action: String(parsed.action.command),
        payload: parsed.action,
      },
      { db, now },
    )
    return send(
      `تأیید کنید: ${parsed.summary}\nاین درخواست ۵ دقیقه اعتبار دارد.`,
      [
        { text: 'تأیید', data: `confirm:${confirmation.token}` },
        { text: 'لغو', data: `cancel:${confirmation.token}` },
      ],
    )
  }
}

export async function handleTelegramCallback(
  data: string,
  actor: Actor,
  { db, send, now = new Date() }: Parameters<typeof routeTelegramCommand>[3],
) {
  const [verb, token] = data.split(':')
  if (!token || !['confirm', 'cancel'].includes(verb ?? ''))
    return send('درخواست نامعتبر است.')
  if (verb === 'cancel') {
    await cancelTelegramConfirmation(
      token,
      { botId: actor.botId, actorUserId: actor.userId, chatId: actor.chatId },
      db,
    )
    return send('درخواست لغو شد.')
  }
  const confirmation = await consumeTelegramConfirmation(
    token,
    { botId: actor.botId, actorUserId: actor.userId, chatId: actor.chatId },
    { db, now },
  )
  if (!confirmation) return send('این تأیید منقضی یا نامعتبر است.')
  const payload = confirmation.payload as { command: string; input?: unknown }
  const result = await executeTelegramAction(
    { command: payload.command, input: payload.input } as CommandAction,
    actor,
  )
  return send(`✅ انجام شد\n${result}`)
}
