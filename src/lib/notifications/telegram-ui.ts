/**
 * Rendering for the Telegram bot: HTML text and inline keyboards. Pure, no I/O.
 * Field names mirror what the router procedures actually return; the tests run
 * these against real procedure output, so a wrong name fails loudly.
 */

const GB = 1024 ** 3
const DAY = 86_400_000

export type Button = { text: string; data: string }
export type Keyboard = Button[][]
export type Screen = { text: string; keyboard?: Keyboard }

export const esc = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

const fa = (n: number) => Math.round(Number(n) || 0).toLocaleString('fa-IR')
const toman = (n: number) => `${fa(n)} تومان`
const gbText = (bytes: number | null) => (bytes ? `${fa(bytes / GB)} GB` : '∞')

/** Telegram rejects callback_data over 64 bytes; drop buttons that would not fit. */
const btn = (text: string, data: string): Button | null =>
  Buffer.byteLength(data) <= 64 ? { text, data } : null

const rows = (...r: Array<Array<Button | null>>): Keyboard =>
  r
    .map((row) => row.filter((b): b is Button => b !== null))
    .filter((row) => row.length)

const HOME = btn('🏠 منوی اصلی', 'm:home')

const STATUS: Record<string, string> = {
  active: '🟢 فعال',
  disabled: '⚫️ غیرفعال',
  limited: '🟠 حجم تمام شده',
  expired: '🔴 منقضی',
  on_hold: '⏸ در انتظار',
}
const statusDot = (status: string) => (STATUS[status] ?? '•').split(' ')[0]

export function usageBar(used: number, limit: number | null, width = 10) {
  if (!limit) return '∞'
  const ratio = Math.min(1, used / limit)
  const filled = Math.round(ratio * width)
  return `${'▓'.repeat(filled)}${'░'.repeat(width - filled)} ${fa(ratio * 100)}٪`
}

export const mainMenu = (role: string): Screen => ({
  text: '🤖 <b>پنل مدیریت</b>\nیک گزینه را انتخاب کنید:',
  keyboard: rows(
    [btn('📊 داشبورد', 'm:dash'), btn('👥 کاربران', 'l:a:1')],
    [btn('➕ ساخت کاربر', 'n:create'), btn('🔎 جستجو', 'n:search')],
    role === 'admin'
      ? [btn('🧾 مالی', 'm:billing'), btn('🔄 تمدیدها', 'm:renewals')]
      : [btn('💰 کیف پول', 'm:wallet'), btn('🧾 مالی', 'm:billing')],
    role === 'admin'
      ? [btn('🏪 نمایندگان', 'm:resellers:1')]
      : [btn('🔄 درخواست‌های تمدید', 'm:renewals')],
    [btn('❓ راهنمای دستورها', 'm:help')],
  ),
})

export const backHome = (
  text: string,
  extra: Array<Button | null> = [],
): Screen => ({
  text,
  keyboard: rows(extra, [HOME]),
})

export function dashboardScreen(result: any): Screen {
  const s = result?.stats
  if (!s) return backHome('خلاصه دریافت شد.')
  const risk = result?.atRisk
  const lines = [
    '📊 <b>داشبورد</b>',
    '',
    `👥 کاربران: <b>${fa(s.totalUsers)}</b>`,
    `🟢 فعال: ${fa(s.activeUsers)}   🔴 منقضی: ${fa(s.expiredUsers)}`,
    `🟠 حجم تمام: ${fa(s.limitedUsers)}   ⚫️ غیرفعال: ${fa(s.disabledUsers)}`,
    `📶 مصرف کل: ${fa(s.usedTrafficBytes / GB)} GB`,
  ]
  if (risk)
    lines.push(
      '',
      '⚠️ <b>نیازمند توجه</b>',
      `⏳ نزدیک انقضا: ${fa(risk.expiring)}`,
      `📈 مصرف بالا: ${fa(risk.highUsage)}`,
      `💸 پرداخت‌نشده: ${fa(risk.unpaid)}`,
    )
  return backHome(lines.join('\n'), [btn('👥 کاربران', 'l:a:1')])
}

/** List views: a = all, e = expiring, h = high usage, u = unpaid. */
export const LIST_VIEWS: Record<
  string,
  { label: string; view?: 'expiring' | 'high_usage' | 'unpaid' }
> = {
  a: { label: 'همه' },
  e: { label: 'نزدیک انقضا', view: 'expiring' },
  h: { label: 'مصرف بالا', view: 'high_usage' },
  u: { label: 'پرداخت‌نشده', view: 'unpaid' },
}

