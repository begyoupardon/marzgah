import { call } from '@orpc/server'
import { eq, and } from 'drizzle-orm'

import { router } from '#/orpc/router'
import { user, telegramLinks } from '#/db/schema'
import { tl, type TelegramLocale } from './telegram-locale'
import type { AppContext } from '#/orpc/middleware'
import {
  cancelTelegramConfirmation,
  clearFlow,
  consumeTelegramConfirmation,
  createTelegramConfirmation,
  loadFlow,
  saveFlow,
  unlinkTelegram,
  createTelegramNotifier,
  getLastTelegramCallback,
  auditBotAction,
  type TelegramBot,
} from './telegram'
import type { Db } from '#/db/types'
import { getEnv } from '#/lib/env'
import { gbToBytes, MIN_DATA_LIMIT_GB } from '#/lib/vpn-plans'
import {
  USER_ACTIONS,
  LIST_VIEWS,
  askScreen,
  backHome,
  billingScreen,
  confirmScreen,
  dashboardScreen,
  esc,
  mainMenu,
  renewalsScreen,
  resellerCardScreen,
  resellersScreen,
  subscriptionScreen,
  userCardScreen,
  userListScreen,
  walletScreen,
  type Keyboard,
  type Screen,
} from './telegram-ui'
import {
  advanceFlow,
  beginFlow,
  currentAsk,
  type Advance,
  type FlowCtx,
} from './telegram-flows'

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
  contact: router.tools.updateContact,
  claimPaid: router.billing.claimPaid,
  createLink: router.customers.createLink,
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

