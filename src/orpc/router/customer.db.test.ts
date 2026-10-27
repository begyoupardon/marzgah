import { expect, it, mock } from 'bun:test'
import { eq } from 'drizzle-orm'

import { callAs, setupRouterTest } from '../../../test/helpers/orpc'
import {
  makeReseller,
  makeUser,
  makeVpnUser,
} from '../../../test/helpers/factories'
import {
  auditLogs,
  billingEvents,
  renewalRequests,
  vpnUsers,
} from '#/db/schema'

const db = await setupRouterTest()
const GB = 1024 ** 3
let failModify = false
const upstream: string[] = []

mock.module('#/lib/marzban/client', () => ({
  MarzbanApiError: class extends Error {
    status = 500
  },
  marzban: {
    createUser: async () => ({}),
    modifyUser: async (u: string) => {
      if (failModify) throw new Error('marzban down')
      upstream.push(`modify:${u}`)
      return {}
    },
    resetUserDataUsage: async (u: string) => (upstream.push(`reset:${u}`), {}),
    getUser: async () => ({ proxies: {} }),
  },
}))
mock.module('#/lib/marzban/sync', () => ({
  refreshVpnUserMirrors: async (rows: unknown[]) => ({ rows, failed: false }),
  softRemoveMirroredVpnUser: async () => {},
  syncVpnUserFromMarzban: async (username: string) => {
    const [row] = await db
      .select()
      .from(vpnUsers)
      .where(eq(vpnUsers.marzbanUsername, username))
    return row ? { ...row, removedAt: null } : null
  },
}))
process.env.BETTER_AUTH_URL = 'https://panel.example.com'

const api = await import('./customer')
const admin = await makeUser(db, 'admin')
const alice = await makeReseller(db, { usernameSuffix: 'al' })
const bob = await makeReseller(db, { usernameSuffix: 'bo' })
const aliceUser = await makeVpnUser(db, alice.id, {
  marzbanUsername: 'al_cust',
  dataLimitBytes: 20 * GB,
  usedTrafficBytes: 5 * GB,
  subscriptionUrl: 'https://sub.example.com/sub/abc',
  note: 'private note',
  expireAt: new Date('2030-01-01'),
})
await makeVpnUser(db, bob.id, {
  marzbanUsername: 'bo_cust',
  dataLimitBytes: 10 * GB,
  expireAt: new Date('2030-01-01'),
})

const ip = (n: string) => ({ 'x-forwarded-for': n })
const tokenOf = (url: string) => url.split('/s/')[1]
async function link(username: string, as: string) {
  const r = (await callAs(api.createCustomerLink, { username }, as)) as {
    url: string
  }
  return tokenOf(r.url)
}

it('shows a customer only their own data, with nothing internal', async () => {
  await callAs(
    api.setBranding,
    { publicName: 'Acme VPN', supportContact: '@acme_support' },
    alice.id,
  )
  const token = await link('al_cust', alice.id)
  const view = (await callAs(
    api.publicView,
    { token },
    null,
    ip('10.0.0.1'),
  )) as Record<string, unknown>
  expect(view).toMatchObject({
    username: 'al_cust',
    usedBytes: 5 * GB,
    limitBytes: 20 * GB,
    subscriptionUrl: 'https://sub.example.com/sub/abc',
    seller: { name: 'Acme VPN', support: '@acme_support' },
    hasPendingRenewal: false,
  })
  const text = JSON.stringify(view)
  for (const secret of [
    alice.id,
    alice.email,
    aliceUser.id,
    'private note',
    'bo_cust',
  ])
    expect(text).not.toContain(secret)
})

