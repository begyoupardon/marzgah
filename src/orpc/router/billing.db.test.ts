import { expect, it } from 'bun:test'

import { billingEvents } from '#/db/schema'
import {
  makeReseller,
  makeUser,
  makeVpnUser,
} from '../../../test/helpers/factories'
import { callAs, setupRouterTest } from '../../../test/helpers/orpc'

const db = await setupRouterTest()
const seller = await makeReseller(db)
const admin = await makeUser(db, 'admin')
const vpnUser = await makeVpnUser(db, seller.id)
const billing = await import('./billing')

it('keeps full ledger totals while paging and filtering event rows', async () => {
  await db.insert(billingEvents).values(
    Array.from({ length: 51 }, (_, i) => ({
      id: `sale-${i}`,
      resellerId: seller.id,
      vpnUserId: vpnUser.id,
      marzbanUsername: vpnUser.marzbanUsername,
      type: 'create' as const,
      dataLimitGb: 1,
      pricePerGbToman: 1000,
      amountToman: 1000,
      actorUserId: seller.id,
      settledAt: i === 0 ? new Date() : null,
    })),
  )

  const first = (await callAs(
    billing.myBillingSummary,
    { page: 1, status: 'all' },
    seller.id,
  )) as {
    summary: { totalToman: number; settledToman: number; eventCount: number }
    events: unknown[]
    pageCount: number
  }
  expect(first.summary).toMatchObject({
    totalToman: 51_000,
    settledToman: 1000,
    eventCount: 51,
  })
  expect(first.events).toHaveLength(50)
  expect(first.pageCount).toBe(2)
  const second = (await callAs(
    billing.myBillingSummary,
    { page: 2, status: 'all' },
    seller.id,
  )) as { events: unknown[] }
  expect(second.events).toHaveLength(1)
  const filtered = (await callAs(
    billing.adminBillingSummary,
    { status: 'settled' },
    admin.id,
  )) as {
    summary: { totalToman: number }
    events: unknown[]
    pageCount: number
  }
  expect(filtered.summary.totalToman).toBe(51_000)
  expect(filtered.events).toHaveLength(1)
  expect(filtered.pageCount).toBe(1)
})
