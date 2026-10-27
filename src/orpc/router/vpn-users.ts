import { ORPCError } from '@orpc/server'
import { and, count, desc, eq, inArray, sql, or } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import * as z from 'zod'

import { db } from '#/db'
import { billingEvents, vpnUsers } from '#/db/schema'
import {
  billingGbFromBytes,
  extraGbDelta,
  settlementStatus,
  shouldBillForUpdate,
  amountToman,
} from '#/lib/billing'
import { insertBillingEvent, writeAuditLog } from '#/lib/ledger'
import { labelCondition, parseLabels, viewCondition } from '#/lib/user-filters'
import {
  assertCanSpend,
  InsufficientFundsError,
  settleEventFromWallet,
} from '#/lib/wallet'
import { getBackend } from '#/lib/backends/registry'
import { BackendError } from '#/lib/backends/types'
import {
  assertCanCreateVpnUser,
  getOwnedVpnUser,
  getResellerProfile,
  QuotaExceededError,
} from '#/lib/marzban/quotas'
import {
  softRemoveMirroredVpnUser,
  syncVpnUserFromMarzban,
  refreshVpnUserMirrors,
} from '#/lib/marzban/sync'
import { resolveSubscriptionUrl } from '#/lib/marzban/subscription-url'
import {
  assertValidFullVpnUsername,
  buildVpnUsername,
  localUsernameSchema,
} from '#/lib/reseller-naming'
import {
  expireAtFromDuration,
  isUnlimitedDuration,
  isValidDataLimitBytes,
  renewExpireAt,
} from '#/lib/vpn-plans'
import { authed } from '../middleware'

function resolveResellerId(
  user: { id: string; role: string },
  resellerId?: string,
) {
  if (user.role === 'admin') {
    if (!resellerId) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'انتخاب نماینده برای مدیر الزامی است',
      })
    }
    return resellerId
  }
  return user.id
}

function actorRole(role: string): 'admin' | 'reseller' {
  return role === 'admin' ? 'admin' : 'reseller'
}

function escapeLike(value: string) {
  return value.replace(/[%_\\]/g, '\\$&')
}

function isDuplicateUsernameMessage(message: string) {
  return /already|exist|duplicate|conflict|unique|تکرار/i.test(message)
}

const DUPLICATE_USERNAME_MESSAGE =
  'این نام کاربری قبلاً ثبت شده است؛ نام دیگری انتخاب کنید'

/** Reject before touching Marzban when the reseller is past their credit limit. */
async function guardSpend(resellerId: string, gb: number, pricePerGb: number) {
  try {
    await assertCanSpend(resellerId, amountToman(gb, pricePerGb))
  } catch (error) {
    if (error instanceof InsufficientFundsError) {
      throw new ORPCError('FORBIDDEN', {
        message: 'سقف اعتبار شما تکمیل شده است. کیف پول را شارژ کنید.',
      })
    }
    throw error
  }
}

