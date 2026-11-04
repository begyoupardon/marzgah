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
import { outputSpec } from '../openapi-response'

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

const walletOutput = z.object({
  balanceToman: z.number(),
  outstandingToman: z.number(),
  creditLimitToman: z.number().nullable(),
  entries: z.array(
    z.object({
      id: z.string(),
      type: z.enum(['credit', 'debit']),
      amountToman: z.number(),
      reason: z.string(),
      createdAt: z.string(),
    }),
  ),
})

export const myWallet = authed
  .route({
    summary: 'Get my wallet',
    description:
      'Return the reseller wallet balance, debt, credit limit, and recent entries.',
    tags: ['Wallet'],
    spec: outputSpec('wallet.myWallet'),
  })
  .output(walletOutput)
  .handler(async ({ context }) => {
    if (context.user.role === 'admin') {
      throw new ORPCError('FORBIDDEN', { message: 'Admins have no wallet' })
    }
    return snapshot(context.user.id)
  })

export const resellerWallet = adminOnly
  .route({
    summary: 'Get reseller wallet',
    description:
      'Use this operation to get reseller wallet under the caller’s current role and ownership rules.',
    tags: ['Wallet'],
    spec: outputSpec('wallet.resellerWallet'),
  })
  .input(z.object({ resellerId: z.string() }))
  .output(walletOutput)
  .handler(({ input }) => snapshot(input.resellerId))

/** Manual correction by an admin. Always audited, always idempotent per call. */
export const adjustWallet = adminOnly
  .route({
    summary: 'Adjust wallet',
    description:
      'Use this operation to adjust wallet under the caller’s current role and ownership rules.',
    tags: ['Wallet'],
    spec: outputSpec('wallet.adjustWallet'),
  })
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
  .route({
    summary: 'Set wallet balance',
    description:
      'Use this operation to set wallet balance under the caller’s current role and ownership rules.',
    tags: ['Wallet'],
    spec: outputSpec('wallet.setBalance'),
  })
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
    const outstanding = await getOutstandingToman(input.resellerId)
    const diff = input.targetBalanceToman + outstanding - currentBalance

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

    await settleOutstandingFromWallet(input.resellerId)

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
  .route({
    summary: 'Set credit limit',
    description:
      'Use this operation to set credit limit under the caller’s current role and ownership rules.',
    tags: ['Wallet'],
    spec: outputSpec('wallet.setCreditLimit'),
  })
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
