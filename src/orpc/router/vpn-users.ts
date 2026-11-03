import { ORPCError } from '@orpc/server'
import { and, count, desc, eq, inArray, sql, or, isNull } from 'drizzle-orm'
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
import { withKeyedLock } from '#/lib/keyed-lock'
import { labelCondition, parseLabels, viewCondition } from '#/lib/user-filters'
import { assertCanSpend, InsufficientFundsError } from '#/lib/wallet'
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
  MIN_DATA_LIMIT_BYTES,
  MIN_DATA_LIMIT_GB,
  renewExpireAt,
  renewExpireAtFromMonths,
} from '#/lib/vpn-plans'
import { authed } from '../middleware'
import { outputSpec } from '../openapi-response'

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
  .route({
    summary: 'List VPN users',
    description:
      'Use this operation to list VPN users under the caller’s current role and ownership rules.',
    tags: ['VPN users'],
    spec: outputSpec('vpn-users.listVpnUsers'),
  })
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
    conditions.push(isNull(vpnUsers.removedAt))
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
  .route({
    summary: 'Create VPN user',
    description:
      'Use this operation to create VPN user under the caller’s current role and ownership rules.',
    tags: ['VPN users'],
    spec: outputSpec('vpn-users.createVpnUser'),
  })
  .input(
    z.object({
      resellerId: z.string().optional(),
      username: localUsernameSchema,
      dataLimitBytes: z
        .number()
        .int()
        .positive()
        .min(
          MIN_DATA_LIMIT_BYTES,
          `Data limit must be at least ${MIN_DATA_LIMIT_GB} GB`,
        ),
      durationDays: z
        .union([z.literal(0), z.literal(30), z.literal(60), z.literal(90)])
        .optional(),
      durationMonths: z
        .union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])
        .optional(),
      note: z.string().max(500).nullable().optional(),
      proxies: z.record(z.string(), z.unknown()).optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const resellerId = resolveResellerId(context.user, input.resellerId)
    const dataLimitBytes = input.dataLimitBytes

    // Quota and credit are check-then-write, so one reseller's creates run in turn.
    return withKeyedLock(resellerId, async () => {
      let profile
      try {
        profile = await assertCanCreateVpnUser(resellerId, dataLimitBytes)
      } catch (error) {
        if (error instanceof QuotaExceededError) {
          throw new ORPCError('BAD_REQUEST', { message: error.message })
        }
        throw error
      }

      const legacyMonths =
        input.durationDays === undefined ? input.durationMonths : undefined
      const durationChoice = input.durationDays ?? legacyMonths
      if (durationChoice === undefined) {
        throw new ORPCError('BAD_REQUEST', { message: 'مدت اشتراک الزامی است' })
      }
      if (
        isUnlimitedDuration(durationChoice) &&
        !profile.allowUnlimitedExpire
      ) {
        throw new ORPCError('FORBIDDEN', {
          message: 'این نماینده مجاز به ساخت حساب نامحدود نیست',
        })
      }

      const expireAt =
        input.durationDays !== undefined
          ? expireAtFromDuration(input.durationDays)
          : legacyMonths === 0
            ? null
            : legacyMonths
              ? (() => {
                  const d = new Date()
                  d.setMonth(d.getMonth() + legacyMonths)
                  return d
                })()
              : null

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
          (error.code === 'CONFLICT' ||
            isDuplicateUsernameMessage(error.message))
        ) {
          throw new ORPCError('CONFLICT', {
            message: DUPLICATE_USERNAME_MESSAGE,
          })
        }
        throw error
      }

      // The account now exists upstream; without a local row and a charge it would be free.
      let mirrored
      let billing
      const dataLimitGb = billingGbFromBytes(dataLimitBytes)
      try {
        mirrored = await syncVpnUserFromMarzban(created.username, {
          resellerId,
          createIfMissing: true,
        })
        if (!mirrored) throw new Error('mirror missing')
        billing = await insertBillingEvent({
          resellerId,
          vpnUserId: mirrored.id,
          marzbanUsername: fullUsername,
          type: 'create',
          dataLimitGb,
          durationMonths:
            legacyMonths && legacyMonths > 0 ? legacyMonths : null,
          durationDays:
            input.durationDays && input.durationDays > 0
              ? input.durationDays
              : null,
          pricePerGbToman: profile.pricePerGbToman,
          actorUserId: context.user.id,
        })
      } catch (error) {
        await getBackend()
          .deleteUser(created.username)
          .catch(() => {})
        await softRemoveMirroredVpnUser(created.username, {
          actorUserId: context.user.id,
          reason: 'create_failed',
        }).catch(() => {})
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: 'کاربر ساخته نشد؛ دوباره تلاش کنید',
          cause: error,
        })
      }

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
          durationMonths:
            legacyMonths && legacyMonths > 0 ? legacyMonths : null,
          durationDays:
            input.durationDays && input.durationDays > 0
              ? input.durationDays
              : null,
          amountToman: billing.amountToman,
          pricePerGbToman: profile.pricePerGbToman,
          billingEventId: billing.id,
        },
      })

      return mirrored
    })
  })

