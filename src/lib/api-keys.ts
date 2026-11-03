import { and, desc, eq, gt, isNull } from 'drizzle-orm'

import { db as defaultDb } from '#/db'
import { apiKeys } from '#/db/schema'
import type { Db } from '#/db/types'

const PREFIX = 'mzg_'
const TOKEN_PATTERN = /^mzg_[A-Za-z0-9_-]{43}$/
const DAY = 24 * 60 * 60 * 1000

async function hashToken(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  )
  return Buffer.from(bytes).toString('hex')
}

export async function createApiKey(
  userId: string,
  name: string,
  expiresInDays: 30 | 90 | 365,
  { db = defaultDb, now = new Date() }: { db?: Db; now?: Date } = {},
) {
  const token =
    PREFIX +
    Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
      'base64url',
    )
  const row = {
    id: crypto.randomUUID(),
    userId,
    name: name.trim(),
    tokenHash: await hashToken(token),
    createdAt: now,
    expiresAt: new Date(now.getTime() + expiresInDays * DAY),
  }
  await db.insert(apiKeys).values(row)
  return {
    token,
    key: {
      id: row.id,
      name: row.name,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      lastUsedAt: null,
      revokedAt: null,
    },
  }
}

export async function resolveApiKey(
  token: string,
  { db = defaultDb, now = new Date() }: { db?: Db; now?: Date } = {},
) {
  if (!TOKEN_PATTERN.test(token)) return null
  const [row] = await db
    .select({ id: apiKeys.id, userId: apiKeys.userId })
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.tokenHash, await hashToken(token)),
        isNull(apiKeys.revokedAt),
        gt(apiKeys.expiresAt, now),
      ),
    )
    .limit(1)
  if (!row) return null
  await db
    .update(apiKeys)
    .set({ lastUsedAt: now })
    .where(eq(apiKeys.id, row.id))
  return row
}

export async function listApiKeys(userId: string, database: Db = defaultDb) {
  const rows = await database
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      createdAt: apiKeys.createdAt,
      expiresAt: apiKeys.expiresAt,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(desc(apiKeys.createdAt))
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  }))
}

export async function revokeApiKey(
  userId: string,
  id: string,
  database: Db = defaultDb,
) {
  const rows = await database
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiKeys.id, id),
        eq(apiKeys.userId, userId),
        isNull(apiKeys.revokedAt),
      ),
    )
    .returning({ id: apiKeys.id })
  return rows.length > 0
}
