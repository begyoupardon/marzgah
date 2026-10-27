import { ORPCError } from '@orpc/server'
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import * as z from 'zod'

import { db } from '#/db'
import { billingEvents, resellerProfiles, user } from '#/db/schema'
import {
  canAdminSettle,
  canAdminUnsettle,
  canResellerClaim,
  summarizeByReseller,
  summarizeLedger,
} from '#/lib/billing'
import { serializeBillingRow, writeAuditLog } from '#/lib/ledger'
import { adminOnly, authed } from '../middleware'

function mapEvent(row: typeof billingEvents.$inferSelect) {
  return serializeBillingRow(row)
}

export const myBillingSummary = authed.handler(async ({ context }) => {
  const resellerId = context.user.role === 'admin' ? null : context.user.id

  if (!resellerId) {
    throw new ORPCError('FORBIDDEN', {
      message: 'ادمین از خلاصه نمایندگان استفاده کند',
    })
  }

  const rows = await db
    .select()
    .from(billingEvents)
    .where(eq(billingEvents.resellerId, resellerId))
    .orderBy(desc(billingEvents.createdAt))

  const mapped = rows.map(mapEvent)
  return {
    summary: summarizeLedger(mapped),
    events: mapped,
  }
})

export const adminBillingSummary = adminOnly
  .input(
    z.object({
      resellerId: z.string().optional(),
    }),
  )
  .handler(async ({ input }) => {
    const rows = input.resellerId
      ? await db
          .select()
          .from(billingEvents)
          .where(eq(billingEvents.resellerId, input.resellerId))
          .orderBy(desc(billingEvents.createdAt))
      : await db
          .select()
          .from(billingEvents)
          .orderBy(desc(billingEvents.createdAt))

    const mapped = rows.map(mapEvent)
    const byReseller = summarizeByReseller(
      mapped.map((r) => ({
        ...r,
        resellerId: r.resellerId,
      })),
    )

    const resellers = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        usernameSuffix: resellerProfiles.usernameSuffix,
        pricePerGbToman: resellerProfiles.pricePerGbToman,
        status: resellerProfiles.status,
      })
      .from(resellerProfiles)
      .innerJoin(user, eq(user.id, resellerProfiles.userId))

    const resellerMap = new Map(resellers.map((r) => [r.id, r]))

    return {
      summary: summarizeLedger(mapped),
      byReseller: byReseller.map((item) => ({
        ...item,
        reseller: resellerMap.get(item.resellerId) ?? null,
      })),
      events: mapped,
      resellers,
    }
  })

export const claimBillingPaid = authed
  .input(z.object({ eventId: z.string().min(1) }))
  .handler(async ({ input, context }) => {
    if (context.user.role !== 'reseller') {
      throw new ORPCError('FORBIDDEN', {
        message: 'فقط نماینده می‌تواند پرداخت را اعلام کند',
      })
    }

    const [row] = await db
      .select()
      .from(billingEvents)
      .where(eq(billingEvents.id, input.eventId))
      .limit(1)

    if (!row) {
      throw new ORPCError('NOT_FOUND', { message: 'ردیف مالی یافت نشد' })
    }

    if (!canResellerClaim(row, context.user.id)) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'این ردیف قابل اعلام پرداخت نیست',
      })
    }

    await db
      .update(billingEvents)
      .set({
        claimedPaidAt: new Date(),
        claimedByUserId: context.user.id,
      })
      .where(eq(billingEvents.id, row.id))

    await writeAuditLog({
      actorUserId: context.user.id,
      actorRole: 'reseller',
      action: 'billing.claim_paid',
      entityType: 'billing_event',
      entityId: row.id,
      vpnUsername: row.marzbanUsername,
      resellerId: row.resellerId,
      payload: { amountToman: row.amountToman },
    })

    const [updated] = await db
      .select()
      .from(billingEvents)
      .where(eq(billingEvents.id, row.id))
      .limit(1)

    if (!updated) {
      throw new ORPCError('NOT_FOUND', { message: 'ردیف مالی یافت نشد' })
    }

    return mapEvent(updated)
  })