export const updateVpnUser = authed
  .route({
    summary: 'Update VPN user',
    description:
      'Use this operation to update VPN user under the caller’s current role and ownership rules.',
    tags: ['VPN users'],
    spec: outputSpec('vpn-users.updateVpnUser'),
  })
  .input(
    z.object({
      username: z.string().min(1),
      dataLimitBytes: z
        .number()
        .int()
        .positive()
        .min(
          MIN_DATA_LIMIT_BYTES,
          `Data limit must be at least ${MIN_DATA_LIMIT_GB} GB`,
        )
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
  .route({
    summary: 'Renew VPN user',
    description:
      'Use this operation to renew VPN user under the caller’s current role and ownership rules.',
    tags: ['VPN users'],
    spec: outputSpec('vpn-users.renewVpnUser'),
  })
  .input(
    z.object({
      username: z.string().min(1),
      durationDays: z
        .union([z.literal(0), z.literal(30), z.literal(60), z.literal(90)])
        .optional(),
      /** Legacy month payload is accepted only for already-pending requests. */
      durationMonths: z
        .union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])
        .optional(),
      additionalDataLimitBytes: z
        .number()
        .int()
        .refine(Number.isSafeInteger, {
          message: 'Data limit must be a safe integer',
        })
        .positive()
        .min(
          MIN_DATA_LIMIT_BYTES,
          `Data limit must be at least ${MIN_DATA_LIMIT_GB} GB`,
        )
        .optional(),
      resetUsage: z.boolean().optional(),
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
      (input.durationDays === 0 || input.durationMonths === 0) &&
      !profile.allowUnlimitedExpire
    ) {
      throw new ORPCError('FORBIDDEN', {
        message: 'این نماینده مجاز به تمدید نامحدود نیست',
      })
    }

    if (
      input.durationDays === undefined &&
      input.durationMonths === undefined
    ) {
      throw new ORPCError('BAD_REQUEST', { message: 'مدت تمدید الزامی است' })
    }

    // A locally known unlimited cap cannot receive an incremental allowance.
    // Reject it before any backend read, mutation, billing or wallet action.
    if (owned.dataLimitBytes == null) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'حجم پلن برای تمدید مشخص نیست',
      })
    }
    const preflightAdditionalBytes =
      input.additionalDataLimitBytes ?? owned.dataLimitBytes
    if (
      !Number.isSafeInteger(preflightAdditionalBytes) ||
      !isValidDataLimitBytes(preflightAdditionalBytes) ||
      !Number.isSafeInteger(owned.dataLimitBytes + preflightAdditionalBytes)
    ) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'حجم افزوده‌شده نامعتبر است',
      })
    }

    const current = await syncVpnUserFromMarzban(input.username, {
      repairInbounds: false,
    })
    if (!current || current.removedAt) {
      throw new ORPCError('NOT_FOUND', { message: 'کاربر VPN پیدا نشد' })
    }
    if (
      current.dataLimitBytes == null ||
      !isValidDataLimitBytes(current.dataLimitBytes)
    ) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'حجم پلن برای تمدید مشخص نیست',
      })
    }

    const addedBytes = input.additionalDataLimitBytes ?? current.dataLimitBytes
    const nextDataLimitBytes = current.dataLimitBytes + addedBytes
    if (
      !Number.isSafeInteger(nextDataLimitBytes) ||
      !isValidDataLimitBytes(addedBytes)
    ) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'حجم افزوده‌شده نامعتبر است',
      })
    }
    const legacyMonths =
      input.durationDays === undefined ? input.durationMonths : undefined
    const expireAt =
      legacyMonths === 0
        ? null
        : legacyMonths
          ? renewExpireAtFromMonths(current.expireAt, legacyMonths)
          : renewExpireAt(current.expireAt, input.durationDays!)
    const durationDays =
      legacyMonths !== undefined
        ? null
        : input.durationDays === 0
          ? null
          : input.durationDays

    await guardSpend(
      owned.resellerId,
      billingGbFromBytes(addedBytes),
      profile.pricePerGbToman,
    )

    const backend = getBackend(owned.backend)
    await backend.updateUser(input.username, {
      expireAt,
      dataLimitBytes: nextDataLimitBytes,
      ...(input.reactivate ? { status: 'active' as const } : {}),
    })

    const mirrored = await syncVpnUserFromMarzban(input.username, {
      resellerId: owned.resellerId,
    })

    const dataLimitGb = billingGbFromBytes(addedBytes)
    const durationMonths = legacyMonths ?? null
    const billing = await insertBillingEvent({
      resellerId: owned.resellerId,
      vpnUserId: owned.id,
      marzbanUsername: input.username,
      type: 'renew',
      dataLimitGb,
      durationMonths,
      durationDays,
      pricePerGbToman: profile.pricePerGbToman,
      actorUserId: context.user.id,
    })

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
        durationDays,
        additionalDataLimitGb: billingGbFromBytes(addedBytes),
        resetUsage: false,
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
  .route({
    summary: 'Archive VPN user',
    description:
      'Use this operation to archive VPN user under the caller’s current role and ownership rules.',
    tags: ['VPN users'],
    spec: outputSpec('vpn-users.deleteVpnUser'),
  })
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
  .route({
    summary: 'Reset VPN user usage',
    description:
      'Use this operation to reset VPN user usage under the caller’s current role and ownership rules.',
    tags: ['VPN users'],
    spec: outputSpec('vpn-users.resetVpnUserUsage'),
  })
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
  .route({
    summary: 'Revoke VPN subscription',
    description:
      'Use this operation to revoke VPN subscription under the caller’s current role and ownership rules.',
    tags: ['VPN users'],
    spec: outputSpec('vpn-users.revokeVpnUserSub'),
  })
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
  .route({
    summary: 'Sync VPN user',
    description:
      'Use this operation to sync VPN user under the caller’s current role and ownership rules.',
    tags: ['VPN users'],
    spec: outputSpec('vpn-users.syncVpnUser'),
  })
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
