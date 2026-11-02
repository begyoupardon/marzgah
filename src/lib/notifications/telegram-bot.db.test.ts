import { afterAll, beforeAll, expect, it } from 'bun:test'

import { FakeBackend } from '../../../test/fakes/backend'
import {
  makeReseller,
  makeUser,
  makeVpnUser,
} from '../../../test/helpers/factories'
import { setupRouterTest } from '../../../test/helpers/orpc'
import { resetBackends, setBackend } from '#/lib/backends/registry'
import { billingEvents, renewalRequests } from '#/db/schema'

const db = await setupRouterTest()
afterAll(() => resetBackends())
const GB = 1024 ** 3
const { credit } = await import('#/lib/wallet')
const { saveTelegramBot } = await import('./telegram')
const { routeTelegramCommand, handleTelegramCallback } =
  await import('./telegram-commands')

type Sent = {
  text: string
  keyboard: Array<Array<{ text: string; data: string }>>
}
const fake = new FakeBackend()

let reseller: Awaited<ReturnType<typeof makeReseller>>
let admin: Awaited<ReturnType<typeof makeUser>>
let resellerBot: Awaited<ReturnType<typeof saveTelegramBot>>
let platformBot: Awaited<ReturnType<typeof saveTelegramBot>>
let claimedEventId = ''
let openEventId = ''
let renewalId = ''

beforeAll(async () => {
  process.env.BETTER_AUTH_URL = 'https://panel.test'
  setBackend('marzban', fake)
  reseller = await makeReseller(db, {
    usernameSuffix: 'rs',
    pricePerGbToman: 1000,
  })
  admin = await makeUser(db, 'admin')
  resellerBot = await saveTelegramBot(
    {
      kind: 'reseller',
      ownerUserId: reseller.id,
      botToken: '123456:BOT-R',
      botUsername: 'r_bot',
    },
    db,
  )
  platformBot = await saveTelegramBot(
    {
      kind: 'platform',
      ownerUserId: null,
      botToken: '123456:BOT-P',
      botUsername: 'p_bot',
    },
    db,
  )
  fake.seed({
    username: 'rs_ali',
    note: 'old friend', // the note lives upstream and is re-synced on every view
    dataLimitBytes: 20 * GB,
    usedBytes: 5 * GB,
    expireAt: new Date(Date.now() + 10 * 86_400_000),
  })
  const vpn = await makeVpnUser(db, reseller.id, {
    marzbanUsername: 'rs_ali',
    dataLimitBytes: 20 * GB,
    usedTrafficBytes: 5 * GB,
    expireAt: new Date(Date.now() + 10 * 86_400_000),
    note: 'old friend',
    contactPhone: '0912',
    contactTelegram: 'ali_tg',
    labels: JSON.stringify(['vip']),
  })
  const event = (id: string, claimed: boolean) => ({
    id,
    resellerId: reseller.id,
    vpnUserId: vpn.id,
    marzbanUsername: 'rs_ali',
    type: 'create' as const,
    dataLimitGb: 20,
    durationDays: 30,
    pricePerGbToman: 1000,
    amountToman: 20_000,
    actorUserId: reseller.id,
    ...(claimed
      ? { claimedPaidAt: new Date(), claimedByUserId: reseller.id }
      : {}),
  })
  claimedEventId = 'evt-claimed'
  openEventId = 'evt-open'
  await db
    .insert(billingEvents)
    .values([event(openEventId, false), event(claimedEventId, true)])
  renewalId = 'ren-1'
  await db.insert(renewalRequests).values({
    id: renewalId,
    vpnUserId: vpn.id,
    resellerId: reseller.id,
    months: 1,
    durationDays: 30,
    message: 'please renew',
    status: 'pending',
  })
  await credit({
    resellerId: reseller.id,
    amountToman: 5_000,
    reason: 'topup',
    provider: 'test',
    reference: 'seed-1',
  })
})

function session(who: 'reseller' | 'admin') {
  const user = who === 'admin' ? admin : reseller
  const bot = who === 'admin' ? platformBot : resellerBot
  const actor = {
    userId: user.id,
    botId: bot.id,
    botOwnerId: who === 'admin' ? null : reseller.id,
    chatId: who === 'admin' ? '9100' : '9200',
  }
  let last: Sent = { text: '', keyboard: [] }
  const seen: Sent[] = []
  const send = async (text: string, keyboard?: Sent['keyboard']) => {
    last = { text, keyboard: keyboard ?? [] }
    seen.push(last)
  }
  const buttons = () => last.keyboard.flat()
  return {
    seen,
    get last() {
      return last
    },
    tap: (data: string) => handleTelegramCallback(data, actor, { db, send }),
    type: (text: string) =>
      routeTelegramCommand(text, actor, bot, { db, send }),
    find: (prefix: string) => buttons().find((b) => b.data.startsWith(prefix)),
    confirm: async function () {
      const b = this.find('confirm:')
      expect(b).toBeDefined()
      await handleTelegramCallback(b!.data, actor, { db, send })
    },
  }
}