function gbArg(value: string | undefined, label: string, allowZero = false) {
  const gb = Number(value)
  if (
    !value?.trim() ||
    !Number.isFinite(gb) ||
    gb > 10_000 ||
    (gb < MIN_DATA_LIMIT_GB && !(allowZero && gb === 0))
  )
    throw new Error(`${label} باید ۰٫۱ تا ۱۰٬۰۰۰ گیگابایت باشد.`)
  return gb
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
          input: { status: args[0] ?? 'all' },
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
      const gb = gbArg(admin ? args[2] : args[1], 'حجم گیگابایت')
      const duration = numberArg(admin ? args[3] : args[2], 'مدت')
      if (!name || ![30, 60, 90].includes(duration))
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
            dataLimitBytes: gbToBytes(gb),
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
      const additionalGb = gbArg(args[2], 'حجم افزوده', true)
      return {
        action: {
          command: 'renew',
          input: {
            username,
            durationDays,
            ...(additionalGb > 0
              ? { additionalDataLimitBytes: gbToBytes(additionalGb) }
              : {}),
            reactivate: true,
          },
        } as CommandAction,
        summary: `تمدید ${username} برای ${durationDays} روز${additionalGb > 0 ? ` و افزودن ${additionalGb} گیگابایت` : ' بدون افزودن حجم'}`,
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

export const telegramMenu = (
  role: string,
  ownBot: boolean,
  locale: TelegramLocale = 'fa',
) =>
  locale === 'en'
    ? [
        'Bot commands:',
        '/dashboard — Panel overview',
        '/users [search] — List users',
        '/status username — User status',
        '/wallet — Wallet',
        '/billing — Billing',
        '/renewals — Renewal requests',
        '/create username GB days — Create user',
        '/renew username days extra-GB — Renew user',
        '/disable|/enable username — Change status',
        '/reset username — Reset usage',
        '/revoke username — Revoke subscription',
        ...(role === 'admin'
          ? [
              '/archive username — Archive user',
              '/resellers — List resellers',
              '/suspend|/resume reseller-id — Manage reseller',
              '/settle billing-id — Settle billing',
              '/adjust id credit|debit amount reason — Adjust wallet',
              '/balance id amount — Set balance',
              '/limits id users GB — Set limits',
            ]
          : []),
        '/approve|/reject request-id — Decide renewal',
        '/diag — Diagnose buttons and webhook',
        '/language — Change language',
        '/cancel — Cancel current operation',
        '/unlink — Disconnect Telegram',
        ownBot ? 'This bot is connected to your account.' : '',
      ]
        .filter(Boolean)
        .join('\n')
    : [
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
        '/language — تغییر زبان',
        '/cancel — انصراف از عملیات جاری',
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
type ReadOptions = {
  username?: string
  view?: string
  query?: string
  page?: number
}

function renderRead(
  command: string,
  result: any,
  role: string,
  o: ReadOptions = {},
  locale: TelegramLocale = 'fa',
): Screen {
  switch (command) {
    case 'dashboard':
      return dashboardScreen(result, locale)
    case 'users': {
      if (!o.username)
        return userListScreen(result, { view: o.view, query: o.query }, locale)
      const row = (result?.items ?? []).find(
        (r: any) => r.marzbanUsername === o.username,
      )
      return row
        ? userCardScreen(row, role, new Date(), locale)
        : backHome(tl(locale, 'کاربر پیدا نشد.', 'User not found.'), [], locale)
    }
    case 'wallet':
    case 'resellerWallet':
      return walletScreen(result, locale)
    case 'billing':
      return billingScreen(Array.isArray(result) ? result : [], role, locale)
    case 'renewals':
      return renewalsScreen(result ?? [], locale)
    case 'resellers':
      return resellersScreen(result ?? [], o.page, locale)
    default:
      return backHome(tl(locale, 'انجام شد.', 'Done.'), [], locale)
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

const flowCtx = (actor: Actor, role: string): FlowCtx => ({
  role,
  locale: actor.locale ?? 'fa',
  invoke: (command, input) => invoke({ command, input }, actor),
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
  if (actor.locale === 'en') summary = englishActionSummary(action)
  const confirmation = await createTelegramConfirmation(
    {
      ...scope(actor),
      action: String(action.command),
      payload: { ...action, summary },
    },
    { db, now },
  )
  return showScreen(
    send,
    confirmScreen(summary, confirmation.token, actor.locale),
  )
}

function englishActionSummary(action: CommandAction) {
  const input = (action.input ?? {}) as Record<string, any>
  const target =
    input.username ?? input.resellerId ?? input.id ?? input.eventId ?? ''
  const names: Record<string, string> = {
    create: 'Create user',
    update: 'Update user',
    renew: 'Renew user',
    archive: 'Archive user',
    reset: 'Reset usage for',
    revoke: 'Revoke subscription for',
    createLink: 'Create customer link for',
    approve: 'Approve renewal',
    reject: 'Reject renewal',
    settle: 'Settle billing row',
    claimPaid: 'Mark payment for',
    suspend: 'Suspend reseller',
    resume: 'Resume reseller',
    adjust: 'Adjust reseller credit',
    balance: 'Set reseller balance',
    limits: 'Update reseller limits',
    contact: 'Update contact for',
  }
  return `${names[action.command] ?? 'Apply action'} ${target}`.trim()
}

/** What the user sees once a confirmed action has run. */
function renderResult(
  command: string,
  input: any,
  result: any,
  summary: string | undefined,
  role: string,
  locale: TelegramLocale = 'fa',
): Screen {
  if (command === 'create' && result?.marzbanUsername) {
    const card = userCardScreen(result, role, new Date(), locale)
    const link = result.subscriptionUrl
      ? `\n\n${tl(locale, '📋 لینک اشتراک:', '📋 Subscription link:')}\n<code>${esc(result.subscriptionUrl)}</code>`
      : ''
    return {
      ...card,
      text: `✅ <b>${tl(locale, 'کاربر ساخته شد', 'User created')}</b>\n\n${card.text}${link}`,
    }
  }
  const username = input?.username as string | undefined
  if (command === 'createLink' && result?.url)
    return backHome(
      `🌐 <b>${tl(locale, 'صفحه مشتری', 'Customer page')} ${esc(username)}</b>\n<code>${esc(result.url)}</code>\n\n${tl(locale, 'لینک قبلی باطل شد. این لینک را برای مشتری بفرستید.', 'The previous link was revoked. Send this link to the customer.')}`,
      [
        username
          ? {
              text: tl(locale, '👤 مشاهده کاربر', '👤 View user'),
              data: `u:${username}`,
            }
          : null,
      ].filter(Boolean) as any,
      locale,
    )
  const target = username
    ? {
        text: tl(locale, '👤 مشاهده کاربر', '👤 View user'),
        data: `u:${username}`,
      }
    : input?.resellerId
      ? {
          text: tl(locale, '🏪 مشاهده نماینده', '🏪 View reseller'),
          data: `r:${input.resellerId}`,
        }
      : null
  return backHome(
    `✅ <b>${tl(locale, 'انجام شد', 'Done')}</b>${summary ? `\n${esc(summary)}` : ''}`,
    target ? [target] : [],
    locale,
  )
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
    return showScreen(
      send,
      backHome(
        tl(
          actor.locale ?? 'fa',
          '⌛️ این تأیید منقضی یا نامعتبر است.',
          '⌛️ This confirmation is expired or invalid.',
        ),
        [],
        actor.locale,
      ),
    )
  const { command, input, summary } = confirmation.payload as {
    command: string
    input?: unknown
    summary?: string
  }
  const result = await invoke({ command, input } as CommandAction, actor)
  const role = await roleOf(actor, db)
  const displaySummary =
    actor.locale === 'en' ? englishActionSummary({ command, input }) : summary
  return showScreen(
    send,
    renderResult(command, input, result, displaySummary, role, actor.locale),
  )
}

/** Persist the flow's position and show the next question, retry, or confirmation. */
async function applyAdvance(
  name: string,
  advance: Advance | null,
  actor: Actor,
  role: string,
  ctx: Ctx,
) {
  const { db, send, now = new Date() } = ctx
  if (!advance)
    return showScreen(
      send,
      backHome(
        tl(actor.locale ?? 'fa', 'درخواست نامعتبر است.', 'Invalid request.'),
        [],
        actor.locale,
      ),
    )
  if (advance.kind === 'retry')
    return showScreen(
      send,
      askScreen(
        `⚠️ ${esc(advance.message)}\n\n${advance.ask.text}`,
        advance.ask.choices,
        actor.locale,
      ),
    )
  if (advance.kind === 'ask') {
    await saveFlow(
      scope(actor),
      { flow: name, stepIndex: advance.stepIndex, data: advance.data },
      { db, now },
    )
    return showScreen(
      send,
      askScreen(advance.ask.text, advance.ask.choices, actor.locale),
    )
  }
  await clearFlow(scope(actor), db)
  const done = advance.done
  if (done.kind === 'read') {
    const result = await invoke(
      { command: done.command, input: done.input },
      actor,
    )
    return showScreen(
      send,
      renderRead(
        done.command,
        result,
        role,
        { query: done.query },
        actor.locale,
      ),
    )
  }
  return askConfirmation(
    { command: done.command, input: done.input },
    done.summary,
    actor,
    ctx,
  )
}

async function startFlow(
  name: string,
  arg: string | undefined,
  actor: Actor,
  role: string,
  ctx: Ctx,
) {
  const adminOnly = ['adjust', 'balance', 'limits']
  if (adminOnly.includes(name) && role !== 'admin')
    return showScreen(
      ctx.send,
      backHome(
        tl(actor.locale ?? 'fa', 'این بخش فقط برای مدیر است.', 'Admins only.'),
        [],
        actor.locale,
      ),
    )
  return applyAdvance(
    name,
    await beginFlow(name, arg, flowCtx(actor, role)),
    actor,
    role,
    ctx,
  )
}

/** A typed answer or a button tap inside a running flow. */
async function continueFlow(
  raw: string | { index: number },
  actor: Actor,
  role: string,
  ctx: Ctx,
) {
  const state = await loadFlow(scope(actor), { db: ctx.db, now: ctx.now })
  if (!state)
    return showScreen(
      ctx.send,
      backHome(
        tl(
          actor.locale ?? 'fa',
          '⌛️ این مرحله منقضی شده است. دوباره از منو شروع کنید.',
          '⌛️ This step expired. Start again from the menu.',
        ),
        [],
        actor.locale,
      ),
    )
  const fc = flowCtx(actor, role)
  let answer: string
  if (typeof raw === 'string') answer = raw
  else {
    const ask = await currentAsk(state.flow, state.stepIndex, state.data, fc)
    const choice = ask?.choices?.[raw.index]
    if (!choice)
      return showScreen(
        ctx.send,
        backHome(
          tl(
            actor.locale ?? 'fa',
            'این گزینه دیگر معتبر نیست.',
            'This option is no longer valid.',
          ),
          [],
          actor.locale,
        ),
      )
    answer = choice.value
  }
  return applyAdvance(
    state.flow,
    await advanceFlow(state.flow, state.stepIndex, state.data, answer, fc),
    actor,
    role,
    ctx,
  )
}

/** Lets the owner see why buttons might be dead without shell access; repairs the one known cause. */
async function diagnose(
  bot: TelegramBot,
  send: Reply,
  now: Date,
  locale: TelegramLocale = 'fa',
) {
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
  if (locale === 'en') {
    const translated = [
      '🩺 <b>Bot diagnostics</b>',
      '',
      `Webhook: ${hook.url === expected ? '✅ Correct' : `❌ ${esc(hook.url || 'Not set')}`}`,
      `Buttons (callback_query): ${buttonsAllowed ? '✅ Enabled' : repaired ? '🔧 Repaired; tap the button again' : '❌ Disabled'}`,
      `Pending updates: ${hook.pending_update_count ?? 0}`,
      hook.last_error_message
        ? `Last delivery error: ${esc(hook.last_error_message)}`
        : 'Last delivery error: —',
      tap
        ? `Last button received: <code>${esc(tap.data)}</code> (${Math.round((now.getTime() - tap.at.getTime()) / 1000)} seconds ago)`
        : 'Last button received: Never since restart',
    ]
    return showScreen(send, backHome(translated.join('\n'), [], locale))
  }
  return showScreen(send, backHome(lines.join('\n')))
}

export async function routeTelegramCommand(
  text: string,
  actor: Actor,
  bot: TelegramBot,
  { db, send, now = new Date() }: Ctx,
) {
  const [word, token] = words(text)
  const ctx = { db, send, now }
  const locale = actor.locale ?? 'fa'
  const languageScreen = (): Screen => ({
    text: tl(
      locale,
      '🌐 <b>زبان ربات</b>\nزبان دلخواه را انتخاب کنید:',
      '🌐 <b>Bot language</b>\nChoose your language:',
    ),
    keyboard: [
      [
        { text: 'فارسی', data: 'lang:fa' },
        { text: 'English', data: 'lang:en' },
      ],
      [{ text: tl(locale, '🏠 منوی اصلی', '🏠 Main menu'), data: 'm:home' }],
    ],
  })
  if (word === '/language') return showScreen(send, languageScreen())
  if (word === '/unlink') {
    await auditBotAction(actor.userId, 'unlink', db)
    await clearFlow(scope(actor), db)
    await unlinkTelegram(actor.userId, db)
    return send(tl(locale, 'اتصال تلگرام قطع شد.', 'Telegram disconnected.'))
  }
  if (word === '/diag') return diagnose(bot, send, now, locale)
  if (word === '/confirm' && token) return runConfirmation(token, actor, ctx)
  if (word === '/cancel') {
    if (token) await cancelTelegramConfirmation(token, scope(actor), db)
    await clearFlow(scope(actor), db)
    return showScreen(
      send,
      backHome(
        tl(locale, '✖️ عملیات لغو شد.', '✖️ Operation cancelled.'),
        [],
        locale,
      ),
    )
  }

  const role = await roleOf(actor, db)
  // Plain text mid-flow is the answer to the current question; a command abandons the flow.
  if (word && !word.startsWith('/')) {
    if (await loadFlow(scope(actor), { db, now }))
      return continueFlow(text, actor, role, ctx)
  } else if (word) {
    await clearFlow(scope(actor), db)
  }
  const parsed = parseAction(text, role)
  if (!parsed) return showScreen(send, mainMenu(role, locale))
  if ('help' in parsed)
    return showScreen(
      send,
      backHome(
        esc(telegramMenu(role, bot.kind === 'reseller', locale)),
        [],
        locale,
      ),
    )
  if ('read' in parsed && parsed.read) {
    const result = await invoke(parsed.read, actor)
    const input = parsed.read.input as { q?: string } | undefined
    return showScreen(
      send,
      renderRead(
        String(parsed.read.command),
        result,
        role,
        {
          username: parsed.findUsername,
          query: parsed.findUsername ? undefined : input?.q,
        },
        locale,
      ),
    )
  }
  if ('action' in parsed)
    return askConfirmation(parsed.action, parsed.summary, actor, ctx)
}

/** Button taps. Prefixes: m menu · l lists · u card · s link · n flow · f answer · a/x/ra/rr/bs/bc actions. */
export async function handleTelegramCallback(
  data: string,
  actor: Actor,
  { db, send, now = new Date() }: Ctx,
) {
  const ctx = { db, send, now }
  const locale = actor.locale ?? 'fa'
  const [verb, ...rest] = data.split(':')
  const arg = rest.join(':')
  if (verb === 'lang' && (arg === 'fa' || arg === 'en')) {
    await db
      .update(telegramLinks)
      .set({ locale: arg })
      .where(
        and(
          eq(telegramLinks.userId, actor.userId),
          eq(telegramLinks.chatId, actor.chatId),
          eq(telegramLinks.botId, actor.botId),
        ),
      )
    await clearFlow(scope(actor), db)
    await auditBotAction(actor.userId, `language/${arg}`, db)
    return showScreen(send, mainMenu(await roleOf(actor, db), arg))
  }
  if (verb === 'noop') return
  if (verb === 'confirm' && arg) return runConfirmation(arg, actor, ctx)
  if (verb === 'cancel' && arg) {
    await cancelTelegramConfirmation(arg, scope(actor), db)
    return showScreen(
      send,
      backHome(
        tl(locale, '✖️ درخواست لغو شد.', '✖️ Request cancelled.'),
        [],
        locale,
      ),
    )
  }

  const role = await roleOf(actor, db)
  const read = async (command: string, input?: unknown, opts?: ReadOptions) =>
    showScreen(
      send,
      renderRead(
        command,
        await invoke({ command, input }, actor),
        role,
        opts,
        locale,
      ),
    )
  const owned = async (username: string) => {
    const result = (await invoke(
      { command: 'users', input: { q: username, pageSize: 10 } },
      actor,
    )) as any
    return (result?.items ?? []).find(
      (r: any) => r.marzbanUsername === username,
    )
  }

  if (verb === 'f') {
    if (arg === 'x') {
      await clearFlow(scope(actor), db)
      return showScreen(
        send,
        backHome(
          tl(locale, '✖️ عملیات لغو شد.', '✖️ Operation cancelled.'),
          [],
          locale,
        ),
      )
    }
    return continueFlow({ index: Number(arg) }, actor, role, ctx)
  }
  if (verb === 'n') {
    const [name, ...argParts] = arg.split(':')
    return startFlow(
      name ?? '',
      argParts.join(':') || undefined,
      actor,
      role,
      ctx,
    )
  }
  if (verb === 'm') {
    const [target, page] = arg.split(':')
    switch (target) {
      case 'home':
        return showScreen(send, mainMenu(role, locale))
      case 'language':
        return showScreen(send, {
          text: tl(
            locale,
            '🌐 <b>زبان ربات</b>\nزبان دلخواه را انتخاب کنید:',
            '🌐 <b>Bot language</b>\nChoose your language:',
          ),
          keyboard: [
            [
              { text: 'فارسی', data: 'lang:fa' },
              { text: 'English', data: 'lang:en' },
            ],
          ],
        })
      case 'help':
        return showScreen(
          send,
          backHome(
            esc(telegramMenu(role, actor.botOwnerId !== null, locale)),
            [],
            locale,
          ),
        )
      case 'dash':
        return read('dashboard', {})
      case 'wallet':
        return role === 'admin'
          ? read('resellers', undefined, { page: 1 })
          : read('wallet')
      case 'billing':
        return read('billing', { status: 'all' })
      case 'renewals':
        return read('renewals')
      case 'resellers':
        return read('resellers', undefined, { page: Number(page) || 1 })
    }
  }
  if (verb === 'l') {
    const [view = 'a', page] = arg.split(':')
    const def = LIST_VIEWS[view] ?? LIST_VIEWS.a!
    return read(
      'users',
      {
        page: Math.max(1, Number(page) || 1),
        pageSize: 10,
        ...(def.view ? { view: def.view } : {}),
      },
      { view: LIST_VIEWS[view] ? view : 'a' },
    )
  }
  if (verb === 'u' && arg) {
    const row = await owned(arg)
    return showScreen(
      send,
      row
        ? userCardScreen(row, role, new Date(), locale)
        : backHome(
            tl(locale, 'کاربر پیدا نشد.', 'User not found.'),
            [],
            locale,
          ),
    )
  }
  if (verb === 's' && arg) {
    const row = await owned(arg)
    return showScreen(
      send,
      row
        ? subscriptionScreen(row, locale)
        : backHome(
            tl(locale, 'کاربر پیدا نشد.', 'User not found.'),
            [],
            locale,
          ),
    )
  }
  if (verb === 'a') {
    const [code, ...nameParts] = arg.split(':')
    const username = nameParts.join(':')
    const spec = USER_ACTIONS[code ?? '']
    if (!spec || !username || (spec.adminOnly && role !== 'admin'))
      return showScreen(
        send,
        backHome(
          tl(locale, 'درخواست نامعتبر است.', 'Invalid request.'),
          [],
          locale,
        ),
      )
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
  if ((verb === 'bs' || verb === 'bc') && arg) {
    if (verb === 'bs' && role !== 'admin')
      return showScreen(
        send,
        backHome(
          tl(locale, 'این بخش فقط برای مدیر است.', 'Admins only.'),
          [],
          locale,
        ),
      )
    return askConfirmation(
      {
        command: verb === 'bs' ? 'settle' : 'claimPaid',
        input: { eventId: arg },
      },
      verb === 'bs' ? 'تسویه این ردیف مالی' : 'اعلام پرداخت این ردیف مالی',
      actor,
      ctx,
    )
  }
  if ((verb === 'r' || verb === 'x') && role !== 'admin')
    return showScreen(
      send,
      backHome(
        tl(locale, 'این بخش فقط برای مدیر است.', 'Admins only.'),
        [],
        locale,
      ),
    )
  if (verb === 'r' && arg) {
    const list = (await invoke({ command: 'resellers' }, actor)) as any[]
    const reseller = list.find((r) => r.id === arg)
    if (!reseller)
      return showScreen(
        send,
        backHome(
          tl(locale, 'نماینده پیدا نشد.', 'Reseller not found.'),
          [],
          locale,
        ),
      )
    const snap = await invoke(
      { command: 'resellerWallet', input: { resellerId: arg } },
      actor,
    )
    return showScreen(send, resellerCardScreen(reseller, snap, locale))
  }
  if (verb === 'x') {
    const [code, id] = [arg.split(':')[0], arg.split(':').slice(1).join(':')]
    if ((code !== 'sus' && code !== 'res') || !id)
      return showScreen(
        send,
        backHome(
          tl(locale, 'درخواست نامعتبر است.', 'Invalid request.'),
          [],
          locale,
        ),
      )
    return askConfirmation(
      {
        command: code === 'sus' ? 'suspend' : 'resume',
        input: { resellerId: id },
      },
      code === 'sus' ? 'تعلیق این نماینده' : 'فعال‌سازی مجدد این نماینده',
      actor,
      ctx,
    )
  }
  return showScreen(
    send,
    backHome(
      tl(locale, 'درخواست نامعتبر است.', 'Invalid request.'),
      [],
      locale,
    ),
  )
}