export const listVpnUsers = authed
  .input(
    z.object({
      resellerId: z.string().optional(),
      q: z.string().trim().max(100).optional(),
      page: z.number().int().min(1).default(1),
      pageSize: z
        .union([z.literal(10), z.literal(20), z.literal(50)])
        .default(20),
      status: z
        .enum(['active', 'disabled', 'limited', 'expired', 'on_hold'])
        .optional(),
      view: z.enum(['expiring', 'high_usage', 'unpaid']).optional(),
      label: z.string().trim().max(30).optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const resellerId =
      context.user.role === 'admin'
        ? (input.resellerId ?? undefined)
        : context.user.id

    const conditions: SQL[] = []
    if (resellerId) {
      conditions.push(eq(vpnUsers.resellerId, resellerId))
    }
    if (input.status) {
      conditions.push(eq(vpnUsers.status, input.status))
    }
    if (input.view) conditions.push(viewCondition(input.view))
    if (input.label) conditions.push(labelCondition(input.label))
    const q = input.q?.trim()
    if (q) {
      const pattern = `%${escapeLike(q)}%`
      conditions.push(
        or(
          sql`${vpnUsers.marzbanUsername} LIKE ${pattern} ESCAPE '\\'`,
          sql`${vpnUsers.note} LIKE ${pattern} ESCAPE '\\'`,
          sql`${vpnUsers.contactPhone} LIKE ${pattern} ESCAPE '\\'`,
          sql`${vpnUsers.contactTelegram} LIKE ${pattern} ESCAPE '\\'`,
        )!,
      )
    }

    const whereClause = conditions.length ? and(...conditions) : undefined

    const [totalRow] = await db
      .select({ c: count() })
      .from(vpnUsers)
      .where(whereClause)

    const total = Number(totalRow?.c ?? 0)
    const pageSize = input.pageSize
    const pageCount = Math.max(1, Math.ceil(total / pageSize))
    const page = Math.min(input.page, pageCount)
    const offset = (page - 1) * pageSize

    let rows = await db
      .select()
      .from(vpnUsers)
      .where(whereClause)
      .orderBy(desc(vpnUsers.createdAt))
      .limit(pageSize)
      .offset(offset)

    const refreshed = await refreshVpnUserMirrors(rows)
    rows = refreshed.rows

    const ids = rows.map((r) => r.id)
    const billingByUser = new Map<
      string,
      'settled' | 'claimed' | 'outstanding'
    >()
    if (ids.length > 0) {
      const events = await db
        .select()
        .from(billingEvents)
        .where(inArray(billingEvents.vpnUserId, ids))
        .orderBy(desc(billingEvents.createdAt))
      for (const event of events) {
        if (!billingByUser.has(event.vpnUserId)) {
          billingByUser.set(event.vpnUserId, settlementStatus(event))
        }
      }
    }

    return {
      items: rows.map((row) => ({
        ...row,
        subscriptionUrl: resolveSubscriptionUrl(row.subscriptionUrl),
        expireAt: row.expireAt?.toISOString() ?? null,
        lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
        removedAt: row.removedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        billingStatus: billingByUser.get(row.id) ?? null,
        labels: parseLabels(row.labels),
      })),
      syncFailed: refreshed.failed,
      total,
      page,
      pageSize,
      pageCount,
    }
  })

export const createVpnUser = authed
  .input(
    z.object({
      resellerId: z.string().optional(),
      username: localUsernameSchema,
      dataLimitBytes: z
        .number()
        .int()
        .positive()
        .refine(isValidDataLimitBytes, {
          message: 'Data limit must be at least 10 GB',
        }),
      durationMonths: z.union([
        z.literal(0),
        z.literal(1),
        z.literal(2),
        z.literal(3),
      ]),
      note: z.string().max(500).nullable().optional(),
      proxies: z.record(z.string(), z.unknown()).optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const resellerId = resolveResellerId(context.user, input.resellerId)
    const dataLimitBytes = input.dataLimitBytes

    let profile
    try {
      profile = await assertCanCreateVpnUser(resellerId, dataLimitBytes)
    } catch (error) {
      if (error instanceof QuotaExceededError) {
        throw new ORPCError('BAD_REQUEST', { message: error.message })
      }
      throw error
    }

    if (
      isUnlimitedDuration(input.durationMonths) &&
      !profile.allowUnlimitedExpire
    ) {
      throw new ORPCError('FORBIDDEN', {
        message: 'این نماینده مجاز به ساخت حساب نامحدود نیست',
      })
    }

    const expireAt = expireAtFromDuration(input.durationMonths)

    if (!profile.usernameSuffix) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'پسوند نام کاربری نماینده تنظیم نشده است',
      })
    }

    const fullUsername = buildVpnUsername(
      profile.usernameSuffix,
      input.username,
    )

    try {
      assertValidFullVpnUsername(fullUsername)
    } catch (error) {
      throw new ORPCError('BAD_REQUEST', {
        message:
          error instanceof Error ? error.message : 'نام کاربری نامعتبر است',
      })
    }

    const [existingLocal] = await db
      .select({ id: vpnUsers.id })
      .from(vpnUsers)
      .where(eq(vpnUsers.marzbanUsername, fullUsername))
      .limit(1)

    if (existingLocal) {
      throw new ORPCError('CONFLICT', {
        message: DUPLICATE_USERNAME_MESSAGE,
      })
    }

    await guardSpend(
      resellerId,
      billingGbFromBytes(dataLimitBytes),
      profile.pricePerGbToman,
    )

    let created
    try {
      created = await getBackend().createUser({
        username: fullUsername,
        protocols: input.proxies,
        dataLimitBytes,
        expireAt,
        note: input.note ?? null,
      })
    } catch (error) {
      if (
        error instanceof BackendError &&
        (error.code === 'CONFLICT' || isDuplicateUsernameMessage(error.message))
      ) {
        throw new ORPCError('CONFLICT', {
          message: DUPLICATE_USERNAME_MESSAGE,
        })
      }
      throw error
    }

    const mirrored = await syncVpnUserFromMarzban(created.username, {
      resellerId,
      createIfMissing: true,
    })

    if (!mirrored) {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: 'کاربر ساخته شد اما همگام‌سازی محلی شکست خورد',
      })
    }

    const dataLimitGb = billingGbFromBytes(dataLimitBytes)
    const billing = await insertBillingEvent({
      resellerId,
      vpnUserId: mirrored.id,
      marzbanUsername: fullUsername,
      type: 'create',
      dataLimitGb,
      durationMonths: isUnlimitedDuration(input.durationMonths)
        ? null
        : input.durationMonths,
      pricePerGbToman: profile.pricePerGbToman,
      actorUserId: context.user.id,
    })

    await settleEventFromWallet(billing.id)

    await writeAuditLog({
      actorUserId: context.user.id,
      actorRole: actorRole(context.user.role),
      action: 'vpn_user.create',
      entityType: 'vpn_user',
      entityId: mirrored.id,
      vpnUsername: fullUsername,
      resellerId,
      payload: {
        dataLimitGb,
        durationMonths: isUnlimitedDuration(input.durationMonths)
          ? null
          : input.durationMonths,
        amountToman: billing.amountToman,
        pricePerGbToman: profile.pricePerGbToman,
        billingEventId: billing.id,
      },
    })

    return mirrored
  })

