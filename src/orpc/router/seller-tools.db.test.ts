import { expect, it, mock } from 'bun:test'
import { eq } from 'drizzle-orm'

import { callAs, setupRouterTest } from '../../../test/helpers/orpc'
import {
  makeReseller,
  makeUser,
  makeVpnUser,
} from '../../../test/helpers/factories'
import { auditLogs, billingEvents, vpnUsers } from '#/db/schema'

const db = await setupRouterTest()
const GB = 1024 ** 3
const marzbanCalls: Array<[string, string, unknown?]> = []

mock.module('#/lib/marzban/client', () => ({
  MarzbanApiError: class extends Error {
    status = 500
  },
  marzban: {
    createUser: async (body: { username: string }) => (
      marzbanCalls.push(['create', body.username]),
      { username: body.username }
    ),
    modifyUser: async (u: string, p: unknown) => (
      marzbanCalls.push(['modify', u, p]),
      {}
    ),
    resetUserDataUsage: async (u: string) => (
      marzbanCalls.push(['reset', u]),
      {}
    ),
    getUser: async () => ({ proxies: {} }),
  },
}))
mock.module('#/lib/marzban/sync', () => ({
  refreshVpnUserMirrors: async (rows: unknown[]) => ({ rows, failed: false }),
  softRemoveMirroredVpnUser: async () => {},
  syncVpnUserFromMarzban: async (
    username: string,
    opts?: { resellerId?: string },
  ) => {
    const [existing] = await db
      .select()
      .from(vpnUsers)
      .where(eq(vpnUsers.marzbanUsername, username))
    if (existing) return existing
    const row = {
      id: crypto.randomUUID(),
      resellerId: opts?.resellerId ?? 'x',
      marzbanUsername: username,
      status: 'active' as const,
      dataLimitBytes: 10 * GB,
      usedTrafficBytes: 0,
      expireAt: new Date('2030-01-01'),
    }
    await db.insert(vpnUsers).values(row)
    return { ...row, removedAt: null }
  },
}))

const tools = await import('./seller-tools')
const admin = await makeUser(db, 'admin')
const alice = await makeReseller(db, { usernameSuffix: 'al' })
const bob = await makeReseller(db, { usernameSuffix: 'bo' })
const aliceUser = await makeVpnUser(db, alice.id, {
  marzbanUsername: 'al_one',
  dataLimitBytes: 10 * GB,
  note: '=cmd|calc',
})
const bobUser = await makeVpnUser(db, bob.id, {
  marzbanUsername: 'bo_one',
  dataLimitBytes: 10 * GB,
})

it('lets sellers edit only their own customers, with an audit diff', async () => {
  await callAs(
    tools.updateUserContact,
    {
      username: 'al_one',
      phone: '0912',
      telegram: '@ali',
      labels: ['vip', 'vip', ' friend '],
    },
    alice.id,
  )
  const [row] = await db
    .select()
    .from(vpnUsers)
    .where(eq(vpnUsers.id, aliceUser.id))
  expect(row?.contactTelegram).toBe('ali')
  expect(JSON.parse(row.labels!)).toEqual(['vip', 'friend'])
  const [log] = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.action, 'vpn_user.contact'))
  expect(JSON.parse(log.payloadJson!).before.phone).toBeNull()
  expect(JSON.parse(log.payloadJson!).after.phone).toBe('0912')

  await expect(
    callAs(
      tools.updateUserContact,
      { username: 'bo_one', phone: '1' },
      alice.id,
    ),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' })
})

it('exports only the caller’s users and neutralizes formulas', async () => {
  const mine = (await callAs(tools.exportUsers, {}, alice.id)) as {
    csv: string
  }
  expect(mine.csv).toContain('al_one')
  expect(mine.csv).not.toContain('bo_one')
  expect(mine.csv).toContain("'=cmd|calc")
  // a seller cannot widen scope by passing someone else's id
  const sneaky = (await callAs(
    tools.exportUsers,
    { resellerId: bob.id },
    alice.id,
  )) as { csv: string }
  expect(sneaky.csv).not.toContain('bo_one')
  const all = (await callAs(tools.exportUsers, {}, admin.id)) as { csv: string }
  expect(all.csv).toContain('bo_one')
  expect(all.csv).toContain('al_one')
})

it('exports billing scoped per seller', async () => {
  await db.insert(billingEvents).values({
    id: 'b-al',
    resellerId: alice.id,
    vpnUserId: aliceUser.id,
    marzbanUsername: 'al_one',
    type: 'create',
    dataLimitGb: 10,
    pricePerGbToman: 1000,
    amountToman: 10000,
    actorUserId: alice.id,
  })
  await db.insert(billingEvents).values({
    id: 'b-bo',
    resellerId: bob.id,
    vpnUserId: bobUser.id,
    marzbanUsername: 'bo_one',
    type: 'create',
    dataLimitGb: 10,
    pricePerGbToman: 1000,
    amountToman: 20000,
    actorUserId: bob.id,
  })
  const csv = (
    (await callAs(tools.exportBilling, {}, alice.id)) as { csv: string }
  ).csv
  expect(csv).toContain('10000')
  expect(csv).not.toContain('20000')
})