it('treats every bad link identically', async () => {
  const token = await link('al_cust', alice.id)
  const unknown = await callAs(
    api.publicView,
    { token: 'a'.repeat(32) },
    null,
    ip('10.0.0.2'),
  ).catch((e) => e)
  const malformed = await callAs(
    api.publicView,
    { token: 'nope' },
    null,
    ip('10.0.0.2'),
  ).catch((e) => e)
  await callAs(api.revokeCustomerLink, { username: 'al_cust' }, alice.id)
  const revoked = await callAs(
    api.publicView,
    { token },
    null,
    ip('10.0.0.2'),
  ).catch((e) => e)
  for (const e of [unknown, malformed, revoked]) {
    expect(e).toMatchObject({ code: 'NOT_FOUND' })
    expect(e.message).toBe(unknown.message)
  }
})

it('a regenerated link replaces the previous one', async () => {
  const first = await link('al_cust', alice.id)
  const second = await link('al_cust', alice.id)
  await expect(
    callAs(api.publicView, { token: first }, null, ip('10.0.0.3')),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  await expect(
    callAs(api.publicView, { token: second }, null, ip('10.0.0.3')),
  ).resolves.toBeTruthy()
})

it('only the owner or an admin can create or revoke a customer link', async () => {
  await expect(
    callAs(api.createCustomerLink, { username: 'bo_cust' }, alice.id),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  await expect(
    callAs(api.revokeCustomerLink, { username: 'bo_cust' }, alice.id),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  await expect(
    callAs(api.createCustomerLink, { username: 'bo_cust' }, null),
  ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  await expect(link('bo_cust', admin.id)).resolves.toMatch(
    /^[A-Za-z0-9_-]{32}$/,
  )
  expect(
    (await db.select().from(auditLogs)).filter(
      (l) => l.action === 'customer_link.create',
    ).length,
  ).toBeGreaterThan(0)
})

it('rate limits link views per address', async () => {
  const token = await link('al_cust', alice.id)
  const results: string[] = []
  for (let i = 0; i < 62; i++) {
    results.push(
      await callAs(api.publicView, { token }, null, ip('10.9.9.9')).then(
        () => 'ok',
        (e) => e.code,
      ),
    )
  }
  expect(results.slice(0, 60).every((r) => r === 'ok')).toBe(true)
  expect(results.slice(60)).toEqual(['TOO_MANY_REQUESTS', 'TOO_MANY_REQUESTS'])
  await expect(
    callAs(api.publicView, { token }, null, ip('10.9.9.10')),
  ).resolves.toBeTruthy() // other addresses unaffected
})

it('customer asks, seller approves: renewal is billed exactly once', async () => {
  const token = await link('al_cust', alice.id)
  await callAs(
    api.publicRequestRenewal,
    { token, months: 2, message: 'سلام' },
    null,
    ip('10.1.0.1'),
  )
  expect(
    await callAs(api.publicView, { token }, null, ip('10.1.0.1')),
  ).toMatchObject({ hasPendingRenewal: true })
  await expect(
    callAs(
      api.publicRequestRenewal,
      { token, months: 1 },
      null,
      ip('10.1.0.1'),
    ),
  ).rejects.toMatchObject({ code: 'CONFLICT' })

  const pending = (await callAs(
    api.listRenewalRequests,
    undefined,
    alice.id,
  )) as Array<{ id: string; months: number; username: string }>
  expect(pending).toHaveLength(1)
  expect(pending[0]).toMatchObject({ months: 2, username: 'al_cust' })
  expect(
    (await callAs(api.listRenewalRequests, undefined, bob.id)) as unknown[],
  ).toHaveLength(0)

  // another seller cannot see or decide it
  await expect(
    callAs(api.approveRenewalRequest, { id: pending[0].id }, bob.id),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' })

  upstream.length = 0
  await callAs(api.approveRenewalRequest, { id: pending[0].id }, alice.id)
  expect(upstream).toContain('modify:al_cust')
  const bills = await db
    .select()
    .from(billingEvents)
    .where(eq(billingEvents.vpnUserId, aliceUser.id))
  expect(bills.filter((b) => b.type === 'renew')).toHaveLength(1)
  await expect(
    callAs(api.approveRenewalRequest, { id: pending[0].id }, alice.id),
  ).rejects.toMatchObject({ code: 'CONFLICT' })
  expect(
    (
      await db
        .select()
        .from(billingEvents)
        .where(eq(billingEvents.vpnUserId, aliceUser.id))
    ).filter((b) => b.type === 'renew'),
  ).toHaveLength(1)
  expect(
    await callAs(api.publicView, { token }, null, ip('10.1.0.1')),
  ).toMatchObject({ hasPendingRenewal: false })
})

it('a failed renewal leaves the request open for another try', async () => {
  const token = await link('bo_cust', bob.id)
  await callAs(
    api.publicRequestRenewal,
    { token, months: 1 },
    null,
    ip('10.2.0.1'),
  )
  const [req] = (await callAs(
    api.listRenewalRequests,
    undefined,
    bob.id,
  )) as Array<{ id: string }>
  failModify = true
  await expect(
    callAs(api.approveRenewalRequest, { id: req.id }, bob.id),
  ).rejects.toBeTruthy()
  failModify = false
  const [row] = await db
    .select()
    .from(renewalRequests)
    .where(eq(renewalRequests.id, req.id))
  expect(row?.status).toBe('pending')
  await callAs(api.approveRenewalRequest, { id: req.id }, bob.id)
  const [after] = await db
    .select()
    .from(renewalRequests)
    .where(eq(renewalRequests.id, req.id))
  expect(after?.status).toBe('approved')
})

it('rejecting closes the request and lets the customer ask again', async () => {
  const token = await link('bo_cust', bob.id)
  await callAs(
    api.publicRequestRenewal,
    { token, months: 3 },
    null,
    ip('10.3.0.1'),
  )
  const [req] = (await callAs(
    api.listRenewalRequests,
    undefined,
    admin.id,
  )) as Array<{ id: string }>
  await callAs(api.rejectRenewalRequest, { id: req.id }, admin.id)
  await expect(
    callAs(api.rejectRenewalRequest, { id: req.id }, admin.id),
  ).rejects.toMatchObject({ code: 'CONFLICT' })
  await expect(
    callAs(
      api.publicRequestRenewal,
      { token, months: 1 },
      null,
      ip('10.3.0.1'),
    ),
  ).resolves.toBeTruthy()
})

it('limits renewal requests per link and per address', async () => {
  const carol = await makeReseller(db, { usernameSuffix: 'ca' })
  const c = await makeVpnUser(db, carol.id, {
    marzbanUsername: 'ca_cust',
    dataLimitBytes: 10 * GB,
  })
  const token = await link(c.marzbanUsername, carol.id)
  const statuses: string[] = []
  for (let i = 0; i < 5; i++) {
    statuses.push(
      await callAs(
        api.publicRequestRenewal,
        { token, months: 1 },
        null,
        ip('10.4.0.1'),
      ).then(
        () => 'ok',
        (e) => e.code,
      ),
    )
  }
  // 1st ok, 2nd conflicts (already pending), 3rd conflicts, then the per-link cap (3/day) trips
  expect(statuses).toEqual([
    'ok',
    'CONFLICT',
    'CONFLICT',
    'TOO_MANY_REQUESTS',
    'TOO_MANY_REQUESTS',
  ])
  await expect(
    callAs(
      api.publicRequestRenewal,
      { token: 'z'.repeat(32), months: 1 },
      null,
      ip('10.4.0.2'),
    ),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' })
})

it('branding is per seller; admins have none', async () => {
  expect(await callAs(api.getBranding, undefined, bob.id)).toEqual({
    publicName: null,
    supportContact: null,
  })
  await callAs(
    api.setBranding,
    { publicName: ' Bob Net ', supportContact: null },
    bob.id,
  )
  expect(await callAs(api.getBranding, undefined, bob.id)).toEqual({
    publicName: 'Bob Net',
    supportContact: null,
  })
  await expect(
    callAs(api.getBranding, undefined, admin.id),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' })
})