export const updateVpnUser = authed
  .input(
    z.object({
      username: z.string().min(1),
      dataLimitBytes: z
        .number()
        .int()
        .positive()
        .refine(isValidDataLimitBytes, {
          message: 'Data limit must be at least 10 GB',
        })
        .optional(),
      expireAt: z.string().datetime().nullable().optional(),
      note: z.string().max(500).nullable().optional(),
      status: z.enum(['active', 'disabled', 'on_hold']).optional(),
      /** Any non-empty string; no length/complexity rules (e.g. "1234" is ok). */
      password: z.string().min(1).optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const owned = await getOwnedVpnUser(
      input.username,
      context.user.id,
      context.user.role === 'admin',
    )
    if (!owned) {
      throw new ORPCError('NOT_FOUND', { message: 'کاربر VPN پیدا نشد' })
    }

    const expireAt =
      input.expireAt === undefined
        ? undefined
        : input.expireAt
          ? new Date(input.expireAt)
          : null

    const current = await syncVpnUserFromMarzban(input.username, {
      repairInbounds: false,
    })
    if (!current || current.removedAt) {
      throw new ORPCError('NOT_FOUND', { message: 'کاربر VPN پیدا نشد' })
    }
    const previousBytes = current.dataLimitBytes
    const nextBytes =
      input.dataLimitBytes !== undefined ? input.dataLimitBytes : previousBytes

    const plannedExtraGb = extraGbDelta(previousBytes, nextBytes)
    if (
      plannedExtraGb > 0 &&
      shouldBillForUpdate({
        previousBytes,
        nextBytes,
        statusChangedToDisabled: input.status === 'disabled',
      })
    ) {
      const billingProfile = await getResellerProfile(owned.resellerId)
      if (billingProfile) {
        await guardSpend(
          owned.resellerId,
          plannedExtraGb,
          billingProfile.pricePerGbToman,
        )
      }
    }

    try {
      await getBackend(owned.backend).updateUser(input.username, {
        ...(input.dataLimitBytes !== undefined
          ? { dataLimitBytes: input.dataLimitBytes }
          : {}),
        ...(expireAt !== undefined ? { expireAt } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.password !== undefined ? { password: input.password } : {}),
      })
    } catch (error) {
      if (error instanceof BackendError && error.code === 'UNSUPPORTED') {
        throw new ORPCError('BAD_REQUEST', {
          message: 'این کاربر پروتکل با رمز عبور ندارد (مثلاً فقط VLESS/VMess).',
        })
      }
      throw error
    }

    const mirrored = await syncVpnUserFromMarzban(input.username, {
      resellerId: owned.resellerId,
    })

    const billExtra = shouldBillForUpdate({
      previousBytes,
      nextBytes,
      statusChangedToDisabled: input.status === 'disabled',
    })
    const deltaGb = extraGbDelta(previousBytes, nextBytes)

    if (billExtra && deltaGb > 0) {
      const profile = await getResellerProfile(owned.resellerId)
      if (!profile) {
        throw new ORPCError('BAD_REQUEST', {
          message: 'پروفایل نماینده یافت نشد',
        })
      }
      const billing = await insertBillingEvent({
        resellerId: owned.resellerId,
        vpnUserId: owned.id,
        marzbanUsername: input.username,
        type: 'extra_gb',
        dataLimitGb: deltaGb,
        durationMonths: null,
        pricePerGbToman: profile.pricePerGbToman,
        actorUserId: context.user.id,
      })
      await settleEventFromWallet(billing.id)
      await writeAuditLog({
        actorUserId: context.user.id,
        actorRole: actorRole(context.user.role),
        action: 'vpn_user.extra_gb',
        entityType: 'vpn_user',
        entityId: owned.id,
        vpnUsername: input.username,
        resellerId: owned.resellerId,
        payload: {
          previousBytes,
          nextBytes,
          deltaGb,
          amountToman: billing.amountToman,
          billingEventId: billing.id,
        },
      })
    } else {
      await writeAuditLog({
        actorUserId: context.user.id,
        actorRole: actorRole(context.user.role),
        action: 'vpn_user.update',
        entityType: 'vpn_user',
        entityId: owned.id,
        vpnUsername: input.username,
        resellerId: owned.resellerId,
        payload: {
          dataLimitBytes: input.dataLimitBytes,
          status: input.status,
          note: input.note,
          passwordChanged: input.password !== undefined,
          billable: false,
          before: {
            dataLimitBytes: previousBytes,
            status: current.status,
            note: current.note,
            expireAt: current.expireAt?.toISOString() ?? null,
          },
          after: {
            dataLimitBytes: nextBytes,
            status: input.status ?? current.status,
            note: input.note !== undefined ? input.note : current.note,
            expireAt:
              expireAt === undefined
                ? (current.expireAt?.toISOString() ?? null)
                : (expireAt?.toISOString() ?? null),
          },
        },
      })
    }

    return mirrored
  })

export const renewVpnUser = authed
  .input(
    z.object({
      username: z.string().min(1),
      durationMonths: z.union([
        z.literal(0),
        z.literal(1),
        z.literal(2),
        z.literal(3),
      ]),
      dataLimitBytes: z
        .number()
        .int()
        .positive()
        .refine(isValidDataLimitBytes, {
          message: 'Data limit must be at least 10 GB',
        })
        .optional(),
      resetUsage: z.boolean().default(true),
      reactivate: z.boolean().default(true),
    }),
  )
  .handler(async ({ input, context }) => {
    const owned = await getOwnedVpnUser(
      input.username,
      context.user.id,
      context.user.role === 'admin',
    )
    if (!owned) {
      throw new ORPCError('NOT_FOUND', { message: 'کاربر VPN پیدا نشد' })
    }

    const profile = await getResellerProfile(owned.resellerId)
    if (!profile) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'پروفایل نماینده یافت نشد',
      })
    }

    if (
      isUnlimitedDuration(input.durationMonths) &&
      !profile.allowUnlimitedExpire
    ) {
      throw new ORPCError('FORBIDDEN', {
        message: 'این نماینده مجاز به تمدید نامحدود نیست',
      })
    }

    const current = await syncVpnUserFromMarzban(input.username, {
      repairInbounds: false,
    })
    if (!current || current.removedAt) {
      throw new ORPCError('NOT_FOUND', { message: 'کاربر VPN پیدا نشد' })
    }
    const expireAt = renewExpireAt(current.expireAt, input.durationMonths)
    const billedBytes = input.dataLimitBytes ?? current.dataLimitBytes
    if (billedBytes == null || !isValidDataLimitBytes(billedBytes)) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'حجم پلن برای تمدید مشخص نیست',
      })
    }

    await guardSpend(
      owned.resellerId,
      billingGbFromBytes(billedBytes),
      profile.pricePerGbToman,
    )

    const backend = getBackend(owned.backend)
    if (input.resetUsage) {
      await backend.resetUsage(input.username)
    }

    await backend.updateUser(input.username, {
      expireAt,
      ...(input.dataLimitBytes !== undefined
        ? { dataLimitBytes: input.dataLimitBytes }
        : {}),
      ...(input.reactivate ? { status: 'active' as const } : {}),
    })

    const mirrored = await syncVpnUserFromMarzban(input.username, {
      resellerId: owned.resellerId,
    })

    const dataLimitGb = billingGbFromBytes(billedBytes)
    const durationMonths = isUnlimitedDuration(input.durationMonths)
      ? null
      : input.durationMonths
    const billing = await insertBillingEvent({
      resellerId: owned.resellerId,
      vpnUserId: owned.id,
      marzbanUsername: input.username,
      type: 'renew',
      dataLimitGb,
      durationMonths,
      pricePerGbToman: profile.pricePerGbToman,
      actorUserId: context.user.id,
    })

    await settleEventFromWallet(billing.id)

    await writeAuditLog({
      actorUserId: context.user.id,
      actorRole: actorRole(context.user.role),
      action: 'vpn_user.renew',
      entityType: 'vpn_user',
      entityId: owned.id,
      vpnUsername: input.username,
      resellerId: owned.resellerId,
      payload: {
        dataLimitGb,
        durationMonths,
        resetUsage: input.resetUsage,
        amountToman: billing.amountToman,
        billingEventId: billing.id,
      },
    })

    return mirrored
  })

