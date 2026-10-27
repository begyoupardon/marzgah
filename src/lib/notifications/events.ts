import { and, eq, gt, isNotNull, isNull, lte, sql } from 'drizzle-orm'

import { db as defaultDb } from '#/db'
import { resellerProfiles, vpnUsers, walletEntries } from '#/db/schema'
import type { Db } from '#/db/types'
import { getBalance, getOutstandingToman } from '#/lib/wallet'
import { enqueue } from './outbox'

type Deps = { db?: Db; now?: Date }

const DAY = 24 * 60 * 60 * 1000
export const EXPIRY_WARNING_DAYS = 3
export const LOW_WALLET_TOMAN = 50_000

const day = (d: Date) => d.toISOString().slice(0, 10)
const toman = (n: number) => `${n.toLocaleString('fa-IR')} تومان`

/** Users whose plan ends within the warning window; one message per expiry date. */
export async function scanExpiring({
  db = defaultDb,
  now = new Date(),
}: Deps = {}) {
  const rows = await db
    .select()
    .from(vpnUsers)
    .where(
      and(
        isNull(vpnUsers.removedAt),
        eq(vpnUsers.status, 'active'),
        isNotNull(vpnUsers.expireAt),
        gt(vpnUsers.expireAt, now),
        lte(
          vpnUsers.expireAt,
          new Date(now.getTime() + EXPIRY_WARNING_DAYS * DAY),
        ),
      ),
    )
  let queued = 0
  for (const r of rows) {
    const days = Math.max(
      1,
      Math.ceil((r.expireAt!.getTime() - now.getTime()) / DAY),
    )
    const ok = await enqueue(
      {
        userId: r.resellerId,
        event: 'expiring',
        dedupeKey: `expiring:${r.id}:${day(r.expireAt!)}`,
        text: `⏰ اشتراک ${r.marzbanUsername} حدود ${days.toLocaleString('fa-IR')} روز دیگر منقضی می‌شود.`,
      },
      { db, now },
    )
    if (ok) queued++
  }
  return queued
}

/** 90% of the quota used; one message per quota cycle (limit + expiry date). */
export async function scanLowTraffic({
  db = defaultDb,
  now = new Date(),
}: Deps = {}) {
  const rows = await db
    .select()
    .from(vpnUsers)
    .where(
      and(
        isNull(vpnUsers.removedAt),
        eq(vpnUsers.status, 'active'),
        gt(vpnUsers.dataLimitBytes, 0),
        sql`${vpnUsers.usedTrafficBytes} * 10 >= ${vpnUsers.dataLimitBytes} * 9`,
      ),
    )
  let queued = 0
  for (const r of rows) {
    const percent = Math.min(
      100,
      Math.floor((r.usedTrafficBytes / r.dataLimitBytes!) * 100),
    )
    const ok = await enqueue(
      {
        userId: r.resellerId,
        event: 'low_traffic',
        dedupeKey: `lowtraffic:${r.id}:${r.dataLimitBytes}:${r.expireAt ? day(r.expireAt) : 'none'}`,
        text: `📶 ${r.marzbanUsername} ${percent.toLocaleString('fa-IR')}٪ از حجم خود را مصرف کرده است.`,
      },
      { db, now },
    )
    if (ok) queued++
  }
  return queued
}

/**
 * Sellers who actually use the wallet (have any entry) and whose spendable
 * balance fell below the threshold. At most one message per week.
 */
export async function scanLowWallet({
  db = defaultDb,
  now = new Date(),
  threshold = LOW_WALLET_TOMAN,
}: Deps & { threshold?: number } = {}) {
  const sellers = await db
    .select({ id: resellerProfiles.userId })
    .from(resellerProfiles)
    .where(
      and(
        eq(resellerProfiles.status, 'active'),
        sql`exists (select 1 from ${walletEntries} where ${walletEntries.resellerId} = ${resellerProfiles.userId})`,
      ),
    )
  const week = Math.floor(now.getTime() / (7 * DAY))
  let queued = 0
  for (const s of sellers) {
    const net =
      (await getBalance(s.id, db)) - (await getOutstandingToman(s.id, db))
    if (net >= threshold) continue
    const ok = await enqueue(
      {
        userId: s.id,
        event: 'low_wallet',
        dedupeKey: `lowwallet:${s.id}:${week}`,
        text: `💰 موجودی کیف پول شما کم است (${toman(net)}). برای ادامه فروش آن را شارژ کنید.`,
      },
      { db, now },
    )
    if (ok) queued++
  }
  return queued
}

export async function runAllScans(deps: Deps = {}) {
  return {
    expiring: await scanExpiring(deps),
    lowTraffic: await scanLowTraffic(deps),
    lowWallet: await scanLowWallet(deps),
  }
}
