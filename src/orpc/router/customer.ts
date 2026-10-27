import { ORPCError, call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import * as z from 'zod'

import { db } from '#/db'
import { resellerProfiles } from '#/db/schema'
import { getEnv } from '#/lib/env'
import { writeAuditLog } from '#/lib/ledger'
import { resolveSubscriptionUrl } from '#/lib/marzban/subscription-url'
import { getOwnedVpnUser } from '#/lib/marzban/quotas'
import { createLink, resolveToken, revokeLinks } from '#/lib/public-links'
import { clientIp, createRateLimiter } from '#/lib/rate-limit'
import {
  RenewalError,
  getRenewal,
  listPendingRenewals,
  markDecided,
  reopen,
  requestRenewal,
} from '#/lib/renewals'
import { authed, base } from '../middleware'
import { renewVpnUser } from './vpn-users'

const viewLimiter = createRateLimiter({ windowMs: 60_000, max: 60 })
const renewIpLimiter = createRateLimiter({ windowMs: 60 * 60_000, max: 10 })
const renewTokenLimiter = createRateLimiter({
  windowMs: 24 * 60 * 60_000,
  max: 3,
})

const NOT_FOUND = () =>
  new ORPCError('NOT_FOUND', { message: 'لینک معتبر نیست یا منقضی شده است' })
const tooMany = (retryAfterMs: number) =>
  new ORPCError('TOO_MANY_REQUESTS', {
    message: 'تعداد درخواست‌ها زیاد است. کمی بعد دوباره تلاش کنید.',
    data: { retryAfterSeconds: Math.ceil(retryAfterMs / 1000) },
  })

const tokenInput = z.object({ token: z.string().min(1).max(64) })

// ── public (no login) ────────────────────────────────────────────────────

export const publicView = base
  .input(tokenInput)
  .handler(async ({ input, context }) => {
    const limit = viewLimiter.hit(clientIp(context.headers))
    if (!limit.allowed) throw tooMany(limit.retryAfterMs)

    const link = await resolveToken(input.token)
    if (!link) throw NOT_FOUND()
    const u = link.vpnUser
    // Only what the customer needs. No ids, no billing, no seller email.
    return {
      username: u.marzbanUsername,
      status: u.status,
      usedBytes: u.usedTrafficBytes,
      limitBytes: u.dataLimitBytes,
      expireAt: u.expireAt?.toISOString() ?? null,
      subscriptionUrl: resolveSubscriptionUrl(u.subscriptionUrl),
      updatedAt: u.lastSyncedAt?.toISOString() ?? null,
      seller: {
        name: link.publicName ?? null,
        support: link.supportContact ?? null,
      },
      hasPendingRenewal: link.hasPendingRenewal,
    }
  })

export const publicRequestRenewal = base
  .input(
    tokenInput.extend({
      months: z.number().int().min(1).max(3),
      message: z.string().max(400).optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const ip = renewIpLimiter.hit(clientIp(context.headers))
    if (!ip.allowed) throw tooMany(ip.retryAfterMs)
    const tokenHit = renewTokenLimiter.hit(input.token)
    if (!tokenHit.allowed) throw tooMany(tokenHit.retryAfterMs)

    const link = await resolveToken(input.token)
    if (!link) throw NOT_FOUND()
    try {
      await requestRenewal({
        vpnUserId: link.vpnUser.id,
        months: input.months,
        message: input.message,
      })
    } catch (error) {
      if (error instanceof RenewalError) {
        if (error.code === 'ALREADY_PENDING') {
          throw new ORPCError('CONFLICT', {
            message: 'درخواست قبلی شما در انتظار بررسی است',
          })
        }
        throw new ORPCError('BAD_REQUEST', { message: 'درخواست نامعتبر است' })
      }
      throw error
    }
    return { ok: true }
  })

// ── sellers / admins ─────────────────────────────────────────────────────

const actorRole = (role: string) => (role === 'admin' ? 'admin' : 'reseller')

export const createCustomerLink = authed
  .input(
    z.object({
      username: z.string().min(1),
      expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
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
    const { token, expiresAt } = await createLink(owned.id, {
      expiresInDays: input.expiresInDays,
    })
    await writeAuditLog({
      actorUserId: context.user.id,
      actorRole: actorRole(context.user.role),
      action: 'customer_link.create',
      entityType: 'vpn_user',
      entityId: owned.id,
      vpnUsername: owned.marzbanUsername,
      resellerId: owned.resellerId,
      payload: { expiresAt: expiresAt?.toISOString() ?? null },
    })
    const base = (getEnv().BETTER_AUTH_URL ?? '').replace(/\/$/, '')
    return {
      url: `${base}/s/${token}`,
      expiresAt: expiresAt?.toISOString() ?? null,
    }
  })

export const revokeCustomerLink = authed
  .input(z.object({ username: z.string().min(1) }))
  .handler(async ({ input, context }) => {
    const owned = await getOwnedVpnUser(
      input.username,
      context.user.id,
      context.user.role === 'admin',
    )
    if (!owned)
      throw new ORPCError('NOT_FOUND', { message: 'کاربر VPN پیدا نشد' })
    const revoked = await revokeLinks(owned.id)
    await writeAuditLog({
      actorUserId: context.user.id,
      actorRole: actorRole(context.user.role),
      action: 'customer_link.revoke',
      entityType: 'vpn_user',
      entityId: owned.id,
      vpnUsername: owned.marzbanUsername,
      resellerId: owned.resellerId,
    })
    return { revoked }
  })

export const listRenewalRequests = authed.handler(async ({ context }) => {
  const rows = await listPendingRenewals(
    context.user.role === 'admin' ? null : context.user.id,
  )
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))
})

async function loadForDecision(id: string, user: { id: string; role: string }) {
  const found = await getRenewal(id)
  // Hide other sellers' requests entirely rather than revealing they exist.
  if (
    !found ||
    (user.role !== 'admin' && found.request.resellerId !== user.id)
  ) {
    throw new ORPCError('NOT_FOUND', { message: 'درخواست پیدا نشد' })
  }
  return found
}

/** Claim first (so a double click can't renew twice), renew, undo the claim on failure. */
export const approveRenewalRequest = authed
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const { request, username } = await loadForDecision(input.id, context.user)
    if (!(await markDecided(request.id, 'approved', context.user.id))) {
      throw new ORPCError('CONFLICT', {
        message: 'این درخواست قبلاً بررسی شده است',
      })
    }
    try {
      await call(
        renewVpnUser,
        {
          username,
          durationMonths: request.months as 1 | 2 | 3,
          resetUsage: true,
          reactivate: true,
        },
        { context: { headers: context.headers } },
      )
    } catch (error) {
      await reopen(request.id)
      throw error
    }
    await writeAuditLog({
      actorUserId: context.user.id,
      actorRole: actorRole(context.user.role),
      action: 'renewal_request.approve',
      entityType: 'renewal_request',
      entityId: request.id,
      vpnUsername: username,
      resellerId: request.resellerId,
      payload: { months: request.months },
    })
    return { ok: true }
  })

