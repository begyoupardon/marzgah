/**
 * Multi-step bot conversations (create user, renew, edit, wallet, limits).
 * A flow is a list of questions; answers arrive as a button tap (`f:<index>`)
 * or as typed text, and the last answer produces a confirmation, never a direct
 * write. State lives in the telegram_flows table so it survives restarts.
 */
import { localUsernameSchema } from '#/lib/reseller-naming'

import { esc } from './telegram-ui'

const GB = 1024 ** 3

export type Data = Record<string, unknown>
export type FlowCtx = {
  role: string
  invoke: (command: string, input?: unknown) => Promise<any>
}
export type Ask = {
  text: string
  choices?: Array<{ label: string; value: string }>
}
type Step = {
  key: string
  /** Steps that do not apply (e.g. choosing a reseller as a reseller) are skipped. */
  skip?: (data: Data, ctx: FlowCtx) => boolean
  ask: (data: Data, ctx: FlowCtx) => Ask | Promise<Ask>
  /** Turns a typed or tapped answer into a value; throws Error(message) to re-ask. */
  parse: (raw: string, data: Data) => unknown
}
export type Done =
  | { kind: 'action'; command: string; input: unknown; summary: string }
  | { kind: 'read'; command: string; input: unknown; query: string }
export type FlowDef = {
  steps: Step[]
  start?: (arg: string | undefined, ctx: FlowCtx) => Data | Promise<Data>
  finish: (data: Data, ctx: FlowCtx) => Done | Promise<Done>
}

const fa = (n: number) => Math.round(n).toLocaleString('fa-IR')

function int(min: number, max: number, label: string) {
  return (raw: string) => {
    const n = Number(
      raw
        .replace(/[,\s]/g, '')
        .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))),
    )
    if (!Number.isSafeInteger(n) || n < min || n > max)
      throw new Error(
        `${label} باید عددی صحیح بین ${fa(min)} و ${fa(max)} باشد.`,
      )
    return n
  }
}

/** "-" means "none" for optional text answers. */
const optionalText = (max: number, label: string) => (raw: string) => {
  const text = raw.trim()
  if (text === '-' || text === '') return null
  if (text.length > max)
    throw new Error(`${label} حداکثر ${fa(max)} نویسه باشد.`)
  return text
}

const gbChoices = (values: number[]) =>
  values.map((v) => ({ label: `${fa(v)} GB`, value: String(v) }))
const dayChoices = [30, 60, 90].map((d) => ({
  label: `${fa(d)} روز`,
  value: String(d),
}))
const days = (raw: string) => {
  const n = Number(raw)
  if (![30, 60, 90].includes(n))
    throw new Error('مدت باید ۳۰، ۶۰ یا ۹۰ روز باشد.')
  return n
}
const dataGb = int(10, 10_000, 'حجم')

const nullableCap = (label: string) => (raw: string) => {
  const text = raw.trim().toLowerCase()
  if (text === '-' || text === 'none' || text === 'نامحدود') return null
  return int(0, 1_000_000, label)(raw)
}

