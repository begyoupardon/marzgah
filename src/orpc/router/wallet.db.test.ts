import { expect, it } from 'bun:test'

import { callAs, setupRouterTest } from '../../../test/helpers/orpc'
import { makeReseller, makeUser } from '../../../test/helpers/factories'

const db = await setupRouterTest()
const wallet = await import('./wallet')
const adminRouter = await import('./admin')

const admin = await makeUser(db, 'admin')
const alice = await makeReseller(db)
const bob = await makeReseller(db)

it('requires authentication', async () => {
  await expect(callAs(wallet.myWallet, undefined, null)).rejects.toMatchObject({
    code: 'UNAUTHORIZED',
  })
})

it('keeps admin-only procedures away from resellers', async () => {
  await expect(
    callAs(
      wallet.adjustWallet,
      {
        resellerId: alice.id,
        type: 'credit',
        amountToman: 1000,
        reason: 'nope nope',
      },
      alice.id,
    ),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  await expect(
    callAs(
      wallet.setBalance,
      { resellerId: alice.id, targetBalanceToman: 1000 },
      alice.id,
    ),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  await expect(
    callAs(
      wallet.setCreditLimit,
      { resellerId: alice.id, creditLimitToman: 1000 },
      alice.id,
    ),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' })
})

it('admins have no wallet', async () => {
  await expect(
    callAs(wallet.myWallet, undefined, admin.id),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' })
})

it('admin adjustments are audited and cannot overdraw', async () => {
  await callAs(
    wallet.adjustWallet,
    {
      resellerId: bob.id,
      type: 'credit',
      amountToman: 5000,
      reason: 'goodwill',
    },
    admin.id,
  )
  await expect(
    callAs(
      wallet.adjustWallet,
      {
        resellerId: bob.id,
        type: 'debit',
        amountToman: 9000,
        reason: 'oops oops',
      },
      admin.id,
    ),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  const w = (await callAs(
    wallet.resellerWallet,
    { resellerId: bob.id },
    admin.id,
  )) as { balanceToman: number }
  expect(w.balanceToman).toBe(5000)
})

it('enforces credit limits through setCreditLimit', async () => {
  await callAs(
    wallet.setCreditLimit,
    { resellerId: alice.id, creditLimitToman: 50_000 },
    admin.id,
  )
  const w = (await callAs(wallet.myWallet, undefined, alice.id)) as {
    creditLimitToman: number | null
  }
  expect(w.creditLimitToman).toBe(50_000)
})

it('admin can set target balance directly for a reseller', async () => {
  await callAs(
    wallet.setBalance,
    { resellerId: alice.id, targetBalanceToman: 350_000 },
    admin.id,
  )
  const afterCredit = (await callAs(wallet.myWallet, undefined, alice.id)) as {
    balanceToman: number
  }
  expect(afterCredit.balanceToman).toBe(350_000)

  // Direct reduction
  await callAs(
    wallet.setBalance,
    { resellerId: alice.id, targetBalanceToman: 100_000 },
    admin.id,
  )
  const afterDebit = (await callAs(wallet.myWallet, undefined, alice.id)) as {
    balanceToman: number
  }
  expect(afterDebit.balanceToman).toBe(100_000)
})

it('creates reseller with initial balance and credit limit', async () => {
  const created = (await callAs(
    adminRouter.createReseller,
    {
      email: 'reseller-init@example.com',
      name: 'Init Reseller',
      password: 'pass',
      usernameSuffix: 'init',
      pricePerGbToman: 15000,
      initialBalanceToman: 200_000,
      creditLimitToman: 100_000,
    },
    admin.id,
  )) as { id: string }

  const w = (await callAs(
    wallet.resellerWallet,
    { resellerId: created.id },
    admin.id,
  )) as { balanceToman: number; creditLimitToman: number | null }
  expect(w.balanceToman).toBe(200_000)
  expect(w.creditLimitToman).toBe(100_000)
})
