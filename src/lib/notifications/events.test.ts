import { expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'

import { createTestDb } from '../../../test/helpers/db'
import { makeReseller, makeVpnUser } from '../../../test/helpers/factories'
import { notifications } from '#/db/schema'
import { credit } from '#/lib/wallet'
import {
  runAllScans,
  scanExpiring,
  scanLowTraffic,
  scanLowWallet,
} from './events'

const db = await createTestDb()
const GB = 1024 ** 3
const NOW = new Date('2026-06-01T00:00:00Z')
const for_ = async (userId: string) =>
  await db.select().from(notifications).where(eq(notifications.userId, userId))

it('warns once per expiry date for users ending within 3 days', async () => {
  const r = await makeReseller(db)
  const soon = await makeVpnUser(db, r.id, {
    expireAt: new Date('2026-06-03T12:00:00Z'),
  })
  await makeVpnUser(db, r.id, { expireAt: new Date('2026-06-20T00:00:00Z') }) // too far
  await makeVpnUser(db, r.id, { expireAt: new Date('2026-05-30T00:00:00Z') }) // already expired
  await makeVpnUser(db, r.id, {
    expireAt: new Date('2026-06-02T00:00:00Z'),
    status: 'disabled',
  })
  await makeVpnUser(db, r.id, {
    expireAt: new Date('2026-06-02T00:00:00Z'),
    removedAt: new Date(),
  })

  expect(await scanExpiring({ db, now: NOW })).toBe(1)
  expect(
    await scanExpiring({ db, now: new Date(NOW.getTime() + 3_600_000) }),
  ).toBe(0) // re-run is a no-op
  const rows = await for_(r.id)
  expect(rows).toHaveLength(1)
  expect(rows[0]?.text).toContain(soon.marzbanUsername)

  // after a renewal the new expiry date warns again
  await db
    .update((await import('#/db/schema')).vpnUsers)
    .set({ expireAt: new Date('2026-06-04T00:00:00Z') })
    .where(eq((await import('#/db/schema')).vpnUsers.id, soon.id))
  expect(
    await scanExpiring({ db, now: new Date('2026-06-02T00:00:00Z') }),
  ).toBe(1)
})

it('warns about high usage once per quota cycle', async () => {
  const r = await makeReseller(db)
  await makeVpnUser(db, r.id, {
    dataLimitBytes: 10 * GB,
    usedTrafficBytes: 9.5 * GB,
  })
  await makeVpnUser(db, r.id, {
    dataLimitBytes: 10 * GB,
    usedTrafficBytes: 5 * GB,
  })
  await makeVpnUser(db, r.id, {
    dataLimitBytes: null,
    usedTrafficBytes: 99 * GB,
  })
  expect(await scanLowTraffic({ db, now: NOW })).toBeGreaterThanOrEqual(1)
  expect(await scanLowTraffic({ db, now: NOW })).toBe(0)
  const rows = await for_(r.id)
  expect(rows).toHaveLength(1)
  expect(rows[0]?.text).toContain('۹۵')
})

it('nags about a low wallet only for wallet users, once a week', async () => {
  const legacy = await makeReseller(db) // never used the wallet
  const funded = await makeReseller(db)
  await credit(
    {
      resellerId: funded.id,
      amountToman: 10_000,
      reason: 't',
      provider: 'test',
      reference: funded.id,
    },
    db,
  )
  const healthy = await makeReseller(db)
  await credit(
    {
      resellerId: healthy.id,
      amountToman: 5_000_000,
      reason: 't',
      provider: 'test',
      reference: healthy.id,
    },
    db,
  )

  await scanLowWallet({ db, now: NOW })
  expect(await for_(legacy.id)).toHaveLength(0)
  expect(await for_(healthy.id)).toHaveLength(0)
  expect(await for_(funded.id)).toHaveLength(1)
  await scanLowWallet({ db, now: new Date(NOW.getTime() + 2 * 86_400_000) })
  expect(await for_(funded.id)).toHaveLength(1) // same week
  await scanLowWallet({ db, now: new Date(NOW.getTime() + 9 * 86_400_000) })
  expect(await for_(funded.id)).toHaveLength(2) // next week
})

it('runAllScans reports counts for each producer', async () => {
  const result = await runAllScans({
    db,
    now: new Date('2027-01-01T00:00:00Z'),
  })
  expect(Object.keys(result).sort()).toEqual([
    'expiring',
    'lowTraffic',
    'lowWallet',
  ])
})
