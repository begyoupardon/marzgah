import { and, eq, isNotNull, isNull } from 'drizzle-orm'

import { db as defaultDb } from '#/db'
import { resellerProfiles, vpnUsers } from '#/db/schema'
import type { Db } from '#/db/types'
import { getBackend } from '#/lib/backends/registry'

type Modify = (
  username: string,
  patch: { status: 'active' | 'disabled' },
  backendId?: string,
) => Promise<unknown>

export type SuspensionResult = {
  changed: number
  failed: Array<{ username: string; error: string }>
}

const defaultModify: Modify = (username, patch, backendId) =>
  getBackend(backendId).updateUser(username, patch)

/**
 * Disable the reseller and every currently active user. Users are only marked
 * once Marzban confirms, so a partial failure is safe to retry.
 */
export async function suspendReseller(
  resellerId: string,
  {
    db = defaultDb,
    modify = defaultModify,
    now = new Date(),
  }: { db?: Db; modify?: Modify; now?: Date } = {},
): Promise<SuspensionResult> {
  await db
    .update(resellerProfiles)
    .set({ status: 'disabled' })
    .where(eq(resellerProfiles.userId, resellerId))

  const targets = await db
    .select({
      id: vpnUsers.id,
      username: vpnUsers.marzbanUsername,
      backend: vpnUsers.backend,
    })
    .from(vpnUsers)
    .where(
      and(
        eq(vpnUsers.resellerId, resellerId),
        eq(vpnUsers.status, 'active'),
        isNull(vpnUsers.removedAt),
        isNull(vpnUsers.suspendedAt),
      ),
    )

  const result: SuspensionResult = { changed: 0, failed: [] }
  for (const t of targets) {
    try {
      await modify(t.username, { status: 'disabled' }, t.backend)
      await db
        .update(vpnUsers)
        .set({ status: 'disabled', suspendedAt: now })
        .where(eq(vpnUsers.id, t.id))
      result.changed++
    } catch (error) {
      result.failed.push({
        username: t.username,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return result
}

/** Re-enable only the users this suspension disabled, never ones the seller disabled themselves. */
export async function resumeReseller(
  resellerId: string,
  { db = defaultDb, modify = defaultModify }: { db?: Db; modify?: Modify } = {},
): Promise<SuspensionResult> {
  await db
    .update(resellerProfiles)
    .set({ status: 'active' })
    .where(eq(resellerProfiles.userId, resellerId))

  const targets = await db
    .select({
      id: vpnUsers.id,
      username: vpnUsers.marzbanUsername,
      backend: vpnUsers.backend,
    })
    .from(vpnUsers)
    .where(
      and(
        eq(vpnUsers.resellerId, resellerId),
        isNotNull(vpnUsers.suspendedAt),
        isNull(vpnUsers.removedAt),
      ),
    )

  const result: SuspensionResult = { changed: 0, failed: [] }
  for (const t of targets) {
    try {
      await modify(t.username, { status: 'active' }, t.backend)
      await db
        .update(vpnUsers)
        .set({ status: 'active', suspendedAt: null })
        .where(eq(vpnUsers.id, t.id))
      result.changed++
    } catch (error) {
      result.failed.push({
        username: t.username,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return result
}
