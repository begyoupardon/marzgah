import { ORPCError, call } from '@orpc/server'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import * as z from 'zod'

import { db } from '#/db'
import { billingEvents, resellerProfiles, vpnUsers } from '#/db/schema'
import { parseCsv, toCsv } from '#/lib/csv'
import { writeAuditLog } from '#/lib/ledger'
import { getOwnedVpnUser } from '#/lib/marzban/quotas'
import { resumeReseller, suspendReseller } from '#/lib/reseller-suspension'
import { getSetting, setSetting } from '#/lib/settings'
import {
  labelCondition,
  normalizeLabels,
  parseLabels,
  viewCondition,
} from '#/lib/user-filters'
import { adminOnly, authed } from '../middleware'
import { createVpnUser, renewVpnUser } from './vpn-users'

const GB = 1024 ** 3
const EXPORT_CAP = 5000

const actorRole = (role: string) => (role === 'admin' ? 'admin' : 'reseller')

/** Only the caller's own users unless they are an admin. */
function scope(user: { id: string; role: string }, resellerId?: string) {
  return user.role === 'admin' ? resellerId : user.id
}

// ── customer details ──────────────────────────────────────────────────────

export const updateUserContact = authed
  .input(
    z.object({
      username: z.string().min(1),
      phone: z.string().trim().max(32).nullable().optional(),
      telegram: z.string().trim().max(64).nullable().optional(),
      labels: z.array(z.string()).max(20).optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const owned = await getOwnedVpnUser(
      input.username,
      context.user.id,
      context.user.role === 'admin',
    )
    if (!owned || owned.removedAt)
      throw new ORPCError('NOT_FOUND', { message: 'کاربر VPN پیدا نشد' })

    const patch: Partial<typeof vpnUsers.$inferInsert> = {}
    if (input.phone !== undefined) patch.contactPhone = input.phone || null
    if (input.telegram !== undefined)
      patch.contactTelegram = input.telegram?.replace(/^@/, '') || null
    if (input.labels !== undefined)
      patch.labels = JSON.stringify(normalizeLabels(input.labels))
    if (Object.keys(patch).length === 0) return { ok: true }

    await db.update(vpnUsers).set(patch).where(eq(vpnUsers.id, owned.id))
    await writeAuditLog({
      actorUserId: context.user.id,
      actorRole: actorRole(context.user.role),
      action: 'vpn_user.contact',
      entityType: 'vpn_user',
      entityId: owned.id,
      vpnUsername: owned.marzbanUsername,
      resellerId: owned.resellerId,
      payload: {
        before: {
          phone: owned.contactPhone,
          telegram: owned.contactTelegram,
          labels: parseLabels(owned.labels),
        },
        after: {
          phone: patch.contactPhone ?? owned.contactPhone,
          telegram: patch.contactTelegram ?? owned.contactTelegram,
          labels: patch.labels
            ? parseLabels(patch.labels)
            : parseLabels(owned.labels),
        },
      },
    })
    return { ok: true }
  })

export const bulkLabel = authed
  .input(
    z.object({
      usernames: z.array(z.string()).min(1).max(200),
      add: z.array(z.string()).max(10).default([]),
      remove: z.array(z.string()).max(10).default([]),
    }),
  )
  .handler(async ({ input, context }) => {
    const own = scope(context.user)
    const rows = await db
      .select()
      .from(vpnUsers)
      .where(
        and(
          inArray(vpnUsers.marzbanUsername, input.usernames),
          isNull(vpnUsers.removedAt),
          own ? eq(vpnUsers.resellerId, own) : undefined,
        ),
      )
    const drop = new Set(input.remove)
    for (const row of rows) {
      const next = normalizeLabels([
        ...parseLabels(row.labels).filter((l) => !drop.has(l)),
        ...input.add,
      ])
      await db
        .update(vpnUsers)
        .set({ labels: JSON.stringify(next) })
        .where(eq(vpnUsers.id, row.id))
    }
    return {
      updated: rows.length,
      skipped: input.usernames.length - rows.length,
    }
  })

// ── CSV export ────────────────────────────────────────────────────────────

export const exportUsers = authed
  .input(
    z
      .object({
        resellerId: z.string().optional(),
        view: z.enum(['expiring', 'high_usage', 'unpaid']).optional(),
        label: z.string().max(30).optional(),
        status: z
          .enum(['active', 'disabled', 'limited', 'expired', 'on_hold'])
          .optional(),
      })
      .default({}),
  )
  .handler(async ({ input, context }) => {
    const conditions: SQL[] = [isNull(vpnUsers.removedAt)]
    const own = scope(context.user, input.resellerId)
    if (own) conditions.push(eq(vpnUsers.resellerId, own))
    if (input.status) conditions.push(eq(vpnUsers.status, input.status))
    if (input.view) conditions.push(viewCondition(input.view))
    if (input.label) conditions.push(labelCondition(input.label))

    const rows = await db
      .select()
      .from(vpnUsers)
      .where(and(...conditions))
      .orderBy(desc(vpnUsers.createdAt))
      .limit(EXPORT_CAP)

    const csv = toCsv([
      [
        'username',
        'status',
        'data_limit_gb',
        'used_gb',
        'expires_at',
        'phone',
        'telegram',
        'labels',
        'note',
      ],
      ...rows.map((r) => [
        r.marzbanUsername,
        r.status,
        r.dataLimitBytes == null ? '' : +(r.dataLimitBytes / GB).toFixed(2),
        +(r.usedTrafficBytes / GB).toFixed(2),
        r.expireAt?.toISOString() ?? '',
        r.contactPhone ?? '',
        r.contactTelegram ?? '',
        parseLabels(r.labels).join('|'),
        r.note ?? '',
      ]),
    ])
    return { filename: 'users.csv', csv, truncated: rows.length === EXPORT_CAP }
  })

export const exportBilling = authed
  .input(
    z
      .object({
        resellerId: z.string().optional(),
        settled: z.boolean().optional(),
      })
      .default({}),
  )
  .handler(async ({ input, context }) => {
    const own = scope(context.user, input.resellerId)
    const conditions: SQL[] = []
    if (own) conditions.push(eq(billingEvents.resellerId, own))
    if (input.settled === true)
      conditions.push(sql`${billingEvents.settledAt} is not null`)
    if (input.settled === false)
      conditions.push(isNull(billingEvents.settledAt))
    const rows = await db
      .select()
      .from(billingEvents)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(billingEvents.createdAt))
      .limit(EXPORT_CAP)
    const csv = toCsv([
      [
        'date',
        'username',
        'type',
        'gb',
        'price_per_gb',
        'amount_toman',
        'settled',
      ],
      ...rows.map((r) => [
        r.createdAt.toISOString(),
        r.marzbanUsername,
        r.type,
        r.dataLimitGb,
        r.pricePerGbToman,
        r.amountToman,
        r.settledAt ? 'yes' : 'no',
      ]),
    ])
    return {
      filename: 'billing.csv',
      csv,
      truncated: rows.length === EXPORT_CAP,
    }
  })

