import { eq } from 'drizzle-orm'

import { db } from '#/db'
import { vpnUsers } from '#/db/schema'
import { writeAuditLog } from '#/lib/ledger'
import { toBackendUser } from '#/lib/backends/marzban'
import { DEFAULT_BACKEND_ID, getBackend } from '#/lib/backends/registry'
import { BackendError } from '#/lib/backends/types'
import type { BackendUser } from '#/lib/backends/types'
import { resolveSubscriptionUrl } from './subscription-url.ts'
import type { MarzbanUserResponse } from './types.ts'

/** What we store locally for a user the backend reported. */
export function mapBackendUserToMirror(
  user: BackendUser,
  resellerId: string,
  existingId?: string,
) {
  return {
    id: existingId ?? crypto.randomUUID(),
    resellerId,
    marzbanUsername: user.username,
    status: user.status,
    dataLimitBytes: user.dataLimitBytes,
    usedTrafficBytes: user.usedBytes,
    expireAt: user.expireAt,
    subscriptionUrl: resolveSubscriptionUrl(user.subscriptionUrl),
    note: user.note,
    lastSyncedAt: new Date(),
  }
}

/** @deprecated Marzban-shaped input; kept so existing callers and tests keep working. */
export function mapMarzbanUserToMirror(
  marzbanUser: MarzbanUserResponse,
  resellerId: string,
  existingId?: string,
) {
  return mapBackendUserToMirror(
    toBackendUser(marzbanUser),
    resellerId,
    existingId,
  )
}

/**
 * Soft-remove local mirror. Never hard-deletes VPN or billing rows.
 */
export async function softRemoveMirroredVpnUser(
  username: string,
  meta?: {
    actorUserId?: string | null
    actorRole?: 'admin' | 'reseller' | 'system'
    reason?: string
  },
) {
  const [existing] = await db
    .select()
    .from(vpnUsers)
    .where(eq(vpnUsers.marzbanUsername, username))
    .limit(1)

  if (!existing) return null

  const removedAt = existing.removedAt ?? new Date()
  await db
    .update(vpnUsers)
    .set({
      status: 'disabled',
      removedAt,
      lastSyncedAt: new Date(),
    })
    .where(eq(vpnUsers.id, existing.id))

  await writeAuditLog({
    actorUserId: meta?.actorUserId ?? null,
    actorRole: meta?.actorRole ?? 'system',
    action: 'vpn_user.soft_remove',
    entityType: 'vpn_user',
    entityId: existing.id,
    vpnUsername: username,
    resellerId: existing.resellerId,
    payload: { reason: meta?.reason ?? 'remote_or_local_remove' },
  })

  return { ...existing, status: 'disabled' as const, removedAt }
}

/** @deprecated Use softRemoveMirroredVpnUser — hard delete is forbidden for anti-fraud. */
export async function deleteMirroredVpnUser(username: string) {
  return softRemoveMirroredVpnUser(username, { reason: 'legacy_delete_alias' })
}

export async function syncVpnUserFromMarzban(
  username: string,
  options?: {
    resellerId?: string
    createIfMissing?: boolean
    /** When true, move an existing mirror to the given resellerId and clear soft-remove. */
    reassign?: boolean
    repairInbounds?: boolean
  },
) {
  const [existing] = await db
    .select()
    .from(vpnUsers)
    .where(eq(vpnUsers.marzbanUsername, username))
    .limit(1)

  // The stored id is the registry key, so it always resolves back to this backend.
  const backendId = existing?.backend ?? DEFAULT_BACKEND_ID
  const backend = getBackend(backendId)
  let remoteUser: BackendUser
  try {
    // The backend heals what it knows how to heal (e.g. missing inbound tags).
    remoteUser = await backend.getUser(username, {
      repair: options?.repairInbounds !== false,
    })
  } catch (error) {
    if (error instanceof BackendError && error.code === 'NOT_FOUND') {
      // Keep local + ledger rows; only soft-disable.
      if (existing) {
        await softRemoveMirroredVpnUser(username, {
          reason: 'marzban_404',
        })
      }
      return existing
        ? {
            ...existing,
            status: 'disabled' as const,
            removedAt: existing.removedAt ?? new Date(),
          }
        : null
    }
    throw error
  }

  const resellerId = options?.resellerId ?? existing?.resellerId
  if (!resellerId) {
    if (!options?.createIfMissing) {
      // Orphan remote user with no local owner — skip mirror insert
      return null
    }
    throw new Error(`No resellerId for vpn user ${username}`)
  }

  const values = mapBackendUserToMirror(remoteUser, resellerId, existing?.id)

  if (existing) {
    const nextResellerId =
      options?.reassign && options.resellerId
        ? options.resellerId
        : existing.resellerId
    await db
      .update(vpnUsers)
      .set({
        ...(options?.reassign && options.resellerId
          ? { resellerId: options.resellerId, removedAt: null }
          : {}),
        status: values.status,
        dataLimitBytes: values.dataLimitBytes,
        usedTrafficBytes: values.usedTrafficBytes,
        expireAt: values.expireAt,
        subscriptionUrl: values.subscriptionUrl,
        note: values.note,
        lastSyncedAt: values.lastSyncedAt,
      })
      .where(eq(vpnUsers.id, existing.id))
    return {
      ...existing,
      ...values,
      resellerId: nextResellerId,
      removedAt:
        options?.reassign && options.resellerId ? null : existing.removedAt,
    }
  }

  await db.insert(vpnUsers).values({ ...values, backend: backendId })
  return { ...values, backend: backendId, removedAt: null }
}

/** Refresh only the authorized page, with bounded upstream concurrency. */
export async function refreshVpnUserMirrors<
  T extends {
    marzbanUsername: string
    removedAt: Date | null
    lastSyncedAt?: Date | null
  },
>(rows: T[]) {
  const refreshed = [...rows]
  let failed = false
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(5, rows.length) }, async () => {
      while (!failed && next < rows.length) {
        const index = next++
        if (rows[index].removedAt) continue
        const lastSyncedAt = rows[index].lastSyncedAt
        if (lastSyncedAt && Date.now() - lastSyncedAt.getTime() < 30_000)
          continue
        try {
          const mirror = await syncVpnUserFromMarzban(
            rows[index].marzbanUsername,
            {
              repairInbounds: false,
            },
          )
          if (mirror) refreshed[index] = { ...rows[index], ...mirror }
        } catch {
          failed = true
        }
      }
    }),
  )
  return { rows: refreshed, failed }
}
