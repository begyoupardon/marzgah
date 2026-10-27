import { expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'

import {
  makeReseller,
  makeUser,
  makeVpnUser,
} from '../../test/helpers/factories'
import { mockDb } from '../../test/helpers/db'
import { auditLogs, billingEvents } from '#/db/schema'

const db = await mockDb()
const { writeAuditLog, insertBillingEvent } = await import('./ledger')
const { credit, getBalance } = await import('./wallet')
const { createCredentialUser, countUsers } = await import('./create-user')

it('persists audit logs against a real database', async () => {
  const admin = await makeUser(db, 'admin')
  const reseller = await makeReseller(db)
  await writeAuditLog({
    actorUserId: admin.id,
    actorRole: 'admin',
    action: 'reseller.update',
    entityType: 'reseller',
    resellerId: reseller.id,
    payload: { a: 1 },
  })
  const rows = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.resellerId, reseller.id))
  expect(rows).toHaveLength(1)
  expect(rows[0]?.action).toBe('reseller.update')
})

it('creates credential users atomically and rejects duplicates', async () => {
  const before = await countUsers()
  await createCredentialUser({
    email: 'New@Example.test',
    name: 'New',
    password: 'correct-horse-battery',
    role: 'admin',
  })
  expect(await countUsers()).toBe(before + 1)
  await expect(
    createCredentialUser({
      email: 'new@example.test',
      name: 'Dup',
      password: 'correct-horse-battery',
      role: 'admin',
    }),
  ).rejects.toThrow('User already exists')
})

async function sell(resellerId: string, gb: number) {
  const v = await makeVpnUser(db, resellerId)
  return insertBillingEvent({
    resellerId,
    vpnUserId: v.id,
    marzbanUsername: v.marzbanUsername,
    type: 'create',
    dataLimitGb: gb,
    pricePerGbToman: 1000,
    actorUserId: resellerId,
  })
}

it('auto-settles a sale from the wallet when funded', async () => {
  const r = await makeReseller(db)
  await credit(
    {
      resellerId: r.id,
      amountToman: 15_000,
      reason: 't',
      provider: 'test',
      reference: r.id,
    },
    db,
  )
  const sale = await sell(r.id, 10)
  const [ev] = await db
    .select()
    .from(billingEvents)
    .where(eq(billingEvents.id, sale.id))
  expect(ev?.settledAt).not.toBeNull()
  expect(await getBalance(r.id, db)).toBe(5_000)
})

it('leaves a sale outstanding (legacy post-paid) when unfunded', async () => {
  const r = await makeReseller(db)
  const sale = await sell(r.id, 10)
  const [ev] = await db
    .select()
    .from(billingEvents)
    .where(eq(billingEvents.id, sale.id))
  expect(ev?.settledAt).toBeNull()
  expect(await getBalance(r.id, db)).toBe(0)
})
