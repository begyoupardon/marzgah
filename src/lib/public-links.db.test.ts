import { expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'

import { createTestDb } from '../../test/helpers/db'
import { makeReseller, makeVpnUser } from '../../test/helpers/factories'
import {
  notifications,
  resellerProfiles,
  subscriptionTokens,
  vpnUsers,
} from '#/db/schema'
import { createLink, resolveToken, revokeLinks } from './public-links'
import {
  RenewalError,
  cleanMessage,
  getRenewal,
  listPendingRenewals,
  markDecided,
  requestRenewal,
  reopen,
} from './renewals'

const db = await createTestDb()
const T0 = new Date('2026-04-01T00:00:00Z')

async function customer() {
  const seller = await makeReseller(db)
  const row = await makeVpnUser(db, seller.id)
  return { seller, row }
}

it('issues an unguessable token and stores only its hash', async () => {
  const { row } = await customer()
  const { token } = await createLink(row.id, { db, now: T0 })
  expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/)
  const stored = await db
    .select()
    .from(subscriptionTokens)
    .where(eq(subscriptionTokens.vpnUserId, row.id))
  expect(stored).toHaveLength(1)
  expect(JSON.stringify(stored)).not.toContain(token)
  expect((await resolveToken(token, { db, now: T0 }))?.vpnUser.id).toBe(row.id)
})

it('a new link revokes the old one', async () => {
  const { row } = await customer()
  const a = await createLink(row.id, { db, now: T0 })
  const b = await createLink(row.id, { db, now: T0 })
  expect(await resolveToken(a.token, { db, now: T0 })).toBeNull()
  expect(await resolveToken(b.token, { db, now: T0 })).not.toBeNull()
})

it('returns the same null for every kind of bad link', async () => {
  const { row } = await customer()
  const ok = await createLink(row.id, { db, now: T0, expiresInDays: 7 })
  expect(await resolveToken('short', { db, now: T0 })).toBeNull()
  expect(await resolveToken('x'.repeat(32), { db, now: T0 })).toBeNull()
  expect(
    await resolveToken("' OR 1=1 --".padEnd(32, 'a'), { db, now: T0 }),
  ).toBeNull()
  // expired
  expect(
    await resolveToken(ok.token, {
      db,
      now: new Date(T0.getTime() + 8 * 86_400_000),
    }),
  ).toBeNull()
  // revoked
  expect(await revokeLinks(row.id, { db, now: T0 })).toBe(1)
  expect(await resolveToken(ok.token, { db, now: T0 })).toBeNull()
  // removed customer
  const live = await createLink(row.id, { db, now: T0 })
  await db
    .update(vpnUsers)
    .set({ removedAt: T0 })
    .where(eq(vpnUsers.id, row.id))
  expect(await resolveToken(live.token, { db, now: T0 })).toBeNull()
})

it('never exposes another customer through a link, and carries seller branding', async () => {
  const a = await customer()
  const b = await customer()
  await db
    .update(resellerProfiles)
    .set({ publicName: 'Acme VPN', supportContact: '@acme' })
    .where(eq(resellerProfiles.userId, a.seller.id))
  const linkA = await createLink(a.row.id, { db, now: T0 })
  await createLink(b.row.id, { db, now: T0 })
  const view = (await resolveToken(linkA.token, { db, now: T0 }))!
  expect(view.vpnUser.marzbanUsername).toBe(a.row.marzbanUsername)
  expect(view.publicName).toBe('Acme VPN')
  expect(view.supportContact).toBe('@acme')
})

it('records one open renewal request per customer and tells the seller', async () => {
  const { seller, row } = await customer()
  const first = await requestRenewal(
    { vpnUserId: row.id, months: 2, message: ' سلام\n\tتمدید لطفا ' },
    { db, now: T0 },
  )
  await expect(
    requestRenewal({ vpnUserId: row.id, months: 1 }, { db, now: T0 }),
  ).rejects.toMatchObject({ code: 'ALREADY_PENDING' })
  const pending = await listPendingRenewals(seller.id, db)
  expect(pending).toHaveLength(1)
  expect(pending[0]).toMatchObject({
    id: first.id,
    months: 2,
    message: 'سلام تمدید لطفا',
    username: row.marzbanUsername,
  })
  expect(
    (
      await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, seller.id))
    ).map((n) => n.event),
  ).toEqual(['renewal_requested'])
})

it('validates months, existence and message size', async () => {
  const { row } = await customer()
  await expect(
    requestRenewal({ vpnUserId: row.id, months: 0 }, { db }),
  ).rejects.toBeInstanceOf(RenewalError)
  await expect(
    requestRenewal({ vpnUserId: row.id, months: 4 }, { db }),
  ).rejects.toMatchObject({ code: 'BAD_INPUT' })
  await expect(
    requestRenewal({ vpnUserId: 'nope', months: 1 }, { db }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  expect(cleanMessage('x'.repeat(500))).toHaveLength(200)
  expect(cleanMessage('   ')).toBeNull()
})

it('a request can be decided once; reopening allows a retry', async () => {
  const { seller, row } = await customer()
  const { id } = await requestRenewal(
    { vpnUserId: row.id, months: 1 },
    { db, now: T0 },
  )
  expect(await markDecided(id, 'approved', seller.id, { db, now: T0 })).toBe(
    true,
  )
  expect(await markDecided(id, 'rejected', seller.id, { db, now: T0 })).toBe(
    false,
  )
  expect((await getRenewal(id, db))?.request.status).toBe('approved')
  await reopen(id, db)
  expect((await getRenewal(id, db))?.request.status).toBe('pending')
  // once decided, the customer may ask again
  await markDecided(id, 'rejected', seller.id, { db, now: T0 })
  await requestRenewal({ vpnUserId: row.id, months: 1 }, { db, now: T0 })
})
