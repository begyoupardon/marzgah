import { afterAll, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'

import { callAs, setupRouterTest } from '../../../test/helpers/orpc'
import { FakeBackend } from '../../../test/fakes/backend'
import { makeReseller, makeUser } from '../../../test/helpers/factories'
import { BackendError } from '#/lib/backends/types'
import { resetBackends, setBackend } from '#/lib/backends/registry'
import { billingEvents, vpnUsers } from '#/db/schema'

const db = await setupRouterTest()
const fake = new FakeBackend()
setBackend('marzban', fake)
afterAll(() => resetBackends())

const vpn = await import('./vpn-users')
const tools = await import('./seller-tools')
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
    { username: 'ali', dataLimitBytes: 10 * GB, durationMonths: 1, note: 'hi' },
    seller.id,
  )
  const [call] = fake.callsTo('createUser')
  expect(call?.args[0]).toMatchObject({
    username: 'fk_ali',
    dataLimitBytes: 10 * GB,
    note: 'hi',
  })
  expect((call?.args[0] as { expireAt?: Date })?.expireAt).toBeInstanceOf(Date)

  const row = await mirror('fk_ali')
  expect(row).toMatchObject({
    backend: 'marzban',
    status: 'active',
    dataLimitBytes: 10 * GB,
    note: 'hi',
    resellerId: seller.id,
  })
  expect(row?.subscriptionUrl).toContain('/sub/fake-')
  expect(
    await db
      .select()
      .from(billingEvents)
      .where(eq(billingEvents.marzbanUsername, 'fk_ali')),
  ).toHaveLength(1)
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

it('renews by resetting usage and moving the expiry, then refreshes the mirror', async () => {
  fake.addUsage('fk_ali', 4 * GB)
  fake.calls.length = 0
  const before = (await mirror('fk_ali')).expireAt!
  await callAs(
    vpn.renewVpnUser,
    { username: 'fk_ali', durationMonths: 2 },
    seller.id,
  )
  expect(fake.callsTo('resetUsage')).toHaveLength(1)
  const update = fake.callsTo('updateUser')[0].args[1] as {
    expireAt: Date
    status?: string
  }
  expect(update.expireAt.getTime()).toBeGreaterThan(before.getTime())
  expect(update.status).toBe('active')
  const row = await mirror('fk_ali')
  expect(row?.usedTrafficBytes).toBe(0)
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