// ── bulk actions ──────────────────────────────────────────────────────────

type RowResult = { username: string; ok: boolean; error?: string }
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

export const bulkRenew = authed
  .input(
    z.object({
      usernames: z.array(z.string()).min(1).max(50),
      durationDays: z.union([
        z.literal(0),
        z.literal(30),
        z.literal(60),
        z.literal(90),
      ]),
    }),
  )
  .handler(async ({ input, context }) => {
    const results: RowResult[] = []
    // One at a time: each renewal charges the wallet and talks to Marzban.
    for (const username of input.usernames) {
      try {
        await call(
          renewVpnUser,
          {
            username,
            durationDays: input.durationDays,
            reactivate: true,
          },
          { context: { headers: context.headers } },
        )
        results.push({ username, ok: true })
      } catch (error) {
        results.push({ username, ok: false, error: messageOf(error) })
      }
    }
    return { results, succeeded: results.filter((r) => r.ok).length }
  })

const importRow = z.object({
  username: z.string().min(1),
  gb: z.coerce.number().int().min(10).max(10_000),
  days: z.coerce
    .number()
    .int()
    .refine((value) => [30, 60, 90].includes(value))
    .optional(),
  months: z.coerce.number().int().min(0).max(3).optional(),
  note: z.string().max(500).optional(),
  phone: z.string().max(32).optional(),
  telegram: z.string().max(64).optional(),
  labels: z.string().max(200).optional(),
})

