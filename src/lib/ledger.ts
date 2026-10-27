import { db } from '#/db'
import { settleEventFromWallet } from '#/lib/wallet'
import { auditLogs, billingEvents } from '#/db/schema'
import { amountToman } from '#/lib/billing'
import type { BillingEventType } from '#/lib/billing'

export type AuditActorRole = 'admin' | 'reseller' | 'system'

export async function writeAuditLog(input: {
  actorUserId?: string | null
  actorRole: AuditActorRole
  action: string
  entityType: string
  entityId?: string | null
  vpnUsername?: string | null
  resellerId?: string | null
  payload?: unknown
}) {
  const id = crypto.randomUUID()
  await db.insert(auditLogs).values({
    id,
    actorUserId: input.actorUserId ?? null,
    actorRole: input.actorRole,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    vpnUsername: input.vpnUsername ?? null,
    resellerId: input.resellerId ?? null,
    payloadJson:
      input.payload === undefined ? null : JSON.stringify(input.payload),
  })
  return id
}

export async function insertBillingEvent(input: {
  resellerId: string
  vpnUserId: string
  marzbanUsername: string
  type: BillingEventType
  dataLimitGb: number
  durationMonths?: number | null
  pricePerGbToman: number
  actorUserId: string
}) {
  const id = crypto.randomUUID()
  const amount = amountToman(input.dataLimitGb, input.pricePerGbToman)
  await db.insert(billingEvents).values({
    id,
    resellerId: input.resellerId,
    vpnUserId: input.vpnUserId,
    marzbanUsername: input.marzbanUsername,
    type: input.type,
    dataLimitGb: input.dataLimitGb,
    durationMonths: input.durationMonths ?? null,
    pricePerGbToman: input.pricePerGbToman,
    amountToman: amount,
    actorUserId: input.actorUserId,
  })
  // Pay from the wallet when it covers the charge. Best effort: the event is
  // already recorded, so a failure here must not fail the sale.
  try {
    await settleEventFromWallet(id)
  } catch (error) {
    console.error('wallet auto-settle failed', error)
  }
  return { id, amountToman: amount }
}

export function serializeAuditRow(row: typeof auditLogs.$inferSelect) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    payload: row.payloadJson ? (JSON.parse(row.payloadJson) as unknown) : null,
  }
}

export function serializeBillingRow(row: typeof billingEvents.$inferSelect) {
  return {
    id: row.id,
    resellerId: row.resellerId,
    vpnUserId: row.vpnUserId,
    marzbanUsername: row.marzbanUsername,
    type: row.type,
    dataLimitGb: row.dataLimitGb,
    durationMonths: row.durationMonths,
    pricePerGbToman: row.pricePerGbToman,
    amountToman: row.amountToman,
    actorUserId: row.actorUserId,
    claimedPaidAt: row.claimedPaidAt?.toISOString() ?? null,
    claimedByUserId: row.claimedByUserId,
    settledAt: row.settledAt?.toISOString() ?? null,
    settledByUserId: row.settledByUserId,
    createdAt: row.createdAt.toISOString(),
  }
}