export const settleBillingEvent = adminOnly
  .input(z.object({ eventId: z.string().min(1) }))
  .handler(async ({ input, context }) => {
    const [row] = await db
      .select()
      .from(billingEvents)
      .where(eq(billingEvents.id, input.eventId))
      .limit(1)

    if (!row) {
      throw new ORPCError('NOT_FOUND', { message: 'ردیف مالی یافت نشد' })
    }

    if (!canAdminSettle(row)) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'این ردیف قبلاً تسویه شده است',
      })
    }

    await db
      .update(billingEvents)
      .set({
        settledAt: new Date(),
        settledByUserId: context.user.id,
      })
      .where(eq(billingEvents.id, row.id))

    await writeAuditLog({
      actorUserId: context.user.id,
      actorRole: 'admin',
      action: 'billing.settle',
      entityType: 'billing_event',
      entityId: row.id,
      vpnUsername: row.marzbanUsername,
      resellerId: row.resellerId,
      payload: { amountToman: row.amountToman },
    })

    const [updated] = await db
      .select()
      .from(billingEvents)
      .where(eq(billingEvents.id, row.id))
      .limit(1)

    if (!updated) {
      throw new ORPCError('NOT_FOUND', { message: 'ردیف مالی یافت نشد' })
    }

    return mapEvent(updated)
  })

export const unsettleBillingEvent = adminOnly
  .input(z.object({ eventId: z.string().min(1) }))
  .handler(async ({ input, context }) => {
    const [row] = await db
      .select()
      .from(billingEvents)
      .where(eq(billingEvents.id, input.eventId))
      .limit(1)

    if (!row) {
      throw new ORPCError('NOT_FOUND', { message: 'ردیف مالی یافت نشد' })
    }

    if (!canAdminUnsettle(row)) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'این ردیف تسویه نشده است',
      })
    }

    await db
      .update(billingEvents)
      .set({
        settledAt: null,
        settledByUserId: null,
      })
      .where(eq(billingEvents.id, row.id))

    await writeAuditLog({
      actorUserId: context.user.id,
      actorRole: 'admin',
      action: 'billing.unsettle',
      entityType: 'billing_event',
      entityId: row.id,
      vpnUsername: row.marzbanUsername,
      resellerId: row.resellerId,
      payload: { amountToman: row.amountToman },
    })

    const [updated] = await db
      .select()
      .from(billingEvents)
      .where(eq(billingEvents.id, row.id))
      .limit(1)

    if (!updated) {
      throw new ORPCError('NOT_FOUND', { message: 'ردیف مالی یافت نشد' })
    }

    return mapEvent(updated)
  })

export const listOutstandingBilling = authed
  .input(
    z
      .object({
        resellerId: z.string().optional(),
        status: z.enum(['all', 'outstanding', 'claimed', 'settled']).optional(),
      })
      .optional(),
  )
  .handler(async ({ input, context }) => {
    const status = input?.status ?? 'all'
    const resellerId =
      context.user.role === 'admin' ? input?.resellerId : context.user.id

    const conditions = []
    if (resellerId) {
      conditions.push(eq(billingEvents.resellerId, resellerId))
    }
    if (status === 'settled') {
      conditions.push(isNotNull(billingEvents.settledAt))
    } else if (status === 'outstanding') {
      conditions.push(isNull(billingEvents.settledAt))
      conditions.push(isNull(billingEvents.claimedPaidAt))
    } else if (status === 'claimed') {
      conditions.push(isNull(billingEvents.settledAt))
      conditions.push(isNotNull(billingEvents.claimedPaidAt))
    }

    const rows = await db
      .select()
      .from(billingEvents)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(billingEvents.createdAt))

    return rows.map(mapEvent)
  })
