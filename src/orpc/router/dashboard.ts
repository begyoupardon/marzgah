import { and, asc, count, desc, eq, sum, isNull } from 'drizzle-orm'
import * as z from 'zod'

import { db } from '#/db'
import { resellerProfiles, vpnUsers, webhookEvents } from '#/db/schema'
import { getResellerProfile } from '#/lib/marzban/quotas'
import { viewCondition } from '#/lib/user-filters'
import { authed } from '../middleware'

export const getDashboard = authed
  .input(
    z.object({
      resellerId: z.string().optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const resellerId =
      context.user.role === 'admin'
        ? (input.resellerId ?? null)
        : context.user.id

    const whereClause = resellerId
      ? and(isNull(vpnUsers.removedAt), eq(vpnUsers.resellerId, resellerId))
      : isNull(vpnUsers.removedAt)

    const [totals] = await db
      .select({
        total: count(),
        usedTraffic: sum(vpnUsers.usedTrafficBytes),
        dataLimit: sum(vpnUsers.dataLimitBytes),
      })
      .from(vpnUsers)
      .where(whereClause)

    const [active] = await db
      .select({ c: count() })
      .from(vpnUsers)
      .where(
        whereClause
          ? and(whereClause, eq(vpnUsers.status, 'active'))
          : eq(vpnUsers.status, 'active'),
      )

    const [limited] = await db
      .select({ c: count() })
      .from(vpnUsers)
      .where(
        whereClause
          ? and(whereClause, eq(vpnUsers.status, 'limited'))
          : eq(vpnUsers.status, 'limited'),
      )

    const [expired] = await db
      .select({ c: count() })
      .from(vpnUsers)
      .where(
        whereClause
          ? and(whereClause, eq(vpnUsers.status, 'expired'))
          : eq(vpnUsers.status, 'expired'),
      )

    const [disabled] = await db
      .select({ c: count() })
      .from(vpnUsers)
      .where(
        whereClause
          ? and(whereClause, eq(vpnUsers.status, 'disabled'))
          : eq(vpnUsers.status, 'disabled'),
      )

    const atRisk = (view: 'expiring' | 'high_usage' | 'unpaid') =>
      whereClause ? and(whereClause, viewCondition(view)) : viewCondition(view)
    const [expiringCount] = await db
      .select({ c: count() })
      .from(vpnUsers)
      .where(atRisk('expiring'))
    const [highUsageCount] = await db
      .select({ c: count() })
      .from(vpnUsers)
      .where(atRisk('high_usage'))
    const [unpaidCount] = await db
      .select({ c: count() })
      .from(vpnUsers)
      .where(atRisk('unpaid'))
    const expiringSoon = await db
      .select({
        username: vpnUsers.marzbanUsername,
        expireAt: vpnUsers.expireAt,
        phone: vpnUsers.contactPhone,
        telegram: vpnUsers.contactTelegram,
      })
      .from(vpnUsers)
      .where(atRisk('expiring'))
      .orderBy(asc(vpnUsers.expireAt))
      .limit(10)

    const profile =
      context.user.role === 'reseller'
        ? await getResellerProfile(context.user.id)
        : resellerId
          ? await getResellerProfile(resellerId)
          : null

    const recentEvents =
      context.user.role === 'admin'
        ? await db
            .select()
            .from(webhookEvents)
            .orderBy(desc(webhookEvents.createdAt))
            .limit(20)
        : []

    const [resellerCount] =
      context.user.role === 'admin'
        ? await db.select({ c: count() }).from(resellerProfiles)
        : [{ c: 0 }]

    return {
      user: context.user,
      stats: {
        totalUsers: Number(totals?.total ?? 0),
        activeUsers: Number(active?.c ?? 0),
        limitedUsers: Number(limited?.c ?? 0),
        expiredUsers: Number(expired?.c ?? 0),
        disabledUsers: Number(disabled?.c ?? 0),
        usedTrafficBytes: Number(totals?.usedTraffic ?? 0),
        dataLimitBytes: Number(totals?.dataLimit ?? 0),
        resellerCount: Number(resellerCount?.c ?? 0),
      },
      atRisk: {
        expiring: Number(expiringCount?.c ?? 0),
        highUsage: Number(highUsageCount?.c ?? 0),
        unpaid: Number(unpaidCount?.c ?? 0),
        expiringSoon: expiringSoon.map((u) => ({
          ...u,
          expireAt: u.expireAt?.toISOString() ?? null,
        })),
      },
      profile,
      recentEvents: recentEvents.map((e) => ({
        ...e,
        processedAt: e.processedAt?.toISOString() ?? null,
        createdAt: e.createdAt.toISOString(),
      })),
    }
  })

export const getMe = authed.handler(async ({ context }) => {
  const profile =
    context.user.role === 'reseller'
      ? await getResellerProfile(context.user.id)
      : null

  return {
    user: context.user,
    profile,
  }
})
