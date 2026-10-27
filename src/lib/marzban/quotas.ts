import { and, count, eq, isNull, sum } from 'drizzle-orm'

import { db } from '#/db'
import { resellerProfiles, vpnUsers } from '#/db/schema'

export class QuotaExceededError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QuotaExceededError'
  }
}

export async function getResellerProfile(userId: string) {
  const [profile] = await db
    .select()
    .from(resellerProfiles)
    .where(eq(resellerProfiles.userId, userId))
    .limit(1)

  return profile ?? null
}

const GB = 1024 ** 3

/**
 * Throws when the reseller is disabled or adding `addBytes` of quota would
 * exceed their user-count or total-GB caps (NULL caps mean unlimited).
 */
export async function assertCanCreateVpnUser(
  resellerUserId: string,
  addBytes = 0,
) {
  const profile = await getResellerProfile(resellerUserId)
  if (!profile) {
    throw new QuotaExceededError('Reseller profile not found')
  }
  if (profile.status !== 'active') {
    throw new QuotaExceededError('Reseller account is disabled')
  }

  if (profile.maxUsers != null || profile.maxTotalGb != null) {
    const [row] = await db
      .select({ users: count(), bytes: sum(vpnUsers.dataLimitBytes) })
      .from(vpnUsers)
      .where(
        and(
          eq(vpnUsers.resellerId, resellerUserId),
          isNull(vpnUsers.removedAt),
        ),
      )
    if (
      profile.maxUsers != null &&
      Number(row?.users ?? 0) + 1 > profile.maxUsers
    ) {
      throw new QuotaExceededError(`User limit reached (${profile.maxUsers})`)
    }
    if (
      profile.maxTotalGb != null &&
      Number(row?.bytes ?? 0) + addBytes > profile.maxTotalGb * GB
    ) {
      throw new QuotaExceededError(
        `Total data limit reached (${profile.maxTotalGb} GB)`,
      )
    }
  }

  return profile
}

export async function getOwnedVpnUser(
  marzbanUsername: string,
  resellerUserId: string,
  isAdmin: boolean,
) {
  const [row] = await db
    .select()
    .from(vpnUsers)
    .where(eq(vpnUsers.marzbanUsername, marzbanUsername))
    .limit(1)

  if (!row) return null
  if (!isAdmin && row.resellerId !== resellerUserId) return null
  return row
}