export const rejectRenewalRequest = authed
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const { request, username } = await loadForDecision(input.id, context.user)
    if (!(await markDecided(request.id, 'rejected', context.user.id))) {
      throw new ORPCError('CONFLICT', {
        message: 'این درخواست قبلاً بررسی شده است',
      })
    }
    await writeAuditLog({
      actorUserId: context.user.id,
      actorRole: actorRole(context.user.role),
      action: 'renewal_request.reject',
      entityType: 'renewal_request',
      entityId: request.id,
      vpnUsername: username,
      resellerId: request.resellerId,
    })
    return { ok: true }
  })

const brandingInput = z.object({
  publicName: z.string().trim().max(60).nullable(),
  supportContact: z.string().trim().max(120).nullable(),
})

export const getBranding = authed.handler(async ({ context }) => {
  const [row] = await db
    .select({
      publicName: resellerProfiles.publicName,
      supportContact: resellerProfiles.supportContact,
    })
    .from(resellerProfiles)
    .where(eq(resellerProfiles.userId, context.user.id))
    .limit(1)
  if (!row)
    throw new ORPCError('NOT_FOUND', { message: 'پروفایل نماینده یافت نشد' })
  return row
})

export const setBranding = authed
  .input(brandingInput)
  .handler(async ({ input, context }) => {
    const updated = await db
      .update(resellerProfiles)
      .set({
        publicName: input.publicName || null,
        supportContact: input.supportContact || null,
      })
      .where(eq(resellerProfiles.userId, context.user.id))
      .returning({ id: resellerProfiles.id })
    if (updated.length === 0)
      throw new ORPCError('NOT_FOUND', { message: 'پروفایل نماینده یافت نشد' })
    return { ok: true }
  })
