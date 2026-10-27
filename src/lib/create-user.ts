import { hashPassword } from 'better-auth/crypto'
import { and, count, eq } from 'drizzle-orm'

import { db } from '#/db'
import { account, resellerProfiles, user } from '#/db/schema'

export async function countUsers() {
  const [row] = await db.select({ c: count() }).from(user)
  return Number(row?.c ?? 0)
}

export async function createCredentialUser(options: {
  email: string
  name: string
  password: string
  role: 'admin' | 'reseller'
}) {
  const email = options.email.trim().toLowerCase()
  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1)

  if (existing) {
    throw new Error('User already exists')
  }

  const id = crypto.randomUUID()
  const hashed = await hashPassword(options.password)

  await db.batch([
    db.insert(user).values({
      id,
      email,
      name: options.name,
      emailVerified: false,
      role: options.role,
    }),
    db.insert(account).values({
      id: crypto.randomUUID(),
      accountId: id,
      providerId: 'credential',
      userId: id,
      password: hashed,
    }),
  ])

  return { id, email, name: options.name, role: options.role }
}

/** Update credential password with no length/complexity rules. */
export async function setCredentialPassword(userId: string, password: string) {
  const [existing] = await db
    .select({ id: account.id })
    .from(account)
    .where(
      and(eq(account.userId, userId), eq(account.providerId, 'credential')),
    )
    .limit(1)

  if (!existing) {
    throw new Error('Credential account not found')
  }

  const hashed = await hashPassword(password)
  await db
    .update(account)
    .set({ password: hashed, updatedAt: new Date() })
    .where(eq(account.id, existing.id))
}

export async function ensureResellerProfile(
  userId: string,
  options: {
    usernameSuffix: string
    pricePerGbToman: number
    notes?: string | null
    status?: 'active' | 'disabled'
    allowUnlimitedExpire?: boolean
    creditLimitToman?: number | null
  },
) {
  const [existing] = await db
    .select()
    .from(resellerProfiles)
    .where(eq(resellerProfiles.userId, userId))
    .limit(1)

  if (existing) {
    await db
      .update(resellerProfiles)
      .set({
        usernameSuffix: options.usernameSuffix,
        pricePerGbToman: options.pricePerGbToman,
        notes: options.notes !== undefined ? options.notes : existing.notes,
        status: options.status ?? existing.status,
        allowUnlimitedExpire:
          options.allowUnlimitedExpire ?? existing.allowUnlimitedExpire,
        ...(options.creditLimitToman !== undefined
          ? { creditLimitToman: options.creditLimitToman }
          : {}),
      })
      .where(eq(resellerProfiles.id, existing.id))
    return existing.id
  }

  const id = crypto.randomUUID()
  await db.insert(resellerProfiles).values({
    id,
    userId,
    status: options.status ?? 'active',
    usernameSuffix: options.usernameSuffix,
    pricePerGbToman: options.pricePerGbToman,
    allowUnlimitedExpire: options.allowUnlimitedExpire ?? false,
    notes: options.notes ?? null,
    creditLimitToman: options.creditLimitToman ?? null,
  })
  return id
}
