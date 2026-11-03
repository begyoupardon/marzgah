import type { Keyboard, Screen } from './telegram-ui'
import { esc } from './telegram-ui'

const GB = 1024 ** 3
const DAY = 86_400_000
const num = (n: number, digits = 0) =>
  Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: digits })
const money = (n: number) => `${num(n)} toman`
const button = (text: string, data: string) =>
  Buffer.byteLength(data) <= 64 ? { text, data } : null
const rows = (
  ...input: Array<Array<{ text: string; data: string } | null>>
): Keyboard =>
  input
    .map((row) =>
      row.filter(
        (item): item is { text: string; data: string } => item !== null,
      ),
    )
    .filter((row) => row.length)
const home = button('🏠 Main menu', 'm:home')
const back = (
  text: string,
  extra: Array<{ text: string; data: string } | null> = [],
): Screen => ({ text, keyboard: rows(extra, [home]) })
const status: Record<string, string> = {
  active: '🟢 Active',
  disabled: '⚫️ Disabled',
  limited: '🟠 Data exhausted',
  expired: '🔴 Expired',
  on_hold: '⏸ On hold',
}
const dot = (value: string) => (status[value] ?? '•').split(' ')[0]

export const enMainMenu = (role: string): Screen => ({
  text: '🤖 <b>Management panel</b>\nChoose an option:',
  keyboard: rows(
    [button('📊 Dashboard', 'm:dash'), button('👥 Users', 'l:a:1')],
    [button('➕ Create user', 'n:create'), button('🔎 Search', 'n:search')],
    role === 'admin'
      ? [button('🧾 Billing', 'm:billing'), button('🔄 Renewals', 'm:renewals')]
      : [button('💰 Wallet', 'm:wallet'), button('🧾 Billing', 'm:billing')],
    role === 'admin'
      ? [button('🏪 Resellers', 'm:resellers:1')]
      : [button('🔄 Renewal requests', 'm:renewals')],
    [button('🌐 Language', 'm:language'), button('❓ Help', 'm:help')],
  ),
})
export const enBackHome = back
export function enDashboard(result: any): Screen {
  const s = result?.stats
  if (!s) return back('Dashboard loaded.')
  const lines = [
    '📊 <b>Dashboard</b>',
    '',
    `👥 Users: <b>${num(s.totalUsers)}</b>`,
    `🟢 Active: ${num(s.activeUsers)}   🔴 Expired: ${num(s.expiredUsers)}`,
    `🟠 Data exhausted: ${num(s.limitedUsers)}   ⚫️ Disabled: ${num(s.disabledUsers)}`,
    `📶 Total usage: ${num(s.usedTrafficBytes / GB, 2)} GB`,
  ]
  if (result.atRisk)
    lines.push(
      '',
      '⚠️ <b>Needs attention</b>',
      `⏳ Expiring soon: ${num(result.atRisk.expiring)}`,
      `📈 High usage: ${num(result.atRisk.highUsage)}`,
      `💸 Unpaid: ${num(result.atRisk.unpaid)}`,
    )
  return back(lines.join('\n'), [button('👥 Users', 'l:a:1')])
}
const viewLabels: Record<string, string> = {
  a: 'All',
  e: 'Expiring soon',
  h: 'High usage',
  u: 'Unpaid',
}
export function enUserList(
  result: any,
  { view = 'a', query }: { view?: string; query?: string } = {},
): Screen {
  const items: any[] = result?.items ?? []
  const page = result?.page ?? 1
  const pages = result?.pageCount ?? 1
  const title = query
    ? `🔎 <b>Search:</b> ${esc(query)}`
    : `👥 <b>Users</b>${view !== 'a' ? ` — ${viewLabels[view] ?? ''}` : ''}`
  const tools = rows(
    [button('➕ Create user', 'n:create'), button('🔎 Search', 'n:search')],
    [
      button('⏳ Expiring', 'l:e:1'),
      button('📈 High usage', 'l:h:1'),
      button('💸 Unpaid', 'l:u:1'),
    ],
  )
  const nav =
    !query && pages > 1
      ? [
          page > 1 ? button('‹ Previous', `l:${view}:${page - 1}`) : null,
          button(`${num(page)} / ${num(pages)}`, 'noop'),
          page < pages ? button('Next ›', `l:${view}:${page + 1}`) : null,
        ]
      : []
  if (!items.length)
    return {
      text: `${title}\n\nNo users found.`,
      keyboard: rows(...tools, [home]),
    }
  return {
    text: `${title} — ${num(result.total ?? items.length)} results`,
    keyboard: rows(
      ...items.map((u) => [
        button(
          `${dot(u.status)} ${u.marzbanUsername} · ${num(u.usedTrafficBytes / GB, 2)}/${u.dataLimitBytes ? num(u.dataLimitBytes / GB, 2) : '∞'} GB`,
          `u:${u.marzbanUsername}`,
        ),
      ]),
      nav,
      ...tools,
      [home],
    ),
  }
}
export function enUserCard(u: any, role: string, now = new Date()): Screen {
  const name = u.marzbanUsername as string
  const expire = u.expireAt ? new Date(u.expireAt) : null
  const left = expire
    ? Math.ceil((expire.getTime() - now.getTime()) / DAY)
    : null
  const ratio = u.dataLimitBytes
    ? Math.min(1, u.usedTrafficBytes / u.dataLimitBytes)
    : null
  const bar =
    ratio === null
      ? '∞'
      : `${'▓'.repeat(Math.round(ratio * 10))}${'░'.repeat(10 - Math.round(ratio * 10))} ${num(ratio * 100)}%`
  const lines = [
    `👤 <b>${esc(name)}</b>`,
    status[u.status] ?? esc(u.status),
    '',
    `📶 ${bar}`,
    `${num(u.usedTrafficBytes / GB, 2)} / ${u.dataLimitBytes ? `${num(u.dataLimitBytes / GB, 2)} GB` : '∞'}`,
    expire
      ? `⏳ Expires: ${expire.toLocaleDateString('en-US')} (${left! > 0 ? `${num(left!)} days left` : 'expired'})`
      : '⏳ No expiry',
  ]
  if (u.note) lines.push(`📝 ${esc(u.note)}`)
  if (u.contactPhone) lines.push(`📞 ${esc(u.contactPhone)}`)
  if (u.contactTelegram) lines.push(`✈️ @${esc(u.contactTelegram)}`)
  if (Array.isArray(u.labels) && u.labels.length)
    lines.push(`🏷 ${u.labels.map(esc).join(', ')}`)
  if (u.billingStatus === 'outstanding') lines.push('💸 Unpaid')
  if (u.billingStatus === 'claimed') lines.push('🟡 Payment claimed')
  return {
    text: lines.join('\n'),
    keyboard: rows(
      [30, 60, 90].map((d) => button(`🔄 ${d} days`, `a:r${d}:${name}`)),
      [
        button('➕ Renew + data', `n:renew:${name}`),
        button('📦 Change data', `n:limit:${name}`),
      ],
      [
        button(
          u.status === 'disabled' ? '▶️ Enable' : '⏸ Disable',
          `a:${u.status === 'disabled' ? 'en' : 'ds'}:${name}`,
        ),
        button('♻️ Reset usage', `a:rs:${name}`),
      ],
      [
        button('📋 Subscription link', `s:${name}`),
        button('🌐 Customer page', `a:lk:${name}`),
      ],
      [
        button('📝 Note', `n:note:${name}`),
        button('📞 Contact', `n:contact:${name}`),
      ],
      [
        button('🔗 Revoke link', `a:rv:${name}`),
        role === 'admin' ? button('🗄 Archive', `a:ar:${name}`) : null,
      ],
      [button('‹ Users', 'l:a:1'), home],
    ),
  }
}
export function enSubscription(u: any): Screen {
  const extra = [button('‹ Back to user', `u:${u.marzbanUsername}`)]
  if (!u.subscriptionUrl)
    return back('This user has no subscription link yet.', extra)
  return back(
    `📋 <b>Subscription link for ${esc(u.marzbanUsername)}</b>\n<code>${esc(u.subscriptionUrl)}</code>\n\nTap the link to copy it.`,
    extra,
  )
}
export function enWallet(snap: any): Screen {
  const entries: any[] = (snap?.entries ?? []).slice(0, 5)
  const lines = [
    '💰 <b>Wallet</b>',
    '',
    `Balance: <b>${money(snap?.balanceToman)}</b>`,
    `Outstanding debt: ${money(snap?.outstandingToman)}`,
    `Credit limit: ${snap?.creditLimitToman == null ? 'Unlimited' : money(snap.creditLimitToman)}`,
  ]
  if (entries.length)
    lines.push(
      '',
      '<b>Recent transactions</b>',
      ...entries.map(
        (e) =>
          `${e.type === 'credit' ? '➕' : '➖'} ${money(e.amountToman)} · ${esc(String(e.reason ?? '').slice(0, 32))}`,
      ),
    )
  return back(lines.join('\n'))
}
export function enBilling(items: any[], role: string): Screen {
  const open = items.filter((r) => !r.settledAt)
  if (!open.length) return back('🧾 All billing rows are settled ✅')
  const shown = open.slice(0, 8)
  const total = open.reduce((sum, r) => sum + Number(r.amountToman || 0), 0)
  const lines = [
    '🧾 <b>Billing</b>',
    `Unsettled: <b>${num(open.length)}</b> rows · <b>${money(total)}</b>`,
    '',
    ...shown.map(
      (r) =>
        `${r.claimedPaidAt ? '🟡' : '💸'} ${esc(r.marzbanUsername)} · ${money(r.amountToman)}`,
    ),
  ]
  if (open.length > shown.length)
    lines.push(`… and ${num(open.length - shown.length)} more`)
  return {
    text: lines.join('\n'),
    keyboard: rows(
      ...shown
        .filter((r) => role === 'admin' || !r.claimedPaidAt)
        .map((r) => [
          button(
            role === 'admin'
              ? `✅ Settle ${r.marzbanUsername}`
              : `💳 Mark paid ${r.marzbanUsername}`,
            `${role === 'admin' ? 'bs' : 'bc'}:${r.id}`,
          ),
        ]),
      [home],
    ),
  }
}
export function enRenewals(items: any[]): Screen {
  const shown = items.slice(0, 8)
  if (!shown.length) return back('🔄 No renewal requests.')
  return {
    text: [
      '🔄 <b>Renewal requests</b>',
      '',
      ...shown.map(
        (r) =>
          `⏳ ${esc(r.username)} · ${num(r.durationDays || (r.months ?? 1) * 30)} days${r.message ? ` — ${esc(String(r.message).slice(0, 60))}` : ''}`,
      ),
    ].join('\n'),
    keyboard: rows(
      ...shown.map((r) => [
        button(`✅ ${r.username}`, `ra:${r.id}`),
        button(`❌ ${r.username}`, `rr:${r.id}`),
      ]),
      [home],
    ),
  }
}
export function enResellers(items: any[], page = 1): Screen {
  if (!items.length) return back('🏪 No resellers.')
  const pages = Math.max(1, Math.ceil(items.length / 8))
  const p = Math.min(Math.max(1, page), pages)
  const slice = items.slice((p - 1) * 8, p * 8)
  const nav =
    pages > 1
      ? [
          p > 1 ? button('‹ Previous', `m:resellers:${p - 1}`) : null,
          button(`${num(p)} / ${num(pages)}`, 'noop'),
          p < pages ? button('Next ›', `m:resellers:${p + 1}`) : null,
        ]
      : []
  return {
    text: `🏪 <b>Resellers</b> — ${num(items.length)} results`,
    keyboard: rows(
      ...slice.map((r) => [
        button(
          `${r.status === 'disabled' ? '⛔' : '🟢'} ${r.name} · ${money(r.balanceToman)}`,
          `r:${r.id}`,
        ),
      ]),
      nav,
      [home],
    ),
  }
}
export function enResellerCard(r: any, snap: any): Screen {
  const suspended = r.status === 'disabled'
  const lines = [
    `🏪 <b>${esc(r.name)}</b>`,
    esc(r.email),
    suspended ? '⛔ Suspended' : '🟢 Active',
    '',
    `Username suffix: <code>${esc(r.usernameSuffix ?? '—')}</code>`,
    `Price per GB: ${money(r.pricePerGbToman)}`,
    `Balance: <b>${money(snap?.balanceToman ?? r.balanceToman)}</b>`,
    `Outstanding debt: ${money(snap?.outstandingToman)}`,
    `Credit limit: ${r.creditLimitToman == null ? 'Unlimited' : money(r.creditLimitToman)}`,
    `User limit: ${r.maxUsers == null ? 'Unlimited' : num(r.maxUsers)} · Data limit: ${r.maxTotalGb == null ? 'Unlimited' : `${num(r.maxTotalGb)} GB`}`,
  ]
  return {
    text: lines.join('\n'),
    keyboard: rows(
      [
        button(
          suspended ? '✅ Resume' : '⛔ Suspend',
          `x:${suspended ? 'res' : 'sus'}:${r.id}`,
        ),
      ],
      [button('💰 Adjust credit', `n:adjust:${r.id}`)],
      [
        button('⚖️ Set balance', `n:balance:${r.id}`),
        button('🧮 Limits', `n:limits:${r.id}`),
      ],
      [button('‹ Resellers', 'm:resellers:1'), home],
    ),
  }
}
export const enConfirm = (summary: string, token: string): Screen => ({
  text: `⚠️ <b>Confirm action</b>\n${esc(summary)}\n\n⏱ This request expires in 5 minutes.`,
  keyboard: rows([
    button('✅ Confirm', `confirm:${token}`),
    button('✖️ Cancel', `cancel:${token}`),
  ]),
})
export const enAsk = (
  text: string,
  choices?: Array<{ label: string }>,
): Screen => {
  const buttons = (choices ?? []).map((choice, index) =>
    button(choice.label, `f:${index}`),
  )
  const grid: Array<Array<{ text: string; data: string } | null>> = []
  for (let i = 0; i < buttons.length; i += 3) grid.push(buttons.slice(i, i + 3))
  return { text, keyboard: rows(...grid, [button('✖️ Cancel', 'f:x')]) }
}
