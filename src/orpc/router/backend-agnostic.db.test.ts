import { afterAll, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'

import { callAs, setupRouterTest } from '../../../test/helpers/orpc'
import { FakeBackend } from '../../../test/fakes/backend'
import { makeReseller, makeUser } from '../../../test/helpers/factories'
import { BackendError } from '#/lib/backends/types'
import { resetBackends, setBackend } from '#/lib/backends/registry'
import { auditLogs, billingEvents, vpnUsers } from '#/db/schema'

const db = await setupRouterTest()
const fake = new FakeBackend()
setBackend('marzban', fake)
afterAll(() => resetBackends())

const vpn = await import('./vpn-users')
const tools = await import('./seller-tools')
const customers = await import('./customer')
const dashboard = await import('./dashboard')
const admin = await makeUser(db, 'admin')
const adminApi = await import('./admin')
const seller = await makeReseller(db, { usernameSuffix: 'fk' })
const GB = 1024 ** 3
const mirror = async (username: string) =>
  (
    await db
      .select()
      .from(vpnUsers)
      .where(eq(vpnUsers.marzbanUsername, username))
  )[0]

it('creates a customer on whatever backend is installed and mirrors it locally', async () => {
  fake.calls.length = 0
  await callAs(
    vpn.createVpnUser,
    { username: 'ali', dataLimitBytes: 10 * GB, durationDays: 30, note: 'hi' },
    seller.id,
  )
  const [call] = fake.callsTo('createUser')
  expect(call?.args[0]).toMatchObject({
    username: 'fk_ali',
    dataLimitBytes: 10 * GB,
    note: 'hi',
  })
  const expiration = (call?.args[0] as { expireAt?: Date })?.expireAt
  expect(expiration).toBeInstanceOf(Date)
  expect(expiration!.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000)
  expect(expiration!.getTime()).toBeLessThan(Date.now() + 31 * 86_400_000)

  const row = await mirror('fk_ali')
  expect(row).toMatchObject({
    backend: 'marzban',
    status: 'active',
    dataLimitBytes: 10 * GB,
    note: 'hi',
    resellerId: seller.id,
  })
  expect(row?.subscriptionUrl).toContain('/sub/fake-')
  const [createdBilling] = await db
    .select()
    .from(billingEvents)
    .where(eq(billingEvents.marzbanUsername, 'fk_ali'))
  expect(createdBilling).toMatchObject({
    durationDays: 30,
    durationMonths: null,
  })
})

it('maps a duplicate on the backend to a conflict', async () => {
  fake.seed({ username: 'fk_taken' })
  await expect(
    callAs(
      vpn.createVpnUser,
      { username: 'taken', dataLimitBytes: 10 * GB, durationMonths: 1 },
      seller.id,
    ),
  ).rejects.toMatchObject({ code: 'CONFLICT' })
})

it('renews from now, adds quota, and preserves usage', async () => {
  fake.addUsage('fk_ali', 4 * GB)
  await fake.updateUser('fk_ali', {
    expireAt: new Date('2030-01-01T00:00:00.000Z'),
  })
  fake.calls.length = 0
  await callAs(
    vpn.renewVpnUser,
    { username: 'fk_ali', durationDays: 60, additionalDataLimitBytes: 10 * GB },
    seller.id,
  )
  expect(fake.callsTo('resetUsage')).toHaveLength(0)
  const update = fake.callsTo('updateUser')[0].args[1] as {
    expireAt: Date
    status?: string
  }
  expect(update.expireAt.getTime()).toBeGreaterThan(
    Date.now() + 59 * 86_400_000,
  )
  expect(update.expireAt.getTime()).toBeLessThan(Date.now() + 61 * 86_400_000)
  expect(update.expireAt.getTime()).toBeLessThan(
    Date.parse('2030-01-01T00:00:00.000Z'),
  )
  expect(
    (fake.callsTo('updateUser')[0].args[1] as { dataLimitBytes: number })
      .dataLimitBytes,
  ).toBe(20 * GB)
  expect(update.status).toBe('active')
  const row = await mirror('fk_ali')
  expect(row?.usedTrafficBytes).toBe(4 * GB)
  expect(row?.expireAt?.getTime()).toBe(update.expireAt.getTime())
})

it('updates only what changed and keeps the mirror in step', async () => {
  fake.calls.length = 0
  await callAs(
    vpn.updateVpnUser,
    { username: 'fk_ali', status: 'disabled', note: 'paused' },
    seller.id,
  )
  expect(fake.callsTo('updateUser')[0]?.args[1]).toEqual({
    status: 'disabled',
    note: 'paused',
  })
  expect(await mirror('fk_ali')).toMatchObject({
    status: 'disabled',
    note: 'paused',
  })
})

it('explains when an account cannot take a password, and applies it when it can', async () => {
  await expect(
    callAs(
      vpn.updateVpnUser,
      { username: 'fk_ali', password: 'secret-pass-1' },
      seller.id,
    ),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  await callAs(
    vpn.createVpnUser,
    {
      username: 'bob',
      dataLimitBytes: 10 * GB,
      durationMonths: 1,
      proxies: { trojan: {} },
    },
    seller.id,
  )
  fake.calls.length = 0
  await callAs(
    vpn.updateVpnUser,
    { username: 'fk_bob', password: 'secret-pass-1' },
    seller.id,
  )
  expect(fake.callsTo('updateUser')[0]?.args[1]).toEqual({
    password: 'secret-pass-1',
  })
})

it('resets usage and revokes subscriptions through the interface', async () => {
  const before = (await mirror('fk_bob')).subscriptionUrl
  fake.addUsage('fk_bob', 2 * GB)
  await callAs(vpn.resetVpnUserUsage, { username: 'fk_bob' }, seller.id)
  expect((await mirror('fk_bob'))?.usedTrafficBytes).toBe(0)
  await callAs(vpn.revokeVpnUserSub, { username: 'fk_bob' }, seller.id)
  const after = (await mirror('fk_bob')).subscriptionUrl
  expect(after).not.toBe(before)
})

it('suspends and resumes a seller through the interface', async () => {
  await callAs(
    vpn.updateVpnUser,
    { username: 'fk_ali', status: 'active' },
    seller.id,
  )
  fake.calls.length = 0
  const r = (await callAs(
    tools.suspendResellerAccount,
    { resellerId: seller.id },
    admin.id,
  )) as { changed: number; failed: unknown[] }
  expect(r.changed).toBe(2)
  expect(
    fake
      .callsTo('updateUser')
      .every((c) => (c.args[1] as { status: string }).status === 'disabled'),
  ).toBe(true)
  expect((await fake.getUser('fk_ali')).status).toBe('disabled')
  await callAs(tools.resumeResellerAccount, { resellerId: seller.id }, admin.id)
  expect((await fake.getUser('fk_ali')).status).toBe('active')
})

it('reports backend health to admins', async () => {
  const health = (await callAs(
    adminApi.marzbanHealth,
    undefined,
    admin.id,
  )) as { ok: boolean; configured: boolean; stats: { version: string } }
  expect(health).toMatchObject({ ok: true, configured: true })
  expect(health.stats.version).toBe('fake-1')
})

it('surfaces backend outages as a server error, not a crash', async () => {
  fake.failNext.set('updateUser', new BackendError('down', 'UNAVAILABLE', 503))
  await expect(
    callAs(vpn.updateVpnUser, { username: 'fk_ali', note: 'x' }, seller.id),
  ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' })
})

it('refuses to guess when a user belongs to an unknown backend', async () => {
  await db
    .update(vpnUsers)
    .set({ backend: 'ghost' })
    .where(eq(vpnUsers.marzbanUsername, 'fk_bob'))
  await expect(
    callAs(vpn.resetVpnUserUsage, { username: 'fk_bob' }, seller.id),
  ).rejects.toBeTruthy()
  await db
    .update(vpnUsers)
    .set({ backend: 'marzban' })
    .where(eq(vpnUsers.marzbanUsername, 'fk_bob'))
})

it('allows admins to archive by soft-removal while preserving ledger and invalidating links', async () => {
  const tokenResult = (await callAs(
    customers.createCustomerLink,
    { username: 'fk_ali' },
    seller.id,
  )) as { url: string }
  const token = tokenResult.url.split('/s/')[1]
  const beforeBills = await db
    .select()
    .from(billingEvents)
    .where(eq(billingEvents.marzbanUsername, 'fk_ali'))
  await expect(
    callAs(vpn.deleteVpnUser, { username: 'fk_ali' }, seller.id),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  await callAs(vpn.deleteVpnUser, { username: 'fk_ali' }, admin.id)
  const [archived] = await db
    .select()
    .from(vpnUsers)
    .where(eq(vpnUsers.marzbanUsername, 'fk_ali'))
  expect(archived).toMatchObject({ status: 'disabled' })
  expect(archived?.removedAt).toBeInstanceOf(Date)
  expect(
    await db
      .select()
      .from(billingEvents)
      .where(eq(billingEvents.marzbanUsername, 'fk_ali')),
  ).toHaveLength(beforeBills.length)
  expect(
    await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'vpn_user.soft_remove')),
  ).not.toHaveLength(0)
  await expect(
    callAs(customers.publicView, { token }, null),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  expect(
    (
      (await callAs(dashboard.getDashboard, {}, seller.id)) as {
        stats: { totalUsers: number }
      }
    ).stats.totalUsers,
  ).toBe(1)
  expect(fake.callsTo('updateUser').at(-1)?.args[1]).toMatchObject({
    status: 'disabled',
  })
})