/**
 * Soft-remove only (admin). Resellers must use disable — never erase ledger.
 */
export const deleteVpnUser = authed
  .input(z.object({ username: z.string().min(1) }))
  .handler(async ({ input, context }) => {
    if (context.user.role !== 'admin') {
      throw new ORPCError('FORBIDDEN', {
        message: 'حذف مجاز نیست؛ کاربر را غیرفعال کنید',
      })
    }

    const owned = await getOwnedVpnUser(input.username, context.user.id, true)
    if (!owned) {
      throw new ORPCError('NOT_FOUND', { message: 'کاربر VPN پیدا نشد' })
    }

    try {
      await getBackend(owned.backend).updateUser(input.username, {
        status: 'disabled',
      })
    } catch {
      // Remote may already be gone — local soft-remove still applies.
    }

    await softRemoveMirroredVpnUser(input.username, {
      actorUserId: context.user.id,
      actorRole: 'admin',
      reason: 'admin_soft_remove',
    })

    return { ok: true }
  })

export const resetVpnUserUsage = authed
  .input(z.object({ username: z.string().min(1) }))
  .handler(async ({ input, context }) => {
    const owned = await getOwnedVpnUser(
      input.username,
      context.user.id,
      context.user.role === 'admin',
    )
    if (!owned) {
      throw new ORPCError('NOT_FOUND', { message: 'کاربر VPN پیدا نشد' })
    }

    await getBackend(owned.backend).resetUsage(input.username)
    const mirrored = await syncVpnUserFromMarzban(input.username, {
      resellerId: owned.resellerId,
    })

    await writeAuditLog({
      actorUserId: context.user.id,
      actorRole: actorRole(context.user.role),
      action: 'vpn_user.reset_usage',
      entityType: 'vpn_user',
      entityId: owned.id,
      vpnUsername: input.username,
      resellerId: owned.resellerId,
      payload: { billable: false },
    })

    return mirrored
  })