export function userListScreen(
  result: any,
  { view = 'a', query }: { view?: string; query?: string } = {},
): Screen {
  const items: any[] = result?.items ?? []
  const page = result?.page ?? 1
  const pageCount = result?.pageCount ?? 1
  const tools = rows(
    [btn('➕ ساخت کاربر', 'n:create'), btn('🔎 جستجو', 'n:search')],
    [
      btn('⏳ نزدیک انقضا', 'l:e:1'),
      btn('📈 مصرف بالا', 'l:h:1'),
      btn('💸 پرداخت‌نشده', 'l:u:1'),
    ],
  )
  const title = query
    ? `🔎 <b>جستجو:</b> ${esc(query)}`
    : `👥 <b>کاربران</b>${view !== 'a' ? ` — ${LIST_VIEWS[view]?.label}` : ''}`
  const nav =
    !query && pageCount > 1
      ? [
          page > 1 ? btn('‹ قبلی', `l:${view}:${page - 1}`) : null,
          btn(`${fa(page)} / ${fa(pageCount)}`, 'noop'),
          page < pageCount ? btn('بعدی ›', `l:${view}:${page + 1}`) : null,
        ]
      : []
  if (!items.length)
    return {
      text: `${title}\n\nکاربری پیدا نشد.`,
      keyboard: rows(...tools, [HOME]),
    }
  return {
    text: `${title} — ${fa(result.total ?? items.length)} مورد`,
    keyboard: rows(
      ...items.map((u) => [
        btn(
          `${statusDot(u.status)} ${u.marzbanUsername} · ${fa(u.usedTrafficBytes / GB)}/${u.dataLimitBytes ? fa(u.dataLimitBytes / GB) : '∞'} GB`,
          `u:${u.marzbanUsername}`,
        ),
      ]),
      nav,
      ...tools,
      [HOME],
    ),
  }
}

const BILLING_LABEL: Record<string, string> = {
  outstanding: '💸 پرداخت‌نشده',
  claimed: '🟡 پرداخت اعلام‌شده',
}

export function userCardScreen(u: any, role: string, now = new Date()): Screen {
  const name = u.marzbanUsername as string
  const expire = u.expireAt ? new Date(u.expireAt) : null
  const left = expire
    ? Math.ceil((expire.getTime() - now.getTime()) / DAY)
    : null
  const labels: string[] = Array.isArray(u.labels) ? u.labels : []
  const lines = [
    `👤 <b>${esc(name)}</b>`,
    STATUS[u.status] ?? esc(u.status),
    '',
    `📶 ${usageBar(u.usedTrafficBytes, u.dataLimitBytes)}`,
    `${fa(u.usedTrafficBytes / GB)} / ${gbText(u.dataLimitBytes)}`,
    expire
      ? `⏳ انقضا: ${expire.toLocaleDateString('fa-IR')} (${left! > 0 ? `${fa(left!)} روز مانده` : 'منقضی'})`
      : '⏳ بدون انقضا',
  ]
  if (u.note) lines.push(`📝 ${esc(u.note)}`)
  if (u.contactPhone) lines.push(`📞 ${esc(u.contactPhone)}`)
  if (u.contactTelegram) lines.push(`✈️ @${esc(u.contactTelegram)}`)
  if (labels.length) lines.push(`🏷 ${labels.map(esc).join('، ')}`)
  if (u.billingStatus && BILLING_LABEL[u.billingStatus])
    lines.push(BILLING_LABEL[u.billingStatus]!)
  const disabled = u.status === 'disabled'
  return {
    text: lines.join('\n'),
    keyboard: rows(
      [30, 60, 90].map((d) => btn(`🔄 ${fa(d)} روز`, `a:r${d}:${name}`)),
      [
        btn('➕ تمدید + حجم', `n:renew:${name}`),
        btn('📦 تغییر حجم', `n:limit:${name}`),
      ],
      [
        btn(
          disabled ? '▶️ فعال‌سازی' : '⏸ غیرفعال',
          `a:${disabled ? 'en' : 'ds'}:${name}`,
        ),
        btn('♻️ صفر کردن مصرف', `a:rs:${name}`),
      ],
      [
        btn('📋 لینک اشتراک', `s:${name}`),
        btn('🌐 صفحه مشتری', `a:lk:${name}`),
      ],
      [
        btn('📝 یادداشت', `n:note:${name}`),
        btn('📞 تماس', `n:contact:${name}`),
      ],
      [
        btn('🔗 ابطال لینک', `a:rv:${name}`),
        role === 'admin' ? btn('🗄 آرشیو', `a:ar:${name}`) : null,
      ],
      [btn('‹ فهرست کاربران', 'l:a:1'), HOME],
    ),
  }
}

