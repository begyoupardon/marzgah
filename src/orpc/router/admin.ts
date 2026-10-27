import { ORPCError } from '@orpc/server'
import { getEnv } from '#/lib/env'
import { desc, eq, sql } from 'drizzle-orm'
import * as z from 'zod'

import { db } from '#/db'
import { resellerProfiles, user, walletEntries } from '#/db/schema'
import {
  createCredentialUser,
  ensureResellerProfile,
  setCredentialPassword,
} from '#/lib/create-user'
import { writeAuditLog } from '#/lib/ledger'
import {
  credit,
  debit,
  getBalance,
  settleOutstandingFromWallet,
} from '#/lib/wallet'
import { usernameSuffixSchema } from '#/lib/reseller-naming'
import { getBackend } from '#/lib/backends/registry'
import { adminOnly } from '../middleware'

export const listResellers = adminOnly.handler(async () => {
  const [rows, balances] = await Promise.all([
    db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        profileId: resellerProfiles.id,
        status: resellerProfiles.status,
        usernameSuffix: resellerProfiles.usernameSuffix,
        pricePerGbToman: resellerProfiles.pricePerGbToman,
        allowUnlimitedExpire: resellerProfiles.allowUnlimitedExpire,
        creditLimitToman: resellerProfiles.creditLimitToman,
        notes: resellerProfiles.notes,
        maxUsers: resellerProfiles.maxUsers,
        maxTotalGb: resellerProfiles.maxTotalGb,
        createdAt: resellerProfiles.createdAt,
      })
      .from(user)
      .leftJoin(resellerProfiles, eq(resellerProfiles.userId, user.id))
      .where(eq(user.role, 'reseller'))
      .orderBy(desc(user.createdAt)),
    db
      .select({
        resellerId: walletEntries.resellerId,
        total: sql<number>`coalesce(sum(case ${walletEntries.type} when 'credit' then ${walletEntries.amountToman} else -${walletEntries.amountToman} end), 0)`,
      })
      .from(walletEntries)
      .groupBy(walletEntries.resellerId),
  ])

  const balanceMap = new Map(
    balances.map((b) => [b.resellerId, Number(b.total ?? 0)]),
  )

  return rows.map((r) => ({
    ...r,
    balanceToman: balanceMap.get(r.id) ?? 0,
  }))
})

export const createReseller = adminOnly
  .input(
    z.object({
      email: z.email(),
      name: z.string().min(1),
      password: z.string().min(1, 'رمز عبور الزامی است'),
      usernameSuffix: usernameSuffixSchema,
      pricePerGbToman: z
        .number()
        .int()
        .positive('قیمت هر گیگ باید بزرگ‌تر از صفر باشد'),
      allowUnlimitedExpire: z.boolean().optional().default(false),
      notes: z.string().nullable().optional(),
      initialBalanceToman: z.number().int().min(0).optional().default(0),
      creditLimitToman: z.number().int().min(0).nullable().optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const bootstrap = getEnv().BOOTSTRAP_ADMIN_EMAIL?.toLowerCase()
    if (bootstrap && input.email.toLowerCase() === bootstrap) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'Cannot create a reseller with the bootstrap admin email',
      })
    }

    const [suffixTaken] = await db
      .select({ id: resellerProfiles.id })
      .from(resellerProfiles)
      .where(eq(resellerProfiles.usernameSuffix, input.usernameSuffix))
      .limit(1)

    if (suffixTaken) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'این پسوند نام کاربری قبلاً استفاده شده است',
      })
    }

    try {
      const created = await createCredentialUser({
        email: input.email,
        name: input.name,
        password: input.password,
        role: 'reseller',
      })

      await ensureResellerProfile(created.id, {
        usernameSuffix: input.usernameSuffix,
        pricePerGbToman: input.pricePerGbToman,
        allowUnlimitedExpire: input.allowUnlimitedExpire ?? false,
        notes: input.notes ?? null,
        creditLimitToman: input.creditLimitToman ?? null,
        status: 'active',
      })

      if (input.initialBalanceToman && input.initialBalanceToman > 0) {
        await credit({
          resellerId: created.id,
          amountToman: input.initialBalanceToman,
          reason: 'شارژ اولیه هنگام ایجاد نماینده',
          provider: 'initial-balance',
          reference: crypto.randomUUID(),
          actorUserId: context.user.id,
        })
        await writeAuditLog({
          actorUserId: context.user.id,
          actorRole: 'admin',
          action: 'wallet.credit',
          entityType: 'wallet',
          resellerId: created.id,
          payload: {
            amountToman: input.initialBalanceToman,
            reason: 'شارژ اولیه هنگام ایجاد نماینده',
          },
        })
      }

      return { id: created.id, email: created.email }
    } catch (error) {
      throw new ORPCError('BAD_REQUEST', {
        message:
          error instanceof Error ? error.message : 'ایجاد نماینده انجام نشد',
      })
    }
  })