export const revokeVpnUserSub = authed
  .input(z.object({ username: z.string().min(1) }))
  .handler(async ({ input, context }) => {
    const owned = await getOwnedVpnUser(
      input.username,
      context.user.id,
      context.user.role === 'admin',
    )
    if (!owned) {
      throw new ORPCError('NOT_FOUND', { message: 'کاربر VPN پیدا نشد' })
    }

    await getBackend(owned.backend).revokeSubscription(input.username)
    const mirrored = await syncVpnUserFromMarzban(input.username, {
      resellerId: owned.resellerId,
    })

    await writeAuditLog({
      actorUserId: context.user.id,
      actorRole: actorRole(context.user.role),
      action: 'vpn_user.revoke_sub',
      entityType: 'vpn_user',
      entityId: owned.id,
      vpnUsername: input.username,
      resellerId: owned.resellerId,
      payload: { billable: false },
    })

    return mirrored
  })

export const syncVpnUser = authed
  .input(z.object({ username: z.string().min(1) }))
  .handler(async ({ input, context }) => {
    const owned = await getOwnedVpnUser(
      input.username,
      context.user.id,
      context.user.role === 'admin',
    )
    if (!owned) {
      throw new ORPCError('NOT_FOUND', { message: 'کاربر VPN پیدا نشد' })
    }

    const mirrored = await syncVpnUserFromMarzban(input.username, {
      resellerId: owned.resellerId,
    })

    await writeAuditLog({
      actorUserId: context.user.id,
      actorRole: actorRole(context.user.role),
      action: 'vpn_user.sync',
      entityType: 'vpn_user',
      entityId: owned.id,
      vpnUsername: input.username,
      resellerId: owned.resellerId,
      payload: { billable: false },
    })

    return mirrored
  })
