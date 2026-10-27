import { expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'

import { mockDb } from '../../test/helpers/db'
import { makeReseller, makeVpnUser } from '../../test/helpers/factories'
import { billingEvents, resellerProfiles, vpnUsers } from '#/db/schema'

const db = await mockDb()
const { assertCanCreateVpnUser, QuotaExceededError } =
  await import('./marzban/quotas')
const { viewCondition, labelCondition, parseLabels, normalizeLabels } =
  await import('./user-filters')
const { suspendReseller, resumeReseller } =
  await import('./reseller-suspension')

const GB = 1024 ** 3
const names = async (cond: ReturnType<typeof viewCondition>) =>
  (await db.select({ u: vpnUsers.marzbanUsername }).from(vpnUsers).where(cond))
    .map((r) => r.u)
    .sort()

it('enforces max users and max total GB, ignoring removed users', async () => {
  const r = await makeReseller(db, { maxUsers: 2, maxTotalGb: 30 })
  await makeVpnUser(db, r.id, { dataLimitBytes: 10 * GB })
  await makeVpnUser(db, r.id, {
    dataLimitBytes: 10 * GB,
    removedAt: new Date(),
  })
  await assertCanCreateVpnUser(r.id, 10 * GB) // 2nd user, 20 of 30 GB
  await makeVpnUser(db, r.id, { dataLimitBytes: 10 * GB })
  await expect(assertCanCreateVpnUser(r.id, 10 * GB)).rejects.toThrow(
    'User limit reached',
  )

  const gbBound = await makeReseller(db, { maxTotalGb: 25 })
  await makeVpnUser(db, gbBound.id, { dataLimitBytes: 20 * GB })
  await expect(
    assertCanCreateVpnUser(gbBound.id, 10 * GB),
  ).rejects.toBeInstanceOf(QuotaExceededError)
  await assertCanCreateVpnUser(gbBound.id, 5 * GB)
})

it('treats NULL caps as unlimited and still blocks disabled resellers', async () => {
  const free = await makeReseller(db)
  for (let i = 0; i < 5; i++)
    await makeVpnUser(db, free.id, { dataLimitBytes: 100 * GB })
  await assertCanCreateVpnUser(free.id, 1000 * GB)
  const off = await makeReseller(db, { status: 'disabled' })
  await expect(assertCanCreateVpnUser(off.id)).rejects.toThrow('disabled')
})

it('filters expiring, high-usage and unpaid users', async () => {
  const r = await makeReseller(db)
  const now = new Date('2026-06-01T00:00:00Z')
  const soon = await makeVpnUser(db, r.id, {
    expireAt: new Date('2026-06-04T00:00:00Z'),
  })
  await makeVpnUser(db, r.id, { expireAt: new Date('2026-07-01T00:00:00Z') })
  await makeVpnUser(db, r.id, { expireAt: new Date('2026-05-30T00:00:00Z') }) // already past
  const heavy = await makeVpnUser(db, r.id, {
    dataLimitBytes: 10 * GB,
    usedTrafficBytes: 9 * GB,
  })
  await makeVpnUser(db, r.id, {
    dataLimitBytes: 10 * GB,
    usedTrafficBytes: 8 * GB,
  })
  await makeVpnUser(db, r.id, {
    dataLimitBytes: null,
    usedTrafficBytes: 99 * GB,
  })
  const debtor = await makeVpnUser(db, r.id)
  await db.insert(billingEvents).values({
    id: 'be1',
    resellerId: r.id,
    vpnUserId: debtor.id,
    marzbanUsername: debtor.marzbanUsername,
    type: 'create',
    dataLimitGb: 1,
    pricePerGbToman: 1,
    amountToman: 1,
    actorUserId: r.id,
  })
  const paid = await makeVpnUser(db, r.id)
  await db.insert(billingEvents).values({
    id: 'be2',
    resellerId: r.id,
    vpnUserId: paid.id,
    marzbanUsername: paid.marzbanUsername,
    type: 'create',
    dataLimitGb: 1,
    pricePerGbToman: 1,
    amountToman: 1,
    actorUserId: r.id,
    settledAt: new Date(),
  })

  expect(await names(viewCondition('expiring', now))).toEqual([
    soon.marzbanUsername,
  ])
  expect(await names(viewCondition('high_usage', now))).toEqual([
    heavy.marzbanUsername,
  ])
  expect(await names(viewCondition('unpaid', now))).toEqual([
    debtor.marzbanUsername,
  ])
})

it('matches labels exactly, not as substrings', async () => {
  const r = await makeReseller(db)
  const vip = await makeVpnUser(db, r.id, {
    labels: JSON.stringify(['vip', 'friend']),
  })
  await makeVpnUser(db, r.id, { labels: JSON.stringify(['vipers']) })
  expect(await names(labelCondition('vip'))).toEqual([vip.marzbanUsername])
  expect(await names(labelCondition('50%'))).toEqual([])
  expect(parseLabels('not json')).toEqual([])
  expect(normalizeLabels([' a ', 'a', '', 'b'])).toEqual(['a', 'b'])
})

it('suspends and resumes only what the suspension disabled', async () => {
  const r = await makeReseller(db)
  const a = await makeVpnUser(db, r.id, { status: 'active' })
  const b = await makeVpnUser(db, r.id, { status: 'active' })
  const selfDisabled = await makeVpnUser(db, r.id, { status: 'disabled' })
  const calls: string[] = []
  const modify = async (u: string, p: { status: string }) => {
    if (
      u === b.marzbanUsername &&
      p.status === 'disabled' &&
      !calls.includes('retry')
    ) {
      calls.push('retry')
      throw new Error('upstream down')
    }
    calls.push(`${u}:${p.status}`)
  }

  const first = await suspendReseller(r.id, { db, modify })
  expect(first.changed).toBe(1)
  expect(first.failed).toEqual([
    { username: b.marzbanUsername, error: 'upstream down' },
  ])
  const [profile] = await db
    .select()
    .from(resellerProfiles)
    .where(eq(resellerProfiles.userId, r.id))
  expect(profile?.status).toBe('disabled')

  // retry picks up only the one that failed
  const second = await suspendReseller(r.id, { db, modify })
  expect(second.changed).toBe(1)
  expect(second.failed).toEqual([])

  const resumed = await resumeReseller(r.id, { db, modify })
  expect(resumed.changed).toBe(2)
  const rows = await db
    .select()
    .from(vpnUsers)
    .where(eq(vpnUsers.resellerId, r.id))
  const byId = Object.fromEntries(rows.map((x) => [x.id, x]))
  expect(byId[a.id]?.status).toBe('active')
  expect(byId[b.id]?.status).toBe('active')
  expect(byId[selfDisabled.id]?.status).toBe('disabled')
  expect(byId[a.id]?.suspendedAt).toBeNull()
  expect(calls).not.toContain(`${selfDisabled.marzbanUsername}:active`)
})