const BROKEN = /undefined|NaN|\bnull\b|\[object/

it('no screen shows broken values, and every button fits Telegram limits', async () => {
  for (const who of ['reseller', 'admin'] as const) {
    const s = session(who)
    const taps = [
      'm:home',
      'm:dash',
      'l:a:1',
      'l:e:1',
      'l:h:1',
      'l:u:1',
      'u:rs_ali',
      's:rs_ali',
      'm:billing',
      'm:renewals',
      'm:help',
      ...(who === 'admin'
        ? ['m:resellers:1', `r:${reseller.id}`]
        : ['m:wallet']),
    ]
    for (const data of taps) {
      await s.tap(data)
      expect(s.last.text, `${who} ${data}`).not.toMatch(BROKEN)
      for (const b of s.last.keyboard.flat()) {
        expect(b.text, `${who} ${data} button`).not.toMatch(BROKEN)
        expect(Buffer.byteLength(b.data)).toBeLessThanOrEqual(64)
      }
    }
  }
})

it('shows real data on the billing, renewal, card and wallet screens', async () => {
  const s = session('reseller')
  await s.tap('m:billing')
  expect(s.last.text).toContain('rs_ali')
  expect(s.find(`bc:${openEventId}`)).toBeDefined() // can announce payment
  expect(s.find(`bc:${claimedEventId}`)).toBeUndefined() // already announced

  await s.tap('m:renewals')
  expect(s.last.text).toContain('please renew')
  expect(s.find(`ra:${renewalId}`)).toBeDefined()
  expect(s.find(`rr:${renewalId}`)).toBeDefined()

  await s.tap('u:rs_ali')
  for (const part of ['old friend', '0912', 'ali_tg', 'vip'])
    expect(s.last.text).toContain(part)

  await s.tap('m:wallet')
  expect(s.last.text).toContain('۵٬۰۰۰')

  const admin = session('admin')
  await admin.tap('m:billing')
  expect(admin.find(`bs:${openEventId}`)).toBeDefined()
})

it('creates a user through the guided flow, validates input, and shows the price', async () => {
  const s = session('reseller')
  await s.tap('n:create')
  expect(s.last.text).toContain('نام کاربری')

  await s.type('bad name!')
  expect(s.last.text).toContain('⚠️')
  await s.type('newbie')
  await s.tap('f:0') // 10 GB
  await s.tap('f:0') // 30 days
  expect(s.last.text).toContain('rs_newbie'.replace('rs_', '')) // local name shown in the summary
  expect(s.last.text).toContain('۱۰٬۰۰۰ تومان') // 10 GB × 1000

  await s.confirm()
  expect(s.last.text).toContain('کاربر ساخته شد')
  expect(s.last.text).toContain('rs_newbie')
  expect(s.last.text).toMatch(/\/sub\//)
  expect(fake.callsTo('createUser')).toHaveLength(1)
})

it('renews with extra data, edits the note, and searches', async () => {
  const s = session('reseller')
  await s.tap('n:renew:rs_ali')
  await s.tap('f:1') // 60 days
  await s.tap('f:1') // +10 GB
  expect(s.last.text).toContain('۶۰')
  await s.confirm()
  expect(s.last.text).toContain('انجام شد')

  await s.tap('n:note:rs_ali')
  await s.type('new note text')
  await s.confirm()
  await s.tap('u:rs_ali')
  expect(s.last.text).toContain('new note text')

  await s.tap('n:search')
  await s.type('ali')
  expect(s.last.text).toContain('جستجو')
  expect(s.find('u:rs_ali')).toBeDefined()
})

it('cancelling or sending a command abandons a flow, and stale taps are explained', async () => {
  const s = session('reseller')
  await s.tap('n:note:rs_ali')
  await s.tap('f:x')
  await s.type('this is not an answer anymore')
  expect(s.last.text).toContain('پنل مدیریت') // back to the menu, nothing was saved

  await s.tap('n:note:rs_ali')
  await s.type('/users')
  await s.type('orphan text')
  expect(s.last.text).toContain('پنل مدیریت')

  await s.tap('f:0')
  expect(s.last.text).toContain('منقضی')
})

it('announces payment as a reseller and settles as an admin, and issues customer links', async () => {
  const r = session('reseller')
  await r.tap(`bc:${openEventId}`)
  await r.confirm()
  expect(r.last.text).toContain('انجام شد')

  const a = session('admin')
  await a.tap(`bs:${claimedEventId}`)
  await a.confirm()
  expect(a.last.text).toContain('انجام شد')

  await r.tap('a:lk:rs_ali')
  await r.confirm()
  expect(r.last.text).toContain('/s/')
})

it('lets only admins manage resellers and wallets, through flows', async () => {
  const r = session('reseller')
  await r.tap('n:adjust:' + reseller.id)
  expect(r.last.text).toContain('فقط برای مدیر')
  await r.tap(`r:${reseller.id}`)
  expect(r.last.text).toContain('فقط برای مدیر')

  const a = session('admin')
  await a.tap(`r:${reseller.id}`)
  expect(a.last.text).toContain('rs')
  expect(a.find('x:sus:')).toBeDefined()

  await a.tap(`n:adjust:${reseller.id}`)
  await a.tap('f:0') // credit
  await a.type('2500')
  await a.type('goodwill bonus')
  await a.confirm()
  expect(a.last.text).toContain('انجام شد')
  await a.tap(`r:${reseller.id}`)
  expect(a.last.text).not.toMatch(BROKEN)

  await a.tap(`n:limits:${reseller.id}`)
  await a.type('5')
  await a.type('-')
  await a.confirm()
  await a.tap(`r:${reseller.id}`)
  expect(a.last.text).toContain('سقف کاربران: ۵')

  await a.tap(`x:sus:${reseller.id}`)
  await a.confirm()
  await a.tap(`r:${reseller.id}`)
  expect(a.last.text).toContain('تعلیق‌شده')
  await a.tap(`x:res:${reseller.id}`)
  await a.confirm()
})

it('an admin picks the reseller first when creating a user', async () => {
  const a = session('admin')
  await a.tap('n:create')
  expect(a.find('f:0')).toBeDefined()
  expect(a.last.text).toContain('کدام نماینده')
})
