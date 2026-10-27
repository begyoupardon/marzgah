import { expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'

import { createTestDb } from '../../test/helpers/db'
import { makeReseller, makeVpnUser } from '../../test/helpers/factories'
import { billingEvents, resellerProfiles } from '#/db/schema'
import {
  InsufficientFundsError,
  assertCanSpend,
  credit,
  debit,
  getBalance,
  settleEventFromWallet,
} from './wallet'

const db = await createTestDb()
const move = (resellerId: string, amountToman: number, reference: string) => ({
  resellerId,
  amountToman,
  reason: 'test',
  provider: 'test',
  reference: `${resellerId}:${reference}`,
})

it('computes balance as credits minus debits', async () => {
  const r = await makeReseller(db)
  await credit(move(r.id, 1000, 'c1'), db)
  await debit(move(r.id, 300, 'd1'), db)
  expect(await getBalance(r.id, db)).toBe(700)
})

it('is idempotent per (provider, reference)', async () => {
  const r = await makeReseller(db)
  expect((await credit(move(r.id, 500, 'same'), db)).applied).toBe(true)
  expect((await credit(move(r.id, 500, 'same'), db)).applied).toBe(false)
  expect(await getBalance(r.id, db)).toBe(500)
  await debit(move(r.id, 200, 'dd'), db)
  expect((await debit(move(r.id, 200, 'dd'), db)).applied).toBe(false)
  expect(await getBalance(r.id, db)).toBe(300)
})

it('refuses to overdraw, even under concurrency', async () => {
  const r = await makeReseller(db)
  await credit(move(r.id, 1000, 'seed'), db)
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, (_, i) => debit(move(r.id, 400, `race${i}`), db)),
  )
  expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(2)
  const rejected = results.filter((x) => x.status === 'rejected')
  expect(rejected).toHaveLength(3)
  expect(rejected[0].reason).toBeInstanceOf(InsufficientFundsError)
  expect(await getBalance(r.id, db)).toBe(200)
})

it('allows a bounded overdraft', async () => {
  const r = await makeReseller(db)
  await debit({ ...move(r.id, 100, 'o1'), overdraftToman: 150 }, db)
  expect(await getBalance(r.id, db)).toBe(-100)
  await expect(
    debit({ ...move(r.id, 100, 'o2'), overdraftToman: 150 }, db),
  ).rejects.toBeInstanceOf(InsufficientFundsError)
})

it('rejects non-positive or fractional amounts', async () => {
  const r = await makeReseller(db)
  await expect(credit(move(r.id, 0, 'z'), db)).rejects.toBeInstanceOf(
    RangeError,
  )
  await expect(credit(move(r.id, 1.5, 'f'), db)).rejects.toBeInstanceOf(
    RangeError,
  )
})

async function makeEvent(resellerId: string, amount: number) {
  const v = await makeVpnUser(db, resellerId)
  const id = crypto.randomUUID()
  await db.insert(billingEvents).values({
    id,
    resellerId,
    vpnUserId: v.id,
    marzbanUsername: v.marzbanUsername,
    type: 'create',
    dataLimitGb: 10,
    pricePerGbToman: amount / 10,
    amountToman: amount,
    actorUserId: resellerId,
  })
  return id
}

it('settles a billing event from the wallet exactly once', async () => {
  const r = await makeReseller(db)
  const id = await makeEvent(r.id, 1000)
  expect(await settleEventFromWallet(id, db)).toBe('insufficient')
  await credit(move(r.id, 1500, 'topup'), db)
  expect(await settleEventFromWallet(id, db)).toBe('settled')
  expect(await settleEventFromWallet(id, db)).toBe('already_settled')
  expect(await getBalance(r.id, db)).toBe(500)
  const [ev] = await db
    .select()
    .from(billingEvents)
    .where(eq(billingEvents.id, id))
  expect(ev?.settledAt).not.toBeNull()
})

it('recovers if a crash left the debit without the settle', async () => {
  const r = await makeReseller(db)
  const id = await makeEvent(r.id, 400)
  await credit(move(r.id, 1000, 'topup'), db)
  await debit(
    {
      resellerId: r.id,
      amountToman: 400,
      reason: 'x',
      provider: 'billing',
      reference: id,
    },
    db,
  )
  expect(await settleEventFromWallet(id, db)).toBe('settled')
  expect(await getBalance(r.id, db)).toBe(600)
})

it('enforces the credit limit only when one is set', async () => {
  const legacy = await makeReseller(db)
  await assertCanSpend(legacy.id, 10_000_000, db)

  const limited = await makeReseller(db, { creditLimitToman: 1000 })
  await assertCanSpend(limited.id, 1000, db)
  await expect(assertCanSpend(limited.id, 1001, db)).rejects.toBeInstanceOf(
    InsufficientFundsError,
  )

  await makeEvent(limited.id, 600)
  await expect(assertCanSpend(limited.id, 500, db)).rejects.toBeInstanceOf(
    InsufficientFundsError,
  )
  await credit(move(limited.id, 700, 'topup'), db)
  await assertCanSpend(limited.id, 1000, db)
  await db
    .update(resellerProfiles)
    .set({ creditLimitToman: 0 })
    .where(eq(resellerProfiles.userId, limited.id))
})