it('bulk labels only touch the caller’s own users', async () => {
  const r = (await callAs(
    tools.bulkLabel,
    { usernames: ['al_one', 'bo_one'], add: ['promo'] },
    alice.id,
  )) as { updated: number; skipped: number }
  expect(r).toEqual({ updated: 1, skipped: 1 })
  const [bobRow] = await db
    .select()
    .from(vpnUsers)
    .where(eq(vpnUsers.id, bobUser.id))
  expect(bobRow?.labels).toBeNull()
})

it('bulk renew reports per-user results and keeps going after a failure', async () => {
  marzbanCalls.length = 0
  const r = (await callAs(
    tools.bulkRenew,
    { usernames: ['al_one', 'bo_one', 'missing'], durationDays: 30 },
    alice.id,
  )) as { results: Array<{ username: string; ok: boolean }>; succeeded: number }
  expect(r.results.map((x) => [x.username, x.ok])).toEqual([
    ['al_one', true],
    ['bo_one', false],
    ['missing', false],
  ])
  expect(r.succeeded).toBe(1)
  expect(marzbanCalls.filter((c) => c[1] === 'bo_one')).toEqual([]) // never touched upstream
})

it('imports users from CSV, validating each row and respecting seller caps', async () => {
  const limited = await makeReseller(db, { usernameSuffix: 'lm', maxUsers: 1 })
  const csv =
    'username,gb,months,phone,labels\ngood1,10,1,0912,vip|x\nbad,5,1,,\ngood2,10,1,,\n'
  const r = (await callAs(tools.importUsers, { csv }, limited.id)) as {
    results: Array<{
      row: number
      username: string
      ok: boolean
      error?: string
    }>
  }
  expect(r.results[0]).toMatchObject({ row: 2, ok: true })
  expect(r.results[1]).toMatchObject({ row: 3, ok: false })
  expect(r.results[2]).toMatchObject({ row: 4, ok: false })
  expect(r.results[2].error).toContain('User limit reached')
  const [row] = await db
    .select()
    .from(vpnUsers)
    .where(eq(vpnUsers.marzbanUsername, 'lm_good1'))
  expect(row?.contactPhone).toBe('0912')
  expect(JSON.parse(row.labels!)).toEqual(['vip', 'x'])
})

it('rejects malformed or oversized imports', async () => {
  await expect(
    callAs(tools.importUsers, { csv: 'a,b\n1,2' }, alice.id),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  await expect(
    callAs(tools.importUsers, { csv: 'username,gb\n"oops' }, alice.id),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
})

it('keeps admin tools away from sellers', async () => {
  for (const [proc, input] of [
    [tools.suspendResellerAccount, { resellerId: bob.id }],
    [tools.resumeResellerAccount, { resellerId: bob.id }],
    [
      tools.setResellerLimits,
      { resellerId: bob.id, maxUsers: 1, maxTotalGb: null },
    ],
    [tools.setAnnouncement, { text: 'hi', level: 'info', active: true }],
  ] as const) {
    await expect(callAs(proc, input, alice.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  }
})

it('suspends a seller through the API and audits it', async () => {
  marzbanCalls.length = 0
  const r = (await callAs(
    tools.suspendResellerAccount,
    { resellerId: alice.id },
    admin.id,
  )) as { changed: number }
  expect(r.changed).toBeGreaterThan(0)
  expect(
    marzbanCalls.every(
      ([kind, , p]) =>
        kind === 'modify' && (p as { status: string }).status === 'disabled',
    ),
  ).toBe(true)
  await callAs(tools.resumeResellerAccount, { resellerId: alice.id }, admin.id)
  const actions = (await db.select().from(auditLogs)).map((l) => l.action)
  expect(actions).toContain('reseller.suspend')
  expect(actions).toContain('reseller.resume')
})

it('shows announcements to everyone only while active', async () => {
  expect(await callAs(tools.getAnnouncement, undefined, alice.id)).toBeNull()
  await callAs(
    tools.setAnnouncement,
    { text: 'Maintenance tonight', level: 'warning', active: true },
    admin.id,
  )
  expect(
    await callAs(tools.getAnnouncement, undefined, alice.id),
  ).toMatchObject({ text: 'Maintenance tonight', level: 'warning' })
  await callAs(
    tools.setAnnouncement,
    { text: 'Maintenance tonight', level: 'warning', active: false },
    admin.id,
  )
  expect(await callAs(tools.getAnnouncement, undefined, bob.id)).toBeNull()
})
