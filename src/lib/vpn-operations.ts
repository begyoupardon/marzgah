import { and, eq, inArray, lt } from 'drizzle-orm'

import { db } from '#/db'
import { auditLogs, billingEvents, resellerProfiles } from '#/db/schema'
import { getBackend } from '#/lib/backends/registry'
import { BackendError } from '#/lib/backends/types'
import { insertBillingEvent } from '#/lib/ledger'
import {
  softRemoveMirroredVpnUser,
  syncVpnUserFromMarzban,
} from '#/lib/marzban/sync'
import { billingGbFromBytes } from '#/lib/billing'
import { withKeyedLock } from '#/lib/keyed-lock'

const pendingActions = [
  'vpn_user.pending_create',
  'vpn_user.pending_create_cleanup',
  'vpn_user.pending_renew',
]

type CreateOperation = { kind: 'create'; backend: string }
type RenewOperation = {
  kind: 'renew'
  backend: string
  vpnUserId: string
  dataLimitBytes: number
  expireAt: string | null
  durationMonths: number | null
  durationDays: number | null
  pricePerGbToman: number
  reactivate: boolean
}
type Operation = CreateOperation | RenewOperation

export async function beginVpnOperation(input: {
  username: string
  resellerId: string
  actorUserId: string
  operation: Operation
}) {
  const pending = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.vpnUsername, input.username),
        inArray(auditLogs.action, pendingActions),
      ),
    )
    .limit(1)
  if (pending.length) throw new Error('A VPN operation is awaiting recovery')
  const id = crypto.randomUUID()
  await db.insert(auditLogs).values({
    id,
    actorUserId: input.actorUserId,
    actorRole: 'system',
    action: `vpn_user.pending_${input.operation.kind}`,
    entityType: 'vpn_operation',
    vpnUsername: input.username,
    resellerId: input.resellerId,
    payloadJson: JSON.stringify(input.operation),
  })
  return id
}

export async function hasPendingVpnOperation(username: string) {
  const rows = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.vpnUsername, username),
        inArray(auditLogs.action, pendingActions),
      ),
    )
    .limit(1)
  return rows.length > 0
}

export async function finishVpnOperation(id: string) {
  await db
    .update(auditLogs)
    .set({ action: 'vpn_user.operation_complete' })
    .where(eq(auditLogs.id, id))
}

export async function markVpnUserCreated(id: string) {
  await db
    .update(auditLogs)
    .set({ action: 'vpn_user.pending_create_cleanup' })
    .where(eq(auditLogs.id, id))
}

async function repair(row: typeof auditLogs.$inferSelect) {
  if (row.action === 'vpn_user.pending_create') {
    // A remote conflict and a successful create look the same without a receipt.
    await db
      .update(auditLogs)
      .set({ action: 'vpn_user.create_review' })
      .where(eq(auditLogs.id, row.id))
    return
  }
  const operation = JSON.parse(row.payloadJson!) as Operation
  const username = row.vpnUsername!
  const backend = getBackend(operation.backend)
  if (operation.kind === 'create') {
    const [bill] = await db
      .select({ id: billingEvents.id })
      .from(billingEvents)
      .where(eq(billingEvents.marzbanUsername, username))
      .limit(1)
    if (!bill) {
      try {
        await backend.deleteUser(username)
      } catch (error) {
        if (!(error instanceof BackendError && error.code === 'NOT_FOUND'))
          throw error
      }
      await softRemoveMirroredVpnUser(username, { reason: 'create_recovery' })
    }
  } else {
    const remote = await backend.getUser(username)
    const expireAt = operation.expireAt ? new Date(operation.expireAt) : null
    const [profile] = await db
      .select({ status: resellerProfiles.status })
      .from(resellerProfiles)
      .where(eq(resellerProfiles.userId, row.resellerId!))
      .limit(1)
    const reactivate = operation.reactivate && profile?.status === 'active'
    if (
      remote.dataLimitBytes !== operation.dataLimitBytes ||
      remote.expireAt?.getTime() !== expireAt?.getTime() ||
      (reactivate && remote.status !== 'active')
    ) {
      await backend.resetUsage(username)
      await backend.updateUser(username, {
        dataLimitBytes: operation.dataLimitBytes,
        expireAt,
        ...(reactivate ? { status: 'active' as const } : {}),
      })
    }
    await syncVpnUserFromMarzban(username)
    await insertBillingEvent({
      id: row.id,
      resellerId: row.resellerId!,
      vpnUserId: operation.vpnUserId,
      marzbanUsername: username,
      type: 'renew',
      dataLimitGb: billingGbFromBytes(operation.dataLimitBytes),
      durationMonths: operation.durationMonths,
      durationDays: operation.durationDays,
      pricePerGbToman: operation.pricePerGbToman,
      actorUserId: row.actorUserId!,
    })
  }
  await finishVpnOperation(row.id)
}

export async function repairVpnOperations() {
  const rows = await db
    .select()
    .from(auditLogs)
    .where(
      and(
        inArray(auditLogs.action, pendingActions),
        lt(auditLogs.createdAt, new Date(Date.now() - 30_000)),
      ),
    )
    .limit(50)
  for (const row of rows) {
    try {
      await withKeyedLock(row.resellerId!, () => repair(row))
    } catch (error) {
      console.error('VPN operation recovery failed', row.id, error)
    }
  }
  return rows.length
}