export const importUsers = authed
  .input(
    z.object({
      csv: z.string().max(200_000),
      resellerId: z.string().optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    let table: string[][]
    try {
      table = parseCsv(input.csv)
    } catch {
      throw new ORPCError('BAD_REQUEST', { message: 'فایل CSV معتبر نیست' })
    }
    const [header, ...body] = table
    if (!header || body.length === 0)
      throw new ORPCError('BAD_REQUEST', { message: 'فایل خالی است' })
    if (body.length > 200)
      throw new ORPCError('BAD_REQUEST', {
        message: 'حداکثر ۲۰۰ ردیف در هر بار',
      })
    const cols = header.map((h) => h.trim().toLowerCase())
    for (const required of ['username', 'gb']) {
      if (!cols.includes(required))
        throw new ORPCError('BAD_REQUEST', {
          message: `ستون ${required} الزامی است`,
        })
    }

    const results: Array<RowResult & { row: number }> = []
    for (const [i, cells] of body.entries()) {
      const raw = Object.fromEntries(
        cols.map((c, idx) => [c, cells[idx]?.trim() || undefined]),
      )
      const parsed = importRow.safeParse(raw)
      const username = raw.username ?? ''
      if (!parsed.success) {
        results.push({
          row: i + 2,
          username,
          ok: false,
          error: parsed.error.issues[0]?.message ?? 'invalid row',
        })
        continue
      }
      const r = parsed.data
      try {
        const created = (await call(
          createVpnUser,
          {
            resellerId: input.resellerId,
            username: r.username,
            dataLimitBytes: r.gb * GB,
            ...(r.days !== undefined
              ? { durationDays: r.days as 30 | 60 | 90 }
              : r.months !== undefined
                ? { durationMonths: r.months as 0 | 1 | 2 | 3 }
                : { durationDays: 30 }),
            note: r.note ?? null,
          },
          { context: { headers: context.headers } },
        )) as { id: string }
        if (r.phone || r.telegram || r.labels) {
          await db
            .update(vpnUsers)
            .set({
              contactPhone: r.phone ?? null,
              contactTelegram: r.telegram?.replace(/^@/, '') ?? null,
              labels: r.labels
                ? JSON.stringify(normalizeLabels(r.labels.split('|')))
                : null,
            })
            .where(eq(vpnUsers.id, created.id))
        }
        results.push({ row: i + 2, username: r.username, ok: true })
      } catch (error) {
        results.push({
          row: i + 2,
          username: r.username,
          ok: false,
          error: messageOf(error),
        })
      }
    }
    return { results, succeeded: results.filter((r) => r.ok).length }
  })

// ── admin: limits, suspension, announcements ─────────────────────────────

export const setResellerLimits = adminOnly
  .input(
    z.object({
      resellerId: z.string(),
      maxUsers: z.number().int().min(0).nullable(),
      maxTotalGb: z.number().int().min(0).nullable(),
    }),
  )
  .handler(async ({ input, context }) => {
    const updated = await db
      .update(resellerProfiles)
      .set({ maxUsers: input.maxUsers, maxTotalGb: input.maxTotalGb })
      .where(eq(resellerProfiles.userId, input.resellerId))
      .returning({ id: resellerProfiles.id })
    if (updated.length === 0)
      throw new ORPCError('NOT_FOUND', { message: 'نماینده پیدا نشد' })
    await writeAuditLog({
      actorUserId: context.user.id,
      actorRole: 'admin',
      action: 'reseller.limits',
      entityType: 'reseller',
      resellerId: input.resellerId,
      payload: { maxUsers: input.maxUsers, maxTotalGb: input.maxTotalGb },
    })
    return { ok: true }
  })

export const suspendResellerAccount = adminOnly
  .input(z.object({ resellerId: z.string() }))
  .handler(async ({ input, context }) => {
    const result = await suspendReseller(input.resellerId)
    await writeAuditLog({
      actorUserId: context.user.id,
      actorRole: 'admin',
      action: 'reseller.suspend',
      entityType: 'reseller',
      resellerId: input.resellerId,
      payload: { changed: result.changed, failed: result.failed.length },
    })
    return result
  })

export const resumeResellerAccount = adminOnly
  .input(z.object({ resellerId: z.string() }))
  .handler(async ({ input, context }) => {
    const result = await resumeReseller(input.resellerId)
    await writeAuditLog({
      actorUserId: context.user.id,
      actorRole: 'admin',
      action: 'reseller.resume',
      entityType: 'reseller',
      resellerId: input.resellerId,
      payload: { changed: result.changed, failed: result.failed.length },
    })
    return result
  })

const announcementSchema = z.object({
  text: z.string().trim().max(500),
  level: z.enum(['info', 'warning']).default('info'),
  active: z.boolean().default(false),
})

export const getAnnouncement = authed.handler(async () => {
  const value =
    await getSetting<z.infer<typeof announcementSchema>>('announcement')
  return value?.active && value.text ? value : null
})

export const getAnnouncementAdmin = adminOnly.handler(async () => {
  return (
    (await getSetting<z.infer<typeof announcementSchema>>('announcement')) ?? {
      text: '',
      level: 'info' as const,
      active: false,
    }
  )
})

export const setAnnouncement = adminOnly
  .input(announcementSchema)
  .handler(async ({ input, context }) => {
    await setSetting('announcement', input)
    await writeAuditLog({
      actorUserId: context.user.id,
      actorRole: 'admin',
      action: 'announcement.set',
      entityType: 'settings',
      payload: { active: input.active, level: input.level },
    })
    return { ok: true }
  })