export const FLOWS: Record<string, FlowDef> = {
  create: {
    steps: [
      {
        key: 'resellerId',
        skip: (_d, c) => c.role !== 'admin',
        ask: async (_d, c) => {
          const resellers = (await c.invoke('resellers')) as any[]
          return {
            text: '➕ <b>ساخت کاربر</b>\nکاربر برای کدام نماینده ساخته شود؟',
            choices: resellers
              .filter((r) => r.status !== 'disabled')
              .slice(0, 12)
              .map((r) => ({ label: r.name, value: r.id })),
          }
        },
        parse: (raw) => raw,
      },
      {
        key: 'username',
        ask: () => ({
          text: '➕ <b>ساخت کاربر</b>\nنام کاربری را بفرستید (حروف انگلیسی، عدد و - _ . @ ، حداکثر ۲۴ نویسه). پسوند نماینده خودکار اضافه می‌شود.',
        }),
        parse: (raw) => {
          const parsed = localUsernameSchema.safeParse(raw)
          if (!parsed.success) throw new Error(parsed.error.issues[0]!.message)
          return parsed.data
        },
      },
      {
        key: 'gb',
        ask: () => ({
          text: 'حجم را انتخاب کنید یا عدد گیگابایت بفرستید (حداقل ۱۰):',
          choices: gbChoices([10, 20, 30, 50, 100]),
        }),
        parse: dataGb,
      },
      {
        key: 'days',
        ask: () => ({
          text: 'مدت اشتراک را انتخاب کنید:',
          choices: dayChoices,
        }),
        parse: days,
      },
    ],
    async finish(d, c) {
      let price = ''
      try {
        const dash = await c.invoke(
          'dashboard',
          d.resellerId ? { resellerId: d.resellerId } : {},
        )
        const perGb = Number(dash?.profile?.pricePerGbToman)
        if (perGb > 0) price = ` · هزینه: ${fa(perGb * (d.gb as number))} تومان`
      } catch {
        // The price is a courtesy; the server charges the real amount anyway.
      }
      return {
        kind: 'action',
        command: 'create',
        input: {
          ...(d.resellerId ? { resellerId: d.resellerId } : {}),
          username: d.username,
          dataLimitBytes: (d.gb as number) * GB,
          durationDays: d.days,
        },
        summary: `ساخت کاربر ${d.username} با ${fa(d.gb as number)} گیگابایت برای ${fa(d.days as number)} روز${price}`,
      }
    },
  },

  renew: {
    start: (arg) => ({ username: arg }),
    steps: [
      {
        key: 'days',
        ask: (d) => ({
          text: `🔄 <b>تمدید ${esc(d.username)}</b>\nمدت را انتخاب کنید:`,
          choices: dayChoices,
        }),
        parse: days,
      },
      {
        key: 'extraGb',
        ask: () => ({
          text: 'چند گیگابایت حجم اضافه شود؟ (۰ = بدون افزودن، یا حداقل ۱۰)',
          choices: [
            { label: 'بدون افزودن', value: '0' },
            ...gbChoices([10, 20, 50, 100]),
          ],
        }),
        parse: (raw) => {
          const n = int(0, 10_000, 'حجم افزوده')(raw)
          if (n !== 0 && n < 10)
            throw new Error('حجم افزوده باید ۰ یا حداقل ۱۰ گیگابایت باشد.')
          return n
        },
      },
    ],
    finish: (d) => ({
      kind: 'action',
      command: 'renew',
      input: {
        username: d.username,
        durationDays: d.days,
        reactivate: true,
        ...((d.extraGb as number) > 0
          ? { additionalDataLimitBytes: (d.extraGb as number) * GB }
          : {}),
      },
      summary: `تمدید ${d.username} برای ${fa(d.days as number)} روز${(d.extraGb as number) > 0 ? ` و افزودن ${fa(d.extraGb as number)} گیگابایت` : ''}`,
    }),
  },

  limit: {
    start: (arg) => ({ username: arg }),
    steps: [
      {
        key: 'gb',
        ask: (d) => ({
          text: `📦 <b>تغییر حجم ${esc(d.username)}</b>\nحجم کل جدید را انتخاب کنید یا عدد گیگابایت بفرستید (حداقل ۱۰). افزایش حجم هزینه دارد.`,
          choices: gbChoices([10, 20, 30, 50, 100, 200]),
        }),
        parse: dataGb,
      },
    ],
    finish: (d) => ({
      kind: 'action',
      command: 'update',
      input: { username: d.username, dataLimitBytes: (d.gb as number) * GB },
      summary: `تغییر حجم ${d.username} به ${fa(d.gb as number)} گیگابایت`,
    }),
  },

  note: {
    start: (arg) => ({ username: arg }),
    steps: [
      {
        key: 'note',
        ask: (d) => ({
          text: `📝 <b>یادداشت ${esc(d.username)}</b>\nمتن یادداشت را بفرستید (حداکثر ۵۰۰ نویسه). برای پاک‌کردن «-» بفرستید.`,
        }),
        parse: optionalText(500, 'یادداشت'),
      },
    ],
    finish: (d) => ({
      kind: 'action',
      command: 'update',
      input: { username: d.username, note: d.note },
      summary: d.note
        ? `ثبت یادداشت برای ${d.username}`
        : `پاک‌کردن یادداشت ${d.username}`,
    }),
  },

  contact: {
    start: (arg) => ({ username: arg }),
    steps: [
      {
        key: 'phone',
        ask: (d) => ({
          text: `📞 <b>تماس ${esc(d.username)}</b>\nشماره تلفن را بفرستید. برای پاک‌کردن «-» بفرستید.`,
        }),
        parse: optionalText(32, 'شماره'),
      },
      {
        key: 'telegram',
        ask: () => ({
          text: 'آیدی تلگرام مشتری را بفرستید (بدون @). برای پاک‌کردن «-» بفرستید.',
        }),
        parse: optionalText(64, 'آیدی'),
      },
    ],
    finish: (d) => ({
      kind: 'action',
      command: 'contact',
      input: { username: d.username, phone: d.phone, telegram: d.telegram },
      summary: `ثبت اطلاعات تماس ${d.username}`,
    }),
  },

  search: {
    steps: [
      {
        key: 'q',
        ask: () => ({
          text: '🔎 <b>جستجو</b>\nبخشی از نام کاربری، یادداشت، تلفن یا آیدی تلگرام را بفرستید:',
        }),
        parse: (raw) => {
          const q = raw.trim()
          if (!q || q.length > 100)
            throw new Error('عبارت جستجو باید ۱ تا ۱۰۰ نویسه باشد.')
          return q
        },
      },
    ],
    finish: (d) => ({
      kind: 'read',
      command: 'users',
      input: { q: d.q, pageSize: 10 },
      query: d.q as string,
    }),
  },

  adjust: {
    start: (arg) => ({ resellerId: arg }),
    steps: [
      {
        key: 'type',
        ask: () => ({
          text: '💰 <b>تغییر اعتبار نماینده</b>\nنوع عملیات:',
          choices: [
            { label: '➕ افزایش', value: 'credit' },
            { label: '➖ کاهش', value: 'debit' },
          ],
        }),
        parse: (raw) => {
          if (raw !== 'credit' && raw !== 'debit')
            throw new Error('یکی از دکمه‌ها را انتخاب کنید.')
          return raw
        },
      },
      {
        key: 'amount',
        ask: () => ({ text: 'مبلغ را به تومان بفرستید:' }),
        parse: int(1, 1_000_000_000_000, 'مبلغ'),
      },
      {
        key: 'reason',
        ask: () => ({ text: 'دلیل را بنویسید (۳ تا ۲۰۰ نویسه):' }),
        parse: (raw) => {
          const reason = raw.trim()
          if (reason.length < 3 || reason.length > 200)
            throw new Error('دلیل باید ۳ تا ۲۰۰ نویسه باشد.')
          return reason
        },
      },
    ],
    finish: (d) => ({
      kind: 'action',
      command: 'adjust',
      input: {
        resellerId: d.resellerId,
        type: d.type,
        amountToman: d.amount,
        reason: d.reason,
      },
      summary: `${d.type === 'credit' ? 'افزایش' : 'کاهش'} اعتبار به میزان ${fa(d.amount as number)} تومان (${d.reason})`,
    }),
  },

  balance: {
    start: (arg) => ({ resellerId: arg }),
    steps: [
      {
        key: 'amount',
        ask: () => ({
          text: '⚖️ <b>تنظیم موجودی</b>\nموجودی هدف را به تومان بفرستید:',
        }),
        parse: int(0, 1_000_000_000_000, 'موجودی'),
      },
      {
        key: 'reason',
        ask: () => ({ text: 'دلیل را بنویسید، یا «-» بفرستید:' }),
        parse: optionalText(200, 'دلیل'),
      },
    ],
    finish: (d) => ({
      kind: 'action',
      command: 'balance',
      input: {
        resellerId: d.resellerId,
        targetBalanceToman: d.amount,
        reason: d.reason ?? 'Telegram admin action',
      },
      summary: `تنظیم موجودی روی ${fa(d.amount as number)} تومان`,
    }),
  },

  limits: {
    start: (arg) => ({ resellerId: arg }),
    steps: [
      {
        key: 'maxUsers',
        ask: () => ({
          text: '🧮 <b>سقف‌های نماینده</b>\nحداکثر تعداد کاربران را بفرستید (عدد، یا «-» برای نامحدود):',
        }),
        parse: nullableCap('حداکثر کاربران'),
      },
      {
        key: 'maxTotalGb',
        ask: () => ({
          text: 'حداکثر مجموع حجم به گیگابایت (عدد، یا «-» برای نامحدود):',
        }),
        parse: nullableCap('حداکثر حجم'),
      },
    ],
    finish: (d) => ({
      kind: 'action',
      command: 'limits',
      input: {
        resellerId: d.resellerId,
        maxUsers: d.maxUsers,
        maxTotalGb: d.maxTotalGb,
      },
      summary: `سقف کاربران: ${d.maxUsers == null ? 'نامحدود' : fa(d.maxUsers as number)} · سقف حجم: ${d.maxTotalGb == null ? 'نامحدود' : `${fa(d.maxTotalGb as number)} GB`}`,
    }),
  },
}

