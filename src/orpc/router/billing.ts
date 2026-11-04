import { ORPCError } from '@orpc/server'
import { and, desc, eq, gte, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import * as z from 'zod'

import { db } from '#/db'
import { billingEvents, resellerProfiles, user } from '#/db/schema'
import {
  canAdminSettle,
  canAdminUnsettle,
  canResellerClaim,
} from '#/lib/billing'
import { serializeBillingRow, writeAuditLog } from '#/lib/ledger'
import { adminOnly, authed } from '../middleware'
import { outputSpec } from '../openapi-response'

function mapEvent(row: typeof billingEvents.$inferSelect) {
  return serializeBillingRow(row)
}

const pageInput = z.object({
  page: z.number().int().min(1).default(1),
  status: z.enum(['all', 'outstanding', 'claimed', 'settled']).default('all'),
  dayStarts: z
    .array(z.number().int().nonnegative().max(8_640_000_000_000_000))
    .length(15)
    .refine((starts) =>
      starts.every((start, i) => i === 0 || start > starts[i - 1]),
    )
    .optional(),
})

const totals = {
  soldGb: sql<number>`coalesce(sum(${billingEvents.dataLimitGb}), 0)`,
  totalToman: sql<number>`coalesce(sum(${billingEvents.amountToman}), 0)`,
  settledToman: sql<number>`coalesce(sum(case when ${billingEvents.settledAt} is not null then ${billingEvents.amountToman} else 0 end), 0)`,
  claimedToman: sql<number>`coalesce(sum(case when ${billingEvents.settledAt} is null and ${billingEvents.claimedPaidAt} is not null then ${billingEvents.amountToman} else 0 end), 0)`,
  outstandingToman: sql<number>`coalesce(sum(case when ${billingEvents.settledAt} is null then ${billingEvents.amountToman} else 0 end), 0)`,
  eventCount: sql<number>`count(*)`,
}

function summary(row: Record<keyof typeof totals, number> | undefined) {
  return {
    soldGb: Math.round(Number(row?.soldGb ?? 0) * 100) / 100,
    totalToman: Number(row?.totalToman ?? 0),
    settledToman: Number(row?.settledToman ?? 0),
    claimedToman: Number(row?.claimedToman ?? 0),
    outstandingToman: Number(row?.outstandingToman ?? 0),
    eventCount: Number(row?.eventCount ?? 0),
  }
}

function statusCondition(status: z.infer<typeof pageInput>['status']) {
  if (status === 'settled') return isNotNull(billingEvents.settledAt)
  if (status === 'claimed')
    return and(
      isNull(billingEvents.settledAt),
      isNotNull(billingEvents.claimedPaidAt),
    )
  if (status === 'outstanding')
    return and(
      isNull(billingEvents.settledAt),
      isNull(billingEvents.claimedPaidAt),
    )
  return undefined
}

async function eventPage(
  resellerId: string | undefined,
  page: number,
  status: z.infer<typeof pageInput>['status'],
) {
  const where = and(
    resellerId ? eq(billingEvents.resellerId, resellerId) : undefined,
    statusCondition(status),
  )
  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(billingEvents)
    .where(where)
  const rows = await db
    .select()
    .from(billingEvents)
    .where(where)
    .orderBy(desc(billingEvents.createdAt), desc(billingEvents.id))
    .limit(50)
    .offset((page - 1) * 50)
  return {
    events: rows.map(mapEvent),
    pageCount: Math.ceil(Number(countRow?.count ?? 0) / 50),
  }
}

async function chartTotals(
  resellerId: string | undefined,
  dayStarts?: number[],
) {
  if (!dayStarts) return null
  const owner = resellerId
    ? eq(billingEvents.resellerId, resellerId)
    : undefined
  const day = sql<number>`case ${sql.join(
    dayStarts
      .slice(1)
      .map((end, i) => sql`when ${billingEvents.createdAt} < ${end} then ${i}`),
    sql` `,
  )} end`
  const [days, types] = await Promise.all([
    db
      .select({ day, amount: sql<number>`sum(${billingEvents.amountToman})` })
      .from(billingEvents)
      .where(
        and(
          owner,
          gte(billingEvents.createdAt, new Date(dayStarts[0])),
          lt(billingEvents.createdAt, new Date(dayStarts[14])),
        ),
      )
      .groupBy(day),
    db
      .select({
        type: billingEvents.type,
        amount: sql<number>`sum(${billingEvents.amountToman})`,
      })
      .from(billingEvents)
      .where(owner)
      .groupBy(billingEvents.type),
  ])
  const daily = Array<number>(14).fill(0)
  for (const row of days) daily[Number(row.day)] = Number(row.amount)
  const byType = { create: 0, renew: 0, extra_gb: 0 }
  for (const row of types) byType[row.type] = Number(row.amount)
  return { daily, byType }
}

export const myBillingSummary = authed
  .route({
    summary: 'Get my billing summary',
    description:
      'Use this operation to get my billing summary under the caller’s current role and ownership rules.',
    tags: ['Billing'],
    spec: outputSpec('billing.myBillingSummary'),
  })
  .input(pageInput.optional())
  .handler(async ({ input, context }) => {
    const resellerId = context.user.role === 'admin' ? null : context.user.id

    if (!resellerId) {
      throw new ORPCError('FORBIDDEN', {
        message: 'ادمین از خلاصه نمایندگان استفاده کند',
      })
    }

    const [row] = await db
      .select(totals)
      .from(billingEvents)
      .where(eq(billingEvents.resellerId, resellerId))
    return {
      summary: summary(row),
      charts: await chartTotals(resellerId, input?.dayStarts),
      ...(await eventPage(
        resellerId,
        input?.page ?? 1,
        input?.status ?? 'all',
      )),
    }
  })

export const adminBillingSummary = adminOnly
  .route({
    summary: 'Get admin billing summary',
    description:
      'Use this operation to get admin billing summary under the caller’s current role and ownership rules.',
    tags: ['Billing'],
    spec: outputSpec('billing.adminBillingSummary'),
  })
  .input(
    pageInput
      .extend({
        resellerId: z.string().optional(),
      })
      .optional(),
  )
  .handler(async ({ input }) => {
    const [totalRows, byReseller] = await Promise.all([
      db
        .select(totals)
        .from(billingEvents)
        .where(
          input?.resellerId
            ? eq(billingEvents.resellerId, input.resellerId)
            : undefined,
        ),
      db
        .select({ resellerId: billingEvents.resellerId, ...totals })
        .from(billingEvents)
        .where(
          input?.resellerId
            ? eq(billingEvents.resellerId, input.resellerId)
            : undefined,
        )
        .groupBy(billingEvents.resellerId),
    ])

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
      summary: summary(totalRows[0]),
      charts: await chartTotals(input?.resellerId, input?.dayStarts),
      byReseller: byReseller.map((item) => ({
        ...summary(item),
        resellerId: item.resellerId,
        reseller: resellerMap.get(item.resellerId) ?? null,
      })),
      ...(await eventPage(
        input?.resellerId,
        input?.page ?? 1,
        input?.status ?? 'all',
      )),
      resellers,
    }
  })

export const claimBillingPaid = authed
  .route({
    summary: 'Claim billing payment',
    description:
      'Use this operation to claim billing payment under the caller’s current role and ownership rules.',
    tags: ['Billing'],
    spec: outputSpec('billing.claimBillingPaid'),
  })
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
  .route({
    summary: 'Settle billing event',
    description:
      'Use this operation to settle billing event under the caller’s current role and ownership rules.',
    tags: ['Billing'],
    spec: outputSpec('billing.settleBillingEvent'),
  })
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
  .route({
    summary: 'Unsettle billing event',
    description:
      'Use this operation to unsettle billing event under the caller’s current role and ownership rules.',
    tags: ['Billing'],
    spec: outputSpec('billing.unsettleBillingEvent'),
  })
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
  .route({
    summary: 'List outstanding billing',
    description:
      'Use this operation to list outstanding billing under the caller’s current role and ownership rules.',
    tags: ['Billing'],
    spec: outputSpec('billing.listOutstandingBilling'),
  })
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