export function subscriptionScreen(u: any): Screen {
  const url = u.subscriptionUrl as string | null
  const back = [btn('‹ بازگشت به کاربر', `u:${u.marzbanUsername}`)]
  if (!url) return backHome('این کاربر هنوز لینک اشتراک ندارد.', back)
  return backHome(
    `📋 <b>لینک اشتراک ${esc(u.marzbanUsername)}</b>\n<code>${esc(url)}</code>\n\nبرای کپی، روی لینک بزنید.`,
    back,
  )
}

export function walletScreen(snap: any): Screen {
  const entries: any[] = (snap?.entries ?? []).slice(0, 5)
  const lines = [
    '💰 <b>کیف پول</b>',
    '',
    `موجودی: <b>${toman(snap?.balanceToman)}</b>`,
    `بدهی پرداخت‌نشده: ${toman(snap?.outstandingToman)}`,
    `سقف اعتبار: ${snap?.creditLimitToman == null ? 'نامحدود' : toman(snap.creditLimitToman)}`,
  ]
  if (entries.length)
    lines.push(
      '',
      '<b>آخرین تراکنش‌ها</b>',
      ...entries.map(
        (e) =>
          `${e.type === 'credit' ? '➕' : '➖'} ${toman(e.amountToman)} · ${esc(String(e.reason ?? '').slice(0, 32))}`,
      ),
    )
  return backHome(lines.join('\n'))
}

const settleIcon = (r: any) =>
  r.settledAt ? '✅' : r.claimedPaidAt ? '🟡' : '💸'

export function billingScreen(items: any[], role: string): Screen {
  const open = items.filter((r) => !r.settledAt)
  if (!open.length) return backHome('🧾 همه ردیف‌های مالی تسویه شده‌اند ✅')
  const total = open.reduce((sum, r) => sum + Number(r.amountToman || 0), 0)
  const shown = open.slice(0, 8)
  const lines = [
    '🧾 <b>گزارش مالی</b>',
    `تسویه‌نشده: <b>${fa(open.length)}</b> ردیف · <b>${toman(total)}</b>`,
    '',
    ...shown.map(
      (r) =>
        `${settleIcon(r)} ${esc(r.marzbanUsername)} · ${toman(r.amountToman)}`,
    ),
  ]
  if (open.length > shown.length)
    lines.push(`… و ${fa(open.length - shown.length)} مورد دیگر`)
  return {
    text: lines.join('\n'),
    keyboard: rows(
      ...shown
        .filter((r) => role === 'admin' || !r.claimedPaidAt)
        .map((r) => [
          btn(
            role === 'admin'
              ? `✅ تسویه ${r.marzbanUsername}`
              : `💳 اعلام پرداخت ${r.marzbanUsername}`,
            `${role === 'admin' ? 'bs' : 'bc'}:${r.id}`,
          ),
        ]),
      [HOME],
    ),
  }
}

export function renewalsScreen(items: any[]): Screen {
  const shown = items.slice(0, 8)
  if (!shown.length) return backHome('🔄 درخواست تمدیدی نیست.')
  const days = (r: any) => r.durationDays || (r.months ?? 1) * 30
  return {
    text: [
      '🔄 <b>درخواست‌های تمدید</b>',
      '',
      ...shown.map(
        (r) =>
          `⏳ ${esc(r.username)} · ${fa(days(r))} روز${r.message ? ` — ${esc(String(r.message).slice(0, 60))}` : ''}`,
      ),
    ].join('\n'),
    keyboard: rows(
      ...shown.map((r) => [
        btn(`✅ ${r.username}`, `ra:${r.id}`),
        btn(`❌ ${r.username}`, `rr:${r.id}`),
      ]),
      [HOME],
    ),
  }
}

const RESELLER_PAGE = 8

