/** Rendering for the Telegram bot: HTML text and inline keyboards. Pure, no I/O. */

const GB = 1024 ** 3
const DAY = 86_400_000

export type Button = { text: string; data: string }
export type Keyboard = Button[][]
export type Screen = { text: string; keyboard?: Keyboard }

export const esc = (value: unknown) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

const fa = (n: number) => Math.round(n).toLocaleString('fa-IR')

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
const statusDot = (status: string) => (STATUS[status] ?? status).split(' ')[0]

export function usageBar(used: number, limit: number | null, width = 10) {
  if (!limit) return '∞'
  const ratio = Math.min(1, used / limit)
  const filled = Math.round(ratio * width)
  return `${'▓'.repeat(filled)}${'░'.repeat(width - filled)} ${fa(ratio * 100)}٪`
}

export const mainMenu = (role: string): Screen => ({
  text: '🤖 <b>پنل مدیریت</b>\nیک گزینه را انتخاب کنید:',
  keyboard: rows(
    [btn('📊 داشبورد', 'm:dash'), btn('👥 کاربران', 'm:users:1')],
    [btn('💰 کیف پول', 'm:wallet'), btn('🧾 مالی', 'm:billing')],
    [btn('🔄 درخواست‌های تمدید', 'm:renewals')],
    role === 'admin' ? [btn('🏪 نمایندگان', 'm:resellers')] : [],
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
  return backHome(lines.join('\n'), [btn('👥 کاربران', 'm:users:1')])
}

export function userListScreen(result: any, paged: boolean): Screen {
  const items: any[] = result?.items ?? []
  if (!items.length) return backHome('کاربری پیدا نشد.')
  const page = result.page ?? 1
  const pageCount = result.pageCount ?? 1
  const nav =
    paged && pageCount > 1
      ? [
          page > 1 ? btn('‹ قبلی', `m:users:${page - 1}`) : null,
          btn(`${fa(page)} / ${fa(pageCount)}`, 'noop'),
          page < pageCount ? btn('بعدی ›', `m:users:${page + 1}`) : null,
        ]
      : []
  return {
    text: `👥 <b>کاربران</b> — ${fa(result.total ?? items.length)} مورد`,
    keyboard: rows(
      ...items.map((u) => [
        btn(
          `${statusDot(u.status)} ${u.marzbanUsername} · ${fa(u.usedTrafficBytes / GB)}/${u.dataLimitBytes ? fa(u.dataLimitBytes / GB) : '∞'} GB`,
          `u:${u.marzbanUsername}`,
        ),
      ]),
      nav,
      [HOME],
    ),
  }
}

export function userCardScreen(u: any, role: string, now = new Date()): Screen {
  const name = u.marzbanUsername as string
  const expire = u.expireAt ? new Date(u.expireAt) : null
  const left = expire
    ? Math.ceil((expire.getTime() - now.getTime()) / DAY)
    : null
  const lines = [
    `👤 <b>${esc(name)}</b>`,
    STATUS[u.status] ?? esc(u.status),
    '',
    `📶 ${usageBar(u.usedTrafficBytes, u.dataLimitBytes)}`,
    `${fa(u.usedTrafficBytes / GB)} / ${u.dataLimitBytes ? `${fa(u.dataLimitBytes / GB)} GB` : '∞'}`,
    expire
      ? `⏳ انقضا: ${expire.toLocaleDateString('fa-IR')} (${left! > 0 ? `${fa(left!)} روز مانده` : 'منقضی'})`
      : '⏳ بدون انقضا',
  ]
  const disabled = u.status === 'disabled'
  return {
    text: lines.join('\n'),
    keyboard: rows(
      [30, 60, 90].map((d) => btn(`🔄 ${fa(d)} روز`, `a:r${d}:${name}`)),
      [
        btn(
          disabled ? '▶️ فعال‌سازی' : '⏸ غیرفعال',
          `a:${disabled ? 'en' : 'ds'}:${name}`,
        ),
        btn('♻️ صفر کردن مصرف', `a:rs:${name}`),
      ],
      [
        btn('🔗 ابطال لینک', `a:rv:${name}`),
        role === 'admin' ? btn('🗄 آرشیو', `a:ar:${name}`) : null,
      ],
      [btn('‹ فهرست کاربران', 'm:users:1'), HOME],
    ),
  }
}

export function walletScreen(result: any): Screen {
  return backHome(
    `💰 <b>کیف پول</b>\nموجودی: <b>${fa(Number(result?.balanceToman ?? 0))}</b> تومان`,
  )
}

export function billingScreen(result: any): Screen {
  const items: any[] = Array.isArray(result) ? result : (result?.items ?? [])
  if (!items.length) return backHome('🧾 ردیف مالی نیست.')
  return backHome(
    [
      '🧾 <b>گزارش مالی</b>',
      '',
      ...items
        .slice(0, 10)
        .map(
          (r) =>
            `${r.settledAt ? '✅' : '💸'} ${esc(r.username)} · ${fa(Number(r.amountToman))} تومان`,
        ),
    ].join('\n'),
  )
}

export function renewalsScreen(result: any): Screen {
  const items: any[] = (result ?? []).slice(0, 8)
  if (!items.length) return backHome('🔄 درخواستی نیست.')
  const label: Record<string, string> = {
    pending: '⏳',
    approved: '✅',
    rejected: '❌',
  }
  return {
    text: [
      '🔄 <b>درخواست‌های تمدید</b>',
      '',
      ...items.map((r) => `${label[r.status] ?? '•'} ${esc(r.username)}`),
    ].join('\n'),
    keyboard: rows(
      ...items
        .filter((r) => r.status === 'pending')
        .map((r) => [
          btn(`✅ ${r.username}`, `ra:${r.id}`),
          btn(`❌ ${r.username}`, `rr:${r.id}`),
        ]),
      [HOME],
    ),
  }
}

export function resellersScreen(result: any): Screen {
  const items: any[] = (result ?? []).slice(0, 20)
  if (!items.length) return backHome('🏪 نماینده‌ای نیست.')
  return backHome(
    [
      '🏪 <b>نمایندگان</b>',
      '',
      ...items.map(
        (r) =>
          `• ${esc(r.name)} · <code>${esc(r.id)}</code> · ${esc(r.status)}`,
      ),
    ].join('\n'),
  )
}

export const confirmScreen = (summary: string, token: string): Screen => ({
  text: `⚠️ <b>تأیید عملیات</b>\n${esc(summary)}\n\n⏱ این درخواست ۵ دقیقه اعتبار دارد.`,
  keyboard: rows([
    btn('✅ تأیید', `confirm:${token}`),
    btn('✖️ لغو', `cancel:${token}`),
  ]),
})

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
  ar: { command: 'archive', input: {}, label: 'آرشیو', adminOnly: true },
}
