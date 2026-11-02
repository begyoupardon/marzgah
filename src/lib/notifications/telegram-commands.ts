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
  createTelegramNotifier,
  getLastTelegramCallback,
  auditBotAction,
  type TelegramBot,
} from './telegram'
import type { Db } from '#/db/types'
import { getEnv } from '#/lib/env'
import {
  USER_ACTIONS,
  backHome,
  billingScreen,
  confirmScreen,
  dashboardScreen,
  esc,
  mainMenu,
  renewalsScreen,
  resellersScreen,
  userCardScreen,
  userListScreen,
  walletScreen,
  type Keyboard,
  type Screen,
} from './telegram-ui'

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
    case '/help':
      return { help: true as const }
    case '/dashboard':
      return { read: { command: 'dashboard', input: {} } as CommandAction }
    case '/users':
      return {
        read: {
          command: 'users',
          input: { q: args.join(' ') || undefined, pageSize: 10 },
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
    '/diag — تشخیص مشکل دکمه‌ها و وب‌هوک',
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

type Reply = (text: string, keyboard?: Keyboard) => Promise<void>
type Ctx = { db: Db; send: Reply; now?: Date }

function renderRead(
  command: string,
  result: any,
  role: string,
  { username, paged = false }: { username?: string; paged?: boolean } = {},
): Screen {
  switch (command) {
    case 'dashboard':
      return dashboardScreen(result)
    case 'users': {
      if (!username) return userListScreen(result, paged)
      const row = (result?.items ?? []).find(
        (r: any) => r.marzbanUsername === username,
      )
      return row ? userCardScreen(row, role) : backHome('کاربر پیدا نشد.', [])
    }
    case 'wallet':
    case 'resellerWallet':
      return walletScreen(result)
    case 'billing':
      return billingScreen(result)
    case 'renewals':
      return renewalsScreen(result)
    case 'resellers':
      return resellersScreen(result)
    default:
      return backHome('انجام شد.')
  }
}

async function roleOf(actor: Actor, db: Db) {
  const [account] = await db
    .select({ role: user.role })
    .from(user)
    .where(eq(user.id, actor.userId))
    .limit(1)
  return account?.role ?? 'reseller'
}

const scope = (actor: Actor) => ({
  botId: actor.botId,
  actorUserId: actor.userId,
  chatId: actor.chatId,
})

async function showScreen(send: Reply, screen: Screen) {
  await send(screen.text, screen.keyboard)
}

async function askConfirmation(
  action: CommandAction,
  summary: string,
  actor: Actor,
  { db, send, now = new Date() }: Ctx,
) {
  const confirmation = await createTelegramConfirmation(
    {
      ...scope(actor),
      action: String(action.command),
      payload: { ...action, summary },
    },
    { db, now },
  )
  return showScreen(send, confirmScreen(summary, confirmation.token))
}

async function runConfirmation(
  token: string,
  actor: Actor,
  { db, send, now = new Date() }: Ctx,
) {
  const confirmation = await consumeTelegramConfirmation(token, scope(actor), {
    db,
    now,
  })
  if (!confirmation)
    return showScreen(send, backHome('⌛️ این تأیید منقضی یا نامعتبر است.'))
  const { command, input, summary } = confirmation.payload as {
    command: string
    input?: unknown
    summary?: string
  }
  await invoke({ command, input } as CommandAction, actor)
  return showScreen(
    send,
    backHome(`✅ <b>انجام شد</b>${summary ? `\n${esc(summary)}` : ''}`),
  )
}

/** Lets the owner see why buttons might be dead without shell access; repairs the one known cause. */
async function diagnose(bot: TelegramBot, send: Reply, now: Date) {
  const api = createTelegramNotifier(bot.botToken)
  const info = await api.call('getWebhookInfo', {})
  const hook = (info.result ?? {}) as {
    url?: string
    allowed_updates?: string[]
    pending_update_count?: number
    last_error_date?: number
    last_error_message?: string
  }
  const expected = `${(getEnv().BETTER_AUTH_URL ?? '').replace(/\/$/, '')}/api/telegram/webhook`
  const allowed = hook.allowed_updates
  const buttonsAllowed = !allowed || allowed.includes('callback_query')
  let repaired = false
  if (info.ok && hook.url === expected && !buttonsAllowed) {
    const set = await api.call('setWebhook', {
      url: expected,
      secret_token: bot.webhookSecret,
      allowed_updates: ['message', 'callback_query'],
    })
    repaired = set.ok
  }
  const tap = getLastTelegramCallback()
  const lines = [
    '🩺 <b>تشخیص ربات</b>',
    '',
    `وب‌هوک: ${hook.url === expected ? '✅ درست' : `❌ ${esc(hook.url || 'تنظیم نشده')}`}`,
    `دریافت دکمه‌ها (callback_query): ${buttonsAllowed ? '✅ مجاز' : repaired ? '🔧 غیرفعال بود و اصلاح شد؛ دوباره دکمه را بزنید' : '❌ غیرفعال'}`,
    `به‌روزرسانی‌های در صف: ${hook.pending_update_count ?? 0}`,
    hook.last_error_message
      ? `آخرین خطای تحویل: ${esc(hook.last_error_message)}`
      : 'آخرین خطای تحویل: —',
    tap
      ? `آخرین دکمه رسیده به سرور: <code>${esc(tap.data)}</code> (${Math.round((now.getTime() - tap.at.getTime()) / 1000)} ثانیه پیش)`
      : 'آخرین دکمه رسیده به سرور: هرگز (از آخرین راه‌اندازی)',
  ]
  return showScreen(send, backHome(lines.join('\n')))
}

export async function routeTelegramCommand(
  text: string,
  actor: Actor,
  bot: TelegramBot,
  { db, send, now = new Date() }: Ctx,
) {
  const [word, token] = words(text)
  if (word === '/unlink') {
    await auditBotAction(actor.userId, 'unlink', db)
    await unlinkTelegram(actor.userId, db)
    return send('اتصال تلگرام قطع شد.')
  }
  if (word === '/diag') return diagnose(bot, send, now)
  if (word === '/confirm' && token)
    return runConfirmation(token, actor, { db, send, now })
  if (word === '/cancel' && token) {
    await cancelTelegramConfirmation(token, scope(actor), db)
    return showScreen(send, backHome('درخواست لغو شد.'))
  }

  const role = await roleOf(actor, db)
  const parsed = parseAction(text, role)
  if (!parsed) return showScreen(send, mainMenu(role))
  if ('help' in parsed)
    return showScreen(
      send,
      backHome(esc(telegramMenu(role, bot.kind === 'reseller'))),
    )
  if ('read' in parsed && parsed.read) {
    const result = await invoke(parsed.read, actor)
    return showScreen(
      send,
      renderRead(String(parsed.read.command), result, role, {
        username: parsed.findUsername,
      }),
    )
  }
  if ('action' in parsed)
    return askConfirmation(parsed.action, parsed.summary, actor, {
      db,
      send,
      now,
    })
}

/** Button taps: navigation (m:/u:), user actions (a:), renewals (ra:/rr:), confirmations. */
export async function handleTelegramCallback(
  data: string,
  actor: Actor,
  { db, send, now = new Date() }: Ctx,
) {
  const ctx = { db, send, now }
  const [verb, ...rest] = data.split(':')
  const arg = rest.join(':')
  if (verb === 'noop') return
  if (verb === 'confirm' && arg) return runConfirmation(arg, actor, ctx)
  if (verb === 'cancel' && arg) {
    await cancelTelegramConfirmation(arg, scope(actor), db)
    return showScreen(send, backHome('✖️ درخواست لغو شد.'))
  }

  const role = await roleOf(actor, db)
  const read = async (
    command: string,
    input?: unknown,
    opts?: { username?: string; paged?: boolean },
  ) =>
    showScreen(
      send,
      renderRead(command, await invoke({ command, input }, actor), role, opts),
    )

  if (verb === 'm') {
    const [target, page] = arg.split(':')
    switch (target) {
      case 'home':
        return showScreen(send, mainMenu(role))
      case 'help':
        return showScreen(
          send,
          backHome(esc(telegramMenu(role, actor.botOwnerId !== null))),
        )
      case 'dash':
        return read('dashboard', {})
      case 'users':
        return read(
          'users',
          { page: Math.max(1, Number(page) || 1), pageSize: 10 },
          { paged: true },
        )
      case 'wallet':
        return role === 'admin'
          ? showScreen(
              send,
              backHome(
                'برای کیف پول نماینده از /wallet شناسه‌نماینده استفاده کنید.',
              ),
            )
          : read('wallet')
      case 'billing':
        return read('billing', { status: 'outstanding' })
      case 'renewals':
        return read('renewals')
      case 'resellers':
        return read('resellers')
    }
  }
  if (verb === 'u' && arg)
    return read('users', { q: arg, pageSize: 10 }, { username: arg })
  if (verb === 'a') {
    const [code, ...nameParts] = arg.split(':')
    const username = nameParts.join(':')
    const spec = USER_ACTIONS[code ?? '']
    if (!spec || !username || (spec.adminOnly && role !== 'admin'))
      return showScreen(send, backHome('درخواست نامعتبر است.'))
    return askConfirmation(
      { command: spec.command, input: { ...spec.input, username } },
      `${spec.label} ${username}`,
      actor,
      ctx,
    )
  }
  if ((verb === 'ra' || verb === 'rr') && arg)
    return askConfirmation(
      { command: verb === 'ra' ? 'approve' : 'reject', input: { id: arg } },
      `${verb === 'ra' ? 'تأیید' : 'رد'} درخواست تمدید`,
      actor,
      ctx,
    )
  return showScreen(send, backHome('درخواست نامعتبر است.'))
}