export function resellersScreen(items: any[], page = 1): Screen {
  if (!items.length) return backHome('🏪 نماینده‌ای نیست.')
  const pageCount = Math.max(1, Math.ceil(items.length / RESELLER_PAGE))
  const p = Math.min(Math.max(1, page), pageCount)
  const slice = items.slice((p - 1) * RESELLER_PAGE, p * RESELLER_PAGE)
  const nav =
    pageCount > 1
      ? [
          p > 1 ? btn('‹ قبلی', `m:resellers:${p - 1}`) : null,
          btn(`${fa(p)} / ${fa(pageCount)}`, 'noop'),
          p < pageCount ? btn('بعدی ›', `m:resellers:${p + 1}`) : null,
        ]
      : []
  return {
    text: `🏪 <b>نمایندگان</b> — ${fa(items.length)} مورد`,
    keyboard: rows(
      ...slice.map((r) => [
        btn(
          `${r.status === 'disabled' ? '⛔' : '🟢'} ${r.name} · ${toman(r.balanceToman)}`,
          `r:${r.id}`,
        ),
      ]),
      nav,
      [HOME],
    ),
  }
}

export function resellerCardScreen(r: any, snap: any): Screen {
  const suspended = r.status === 'disabled'
  const lines = [
    `🏪 <b>${esc(r.name)}</b>`,
    esc(r.email),
    suspended ? '⛔ تعلیق‌شده' : '🟢 فعال',
    '',
    `پسوند نام‌کاربری: <code>${esc(r.usernameSuffix ?? '—')}</code>`,
    `قیمت هر گیگ: ${toman(r.pricePerGbToman)}`,
    `موجودی: <b>${toman(snap?.balanceToman ?? r.balanceToman)}</b>`,
    `بدهی پرداخت‌نشده: ${toman(snap?.outstandingToman)}`,
    `سقف اعتبار: ${r.creditLimitToman == null ? 'نامحدود' : toman(r.creditLimitToman)}`,
    `سقف کاربران: ${r.maxUsers == null ? 'نامحدود' : fa(r.maxUsers)} · سقف حجم: ${r.maxTotalGb == null ? 'نامحدود' : `${fa(r.maxTotalGb)} GB`}`,
  ]
  return {
    text: lines.join('\n'),
    keyboard: rows(
      [
        btn(
          suspended ? '✅ فعال‌سازی مجدد' : '⛔ تعلیق',
          `x:${suspended ? 'res' : 'sus'}:${r.id}`,
        ),
      ],
      [btn('💰 افزایش/کاهش اعتبار', `n:adjust:${r.id}`)],
      [
        btn('⚖️ تنظیم موجودی', `n:balance:${r.id}`),
        btn('🧮 سقف‌ها', `n:limits:${r.id}`),
      ],
      [btn('‹ نمایندگان', 'm:resellers:1'), HOME],
    ),
  }
}

export const confirmScreen = (summary: string, token: string): Screen => ({
  text: `⚠️ <b>تأیید عملیات</b>\n${esc(summary)}\n\n⏱ این درخواست ۵ دقیقه اعتبار دارد.`,
  keyboard: rows([
    btn('✅ تأیید', `confirm:${token}`),
    btn('✖️ لغو', `cancel:${token}`),
  ]),
})

/** A flow question: prompt plus choice buttons (3 per row) and a cancel button. */
export function askScreen(
  text: string,
  choices?: Array<{ label: string }>,
): Screen {
  const buttons = (choices ?? []).map((c, i) => btn(c.label, `f:${i}`))
  const grid: Array<Array<Button | null>> = []
  for (let i = 0; i < buttons.length; i += 3) grid.push(buttons.slice(i, i + 3))
  return { text, keyboard: rows(...grid, [btn('✖️ انصراف', 'f:x')]) }
}

/** Confirm-button actions on a user card: callback code → command + label. */
export const USER_ACTIONS: Record<
  string,
  {
    command: string
    input: Record<string, unknown>
    label: string
    adminOnly?: boolean
  }
> = {
  r30: {
    command: 'renew',
    input: { durationDays: 30, reactivate: true },
    label: 'تمدید ۳۰ روزه',
  },
  r60: {
    command: 'renew',
    input: { durationDays: 60, reactivate: true },
    label: 'تمدید ۶۰ روزه',
  },
  r90: {
    command: 'renew',
    input: { durationDays: 90, reactivate: true },
    label: 'تمدید ۹۰ روزه',
  },
  en: { command: 'update', input: { status: 'active' }, label: 'فعال‌سازی' },
  ds: {
    command: 'update',
    input: { status: 'disabled' },
    label: 'غیرفعال‌سازی',
  },
  rs: { command: 'reset', input: {}, label: 'صفر کردن مصرف' },
  rv: { command: 'revoke', input: {}, label: 'ابطال لینک اشتراک' },
  lk: {
    command: 'createLink',
    input: {},
    label: 'ساخت لینک صفحه مشتری (لینک قبلی باطل می‌شود)',
  },
  ar: { command: 'archive', input: {}, label: 'آرشیو', adminOnly: true },
}
