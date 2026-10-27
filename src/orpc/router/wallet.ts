import { ORPCError } from '@orpc/server'
import { desc, eq } from 'drizzle-orm'
import * as z from 'zod'

import { db } from '#/db'
import { resellerProfiles, walletEntries } from '#/db/schema'
import { writeAuditLog } from '#/lib/ledger'
import {
  InsufficientFundsError,
  credit,
  debit,
  getBalance,
  getOutstandingToman,
  settleOutstandingFromWallet,
} from '#/lib/wallet'
import { adminOnly, authed } from '../middleware'

async function snapshot(resellerId: string) {
  const [profile] = await db
    .select({ creditLimitToman: resellerProfiles.creditLimitToman })
    .from(resellerProfiles)
    .where(eq(resellerProfiles.userId, resellerId))
    .limit(1)
  const entries = await db
    .select()
    .from(walletEntries)
    .where(eq(walletEntries.resellerId, resellerId))
    .orderBy(desc(walletEntries.createdAt))
    .limit(50)
  return {
    balanceToman: await getBalance(resellerId),
    outstandingToman: await getOutstandingToman(resellerId),
    creditLimitToman: profile?.creditLimitToman ?? null,
    entries: entries.map((e) => ({
      id: e.id,
      type: e.type,
      amountToman: e.amountToman,
      reason: e.reason,
      createdAt: e.createdAt.toISOString(),
    })),
  }
}

export const myWallet = authed.handler(async ({ context }) => {
  if (context.user.role === 'admin') {
    throw new ORPCError('FORBIDDEN', { message: 'Admins have no wallet' })
  }
  return snapshot(context.user.id)
})

export const resellerWallet = adminOnly
  .input(z.object({ resellerId: z.string() }))
  .handler(({ input }) => snapshot(input.resellerId))

/** Manual correction by an admin. Always audited, always idempotent per call. */
export const adjustWallet = adminOnly
  .input(
    z.object({
      resellerId: z.string(),
      type: z.enum(['credit', 'debit']),
      amountToman: z.number().int().positive(),
      reason: z.string().trim().min(3).max(200),
    }),
  )
  .handler(async ({ input, context }) => {
    const [profile] = await db
      .select({ id: resellerProfiles.id })
      .from(resellerProfiles)
      .where(eq(resellerProfiles.userId, input.resellerId))
      .limit(1)
    if (!profile)
      throw new ORPCError('NOT_FOUND', { message: 'Reseller not found' })

    const move = {
      resellerId: input.resellerId,
      amountToman: input.amountToman,
      reason: `admin:${input.reason}`,
      provider: 'admin-adjustment',
      reference: crypto.randomUUID(),
      actorUserId: context.user.id,
    }
    try {
      if (input.type === 'credit') {
        await credit(move)
        await settleOutstandingFromWallet(input.resellerId)
      } else {
        await debit(move)
      }
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        throw new ORPCError('BAD_REQUEST', {
          message: 'Balance is too low for this debit',
        })
      }
      throw error
    }
    await writeAuditLog({
      actorUserId: context.user.id,
      actorRole: 'admin',
      action: `wallet.${input.type}`,
      entityType: 'wallet',
      resellerId: input.resellerId,
      payload: { amountToman: input.amountToman, reason: input.reason },
    })
    return { balanceToman: await getBalance(input.resellerId) }
  })

/** Set the exact target balance for a reseller, automatically calculating credit or debit. */
export const setBalance = adminOnly
  .input(
    z.object({
      resellerId: z.string(),
      targetBalanceToman: z.number().int().min(0),
      reason: z.string().trim().max(200).optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const [profile] = await db
      .select({ id: resellerProfiles.id })
      .from(resellerProfiles)
      .where(eq(resellerProfiles.userId, input.resellerId))
      .limit(1)
    if (!profile)
      throw new ORPCError('NOT_FOUND', { message: 'Reseller not found' })

    const currentBalance = await getBalance(input.resellerId)
    const diff = input.targetBalanceToman - currentBalance

    if (diff > 0) {
      await credit({
        resellerId: input.resellerId,
        amountToman: diff,
        reason:
          input.reason ||
          `تنظیم مستقیم موجودی توسط مدیر (موجودی قبلی: ${currentBalance.toLocaleString('fa-IR')})`,
        provider: 'admin-set-balance',
        reference: crypto.randomUUID(),
        actorUserId: context.user.id,
      })
      await settleOutstandingFromWallet(input.resellerId)
    } else if (diff < 0) {
      await debit({
        resellerId: input.resellerId,
        amountToman: Math.abs(diff),
        reason:
          input.reason ||
          `تنظیم مستقیم موجودی توسط مدیر (موجودی قبلی: ${currentBalance.toLocaleString('fa-IR')})`,
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
      resellerId: input.resellerId,
      payload: {
        previousBalanceToman: currentBalance,
        targetBalanceToman: input.targetBalanceToman,
        diff,
        reason: input.reason,
      },
    })

    return { balanceToman: await getBalance(input.resellerId) }
  })

/** `null` restores the legacy unlimited post-paid behaviour. */
export const setCreditLimit = adminOnly
  .input(
    z.object({
      resellerId: z.string(),
      creditLimitToman: z.number().int().min(0).nullable(),
    }),
  )
  .handler(async ({ input, context }) => {
    const updated = await db
      .update(resellerProfiles)
      .set({ creditLimitToman: input.creditLimitToman })
      .where(eq(resellerProfiles.userId, input.resellerId))
      .returning({ id: resellerProfiles.id })
    if (updated.length === 0)
      throw new ORPCError('NOT_FOUND', { message: 'Reseller not found' })
    await writeAuditLog({
      actorUserId: context.user.id,
      actorRole: 'admin',
      action: 'wallet.credit_limit',
      entityType: 'reseller',
      resellerId: input.resellerId,
      payload: { creditLimitToman: input.creditLimitToman },
    })
    return { ok: true }
  })