export const updateReseller = adminOnly
  .input(
    z.object({
      userId: z.string().min(1),
      name: z.string().trim().min(1).optional(),
      status: z.enum(['active', 'disabled']).optional(),
      usernameSuffix: usernameSuffixSchema.optional(),
      pricePerGbToman: z.number().int().positive().optional(),
      allowUnlimitedExpire: z.boolean().optional(),
      notes: z.string().nullable().optional(),
      creditLimitToman: z.number().int().min(0).nullable().optional(),
      targetBalanceToman: z.number().int().min(0).optional(),
      /** Any non-empty string; no length/complexity rules (e.g. "1234" is ok). */
      password: z.string().min(1).optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const [profile] = await db
      .select()
      .from(resellerProfiles)
      .where(eq(resellerProfiles.userId, input.userId))
      .limit(1)

    if (!profile) {
      throw new ORPCError('NOT_FOUND', { message: 'نماینده پیدا نشد' })
    }

    const [resellerUser] = await db
      .select({ id: user.id, role: user.role })
      .from(user)
      .where(eq(user.id, input.userId))
      .limit(1)

    if (!resellerUser || resellerUser.role !== 'reseller') {
      throw new ORPCError('NOT_FOUND', { message: 'نماینده پیدا نشد' })
    }

    if (
      input.usernameSuffix &&
      input.usernameSuffix !== profile.usernameSuffix
    ) {
      const [suffixTaken] = await db
        .select({ id: resellerProfiles.id })
        .from(resellerProfiles)
        .where(eq(resellerProfiles.usernameSuffix, input.usernameSuffix))
        .limit(1)

      if (suffixTaken) {
        throw new ORPCError('BAD_REQUEST', {
          message: 'این پسوند نام کاربری قبلاً استفاده شده است',
        })
      }
    }

    if (input.name !== undefined) {
      await db
        .update(user)
        .set({ name: input.name })
        .where(eq(user.id, input.userId))
    }

    const profilePatch: {
      status?: 'active' | 'disabled'
      usernameSuffix?: string
      pricePerGbToman?: number
      allowUnlimitedExpire?: boolean
      notes?: string | null
      creditLimitToman?: number | null
    } = {
      ...(input.status ? { status: input.status } : {}),
      ...(input.usernameSuffix ? { usernameSuffix: input.usernameSuffix } : {}),
      ...(input.pricePerGbToman != null
        ? { pricePerGbToman: input.pricePerGbToman }
        : {}),
      ...(input.allowUnlimitedExpire !== undefined
        ? { allowUnlimitedExpire: input.allowUnlimitedExpire }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.creditLimitToman !== undefined
        ? { creditLimitToman: input.creditLimitToman }
        : {}),
    }

    // D1/SQLite rejects UPDATE with an empty SET (password-only changes hit this).
    if (Object.keys(profilePatch).length > 0) {
      await db
        .update(resellerProfiles)
        .set(profilePatch)
        .where(eq(resellerProfiles.id, profile.id))
    }

    if (input.targetBalanceToman !== undefined) {
      const current = await getBalance(input.userId)
      const diff = input.targetBalanceToman - current
      if (diff > 0) {
        await credit({
          resellerId: input.userId,
          amountToman: diff,
          reason: `تنظیم موجودی توسط مدیر (موجودی قبلی: ${current.toLocaleString('fa-IR')})`,
          provider: 'admin-set-balance',
          reference: crypto.randomUUID(),
          actorUserId: context.user.id,
        })
        await settleOutstandingFromWallet(input.userId)
      } else if (diff < 0) {
        await debit({
          resellerId: input.userId,
          amountToman: Math.abs(diff),
          reason: `تنظیم موجودی توسط مدیر (موجودی قبلی: ${current.toLocaleString('fa-IR')})`,
          provider: 'admin-set-balance',
          reference: crypto.randomUUID(),
          actorUserId: context.user.id,
        })
      }
      await writeAuditLog({
        actorUserId: context.user.id,
        actorRole: 'admin',
        action: 'wallet.set_balance',
        entityType: 'wallet',
        resellerId: input.userId,
        payload: {
          previousBalanceToman: current,
          targetBalanceToman: input.targetBalanceToman,
          diff,
        },
      })
    }

    if (input.password !== undefined) {
      try {
        await setCredentialPassword(input.userId, input.password)
      } catch (error) {
        throw new ORPCError('BAD_REQUEST', {
          message:
            error instanceof Error ? error.message : 'تغییر رمز عبور انجام نشد',
        })
      }
    }

    return { ok: true }
  })

export const marzbanHealth = adminOnly.handler(async () => {
  const backend = getBackend()
  const { baseUrl, configured, label } = backend.info()

  if (!configured) {
    return {
      ok: false as const,
      configured: false,
      baseUrl,
      latencyMs: null,
      checkedAt: new Date().toISOString(),
      error: `${label} is not configured (check its environment variables)`,
      stats: null,
    }
  }

  const started = Date.now()
  try {
    const stats = await backend.health()
    return {
      ok: true as const,
      configured: true,
      baseUrl,
      latencyMs: Date.now() - started,
      checkedAt: new Date().toISOString(),
      error: null,
      stats: {
        version: stats.version,
        totalUsers: stats.totalUsers,
        activeUsers: stats.activeUsers,
        incomingBandwidth: stats.incomingBytes,
        outgoingBandwidth: stats.outgoingBytes,
      },
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : `Unknown ${label} error`

    return {
      ok: false as const,
      configured: true,
      baseUrl,
      latencyMs: Date.now() - started,
      checkedAt: new Date().toISOString(),
      error: message,
      stats: null,
    }
  }
})
