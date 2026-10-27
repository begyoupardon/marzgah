import { account, resellerProfiles, user, vpnUsers } from '#/db/schema'
import type { Db } from '#/db/types'

let counter = 0
const next = () => ++counter

export async function makeUser(
  db: Db,
  role: 'admin' | 'reseller' = 'reseller',
  overrides: Partial<typeof user.$inferInsert> = {},
) {
  const n = next()
  const row = {
    id: `u${n}`,
    name: `${role} ${n}`,
    email: `${role}${n}@example.test`,
    emailVerified: false,
    role,
    ...overrides,
  }
  await db.insert(user).values(row)
  await db.insert(account).values({
    id: `a${n}`,
    accountId: row.id,
    providerId: 'credential',
    userId: row.id,
    password: 'x',
  })
  return row
}

export async function makeReseller(
  db: Db,
  overrides: Partial<typeof resellerProfiles.$inferInsert> = {},
) {
  const u = await makeUser(db, 'reseller')
  await db.insert(resellerProfiles).values({
    id: `rp${next()}`,
    userId: u.id,
    usernameSuffix: `r${next()}`,
    pricePerGbToman: 1000,
    ...overrides,
  })
  return u
}

export async function makeVpnUser(
  db: Db,
  resellerId: string,
  overrides: Partial<typeof vpnUsers.$inferInsert> = {},
) {
  const n = next()
  const row = {
    id: `v${n}`,
    resellerId,
    marzbanUsername: `user_${n}`,
    status: 'active',
    ...overrides,
  }
  await db.insert(vpnUsers).values(row as typeof vpnUsers.$inferInsert)
  return row
}
