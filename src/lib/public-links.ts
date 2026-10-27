import { and, eq, gt, isNull, or } from 'drizzle-orm'

import { db as defaultDb } from '#/db'
import {
  renewalRequests,
  resellerProfiles,
  subscriptionTokens,
  user,
  vpnUsers,
} from '#/db/schema'
import type { Db } from '#/db/types'

type Deps = { db?: Db; now?: Date }

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/
const DAY = 24 * 60 * 60 * 1000

async function hash(token: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  )
  return Buffer.from(digest).toString('hex')
}

/**
 * Issue a new link, revoking any earlier one for the same customer. The raw
 * token is returned once and never stored.
 */
export async function createLink(
  vpnUserId: string,
  {
    expiresInDays,
    db = defaultDb,
    now = new Date(),
  }: Deps & { expiresInDays?: number | null } = {},
) {
  const token = Buffer.from(
    crypto.getRandomValues(new Uint8Array(24)),
  ).toString('base64url')
  await revokeLinks(vpnUserId, { db, now })
  const expiresAt = expiresInDays
    ? new Date(now.getTime() + expiresInDays * DAY)
    : null
  await db.insert(subscriptionTokens).values({
    id: crypto.randomUUID(),
    vpnUserId,
    tokenHash: await hash(token),
    expiresAt,
  })
  return { token, expiresAt }
}

export async function revokeLinks(
  vpnUserId: string,
  { db = defaultDb, now = new Date() }: Deps = {},
) {
  const revoked = await db
    .update(subscriptionTokens)
    .set({ revokedAt: now })
    .where(
      and(
        eq(subscriptionTokens.vpnUserId, vpnUserId),
        isNull(subscriptionTokens.revokedAt),
      ),
    )
    .returning({ id: subscriptionTokens.id })
  return revoked.length
}

/**
 * Resolve a link to its customer. Every failure (malformed, unknown, revoked,
 * expired, removed user) returns the same null so callers can't tell them apart.
 */
export async function resolveToken(
  token: string,
  { db = defaultDb, now = new Date() }: Deps = {},
) {
  if (!TOKEN_PATTERN.test(token)) return null
  const [row] = await db
    .select({
      vpnUser: vpnUsers,
      sellerName: user.name,
      publicName: resellerProfiles.publicName,
      supportContact: resellerProfiles.supportContact,
    })
    .from(subscriptionTokens)
    .innerJoin(vpnUsers, eq(vpnUsers.id, subscriptionTokens.vpnUserId))
    .innerJoin(user, eq(user.id, vpnUsers.resellerId))
    .leftJoin(
      resellerProfiles,
      eq(resellerProfiles.userId, vpnUsers.resellerId),
    )
    .where(
      and(
        eq(subscriptionTokens.tokenHash, await hash(token)),
        isNull(subscriptionTokens.revokedAt),
        or(
          isNull(subscriptionTokens.expiresAt),
          gt(subscriptionTokens.expiresAt, now),
        ),
        isNull(vpnUsers.removedAt),
      ),
    )
    .limit(1)
  if (!row) return null
  const [pending] = await db
    .select({ id: renewalRequests.id })
    .from(renewalRequests)
    .where(
      and(
        eq(renewalRequests.vpnUserId, row.vpnUser.id),
        eq(renewalRequests.status, 'pending'),
      ),
    )
    .limit(1)
  return { ...row, hasPendingRenewal: Boolean(pending) }
}