export type Advance =
  | { kind: 'ask'; stepIndex: number; data: Data; ask: Ask }
  | { kind: 'retry'; message: string; ask: Ask }
  | { kind: 'done'; done: Done }

async function nextStep(def: FlowDef, from: number, data: Data, ctx: FlowCtx) {
  let i = from
  while (i < def.steps.length && def.steps[i]!.skip?.(data, ctx)) i++
  return i
}

/** Begin a flow: seed its data and ask the first applicable question. */
export async function beginFlow(
  name: string,
  arg: string | undefined,
  ctx: FlowCtx,
): Promise<Advance | null> {
  const def = FLOWS[name]
  if (!def) return null
  const data = (await def.start?.(arg, ctx)) ?? {}
  const index = await nextStep(def, 0, data, ctx)
  if (index >= def.steps.length)
    return { kind: 'done', done: await def.finish(data, ctx) }
  return {
    kind: 'ask',
    stepIndex: index,
    data,
    ask: await def.steps[index]!.ask(data, ctx),
  }
}

/** The question the chat is currently waiting on (to resolve a button tap). */
export async function currentAsk(
  name: string,
  stepIndex: number,
  data: Data,
  ctx: FlowCtx,
) {
  const step = FLOWS[name]?.steps[stepIndex]
  return step ? step.ask(data, ctx) : null
}

/** Feed an answer; returns the next question, a retry message, or the finished flow. */
export async function advanceFlow(
  name: string,
  stepIndex: number,
  data: Data,
  raw: string,
  ctx: FlowCtx,
): Promise<Advance | null> {
  const def = FLOWS[name]
  const step = def?.steps[stepIndex]
  if (!def || !step) return null
  let value: unknown
  try {
    value = step.parse(raw, data)
  } catch (error) {
    return {
      kind: 'retry',
      message: error instanceof Error ? error.message : 'مقدار نامعتبر است.',
      ask: await step.ask(data, ctx),
    }
  }
  const next = { ...data, [step.key]: value }
  const index = await nextStep(def, stepIndex + 1, next, ctx)
  if (index >= def.steps.length)
    return { kind: 'done', done: await def.finish(next, ctx) }
  return {
    kind: 'ask',
    stepIndex: index,
    data: next,
    ask: await def.steps[index]!.ask(next, ctx),
  }
}
