import { and, gt, gte, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import { billingEvents, vpnUsers } from '#/db/schema'

export type UserView = 'expiring' | 'high_usage' | 'unpaid'

const DAY = 24 * 60 * 60 * 1000

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/**
 * Extra WHERE conditions for the users list. `expiring` = active users whose
 * plan ends within a week; `high_usage` = at least 90% of the quota used;
 * `unpaid` = has at least one unsettled billing event.
 */
export function viewCondition(view: UserView, now = new Date()): SQL {
  switch (view) {
    case 'expiring':
      return and(
        isNull(vpnUsers.removedAt),
        isNotNull(vpnUsers.expireAt),
        gt(vpnUsers.expireAt, now),
        lte(vpnUsers.expireAt, new Date(now.getTime() + 7 * DAY)),
      )!
    case 'high_usage':
      return and(
        isNull(vpnUsers.removedAt),
        gt(vpnUsers.dataLimitBytes, 0),
        gte(
          sql`${vpnUsers.usedTrafficBytes} * 10`,
          sql`${vpnUsers.dataLimitBytes} * 9`,
        ),
      )!
    case 'unpaid':
      return sql`exists (select 1 from ${billingEvents} where ${billingEvents.vpnUserId} = ${vpnUsers.id} and ${billingEvents.settledAt} is null)`
  }
}

/** Exact label match inside the JSON array column. */
export function labelCondition(label: string): SQL {
  const needle = `%${escapeLike(JSON.stringify(label))}%`
  return sql`${vpnUsers.labels} like ${needle} escape '\\'`
}

export function parseLabels(raw: string | null): string[] {
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value)
      ? value.filter((v): v is string => typeof v === 'string')
      : []
  } catch {
    return []
  }
}

export function normalizeLabels(labels: string[]): string[] {
  return [
    ...new Set(labels.map((l) => l.trim().slice(0, 30)).filter(Boolean)),
  ].slice(0, 10)
}
