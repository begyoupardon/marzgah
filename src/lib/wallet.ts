import { and, asc, eq, isNull, sql } from 'drizzle-orm'

import { db as defaultDb } from '#/db'
import { billingEvents, resellerProfiles, walletEntries } from '#/db/schema'
import type { Db } from '#/db/types'

export class InsufficientFundsError extends Error {
  constructor(message = 'Insufficient wallet balance') {
    super(message)
    this.name = 'InsufficientFundsError'
  }
}

export type WalletMove = {
  resellerId: string
  amountToman: number
  reason: string
  /** (provider, reference) is the idempotency key. */
  provider: string
  reference: string
  actorUserId?: string | null
}

function assertAmount(amount: number) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new RangeError('Amount must be a positive integer')
  }
}

export async function getBalance(
  resellerId: string,
  database: Db = defaultDb,
): Promise<number> {
  const [row] = await database
    .select({
      total: sql<number>`coalesce(sum(case ${walletEntries.type} when 'credit' then ${walletEntries.amountToman} else -${walletEntries.amountToman} end), 0)`,
    })
    .from(walletEntries)
    .where(eq(walletEntries.resellerId, resellerId))
  return Number(row?.total ?? 0)
}

async function entryExists(provider: string, reference: string, database: Db) {
  const [row] = await database
    .select({ id: walletEntries.id })
    .from(walletEntries)
    .where(
      and(
        eq(walletEntries.provider, provider),
        eq(walletEntries.reference, reference),
      ),
    )
    .limit(1)
  return Boolean(row)
}

/** Idempotent credit. `applied` is false when this reference already exists. */
export async function credit(move: WalletMove, database: Db = defaultDb) {
  assertAmount(move.amountToman)
  const inserted = await database
    .insert(walletEntries)
    .values({
      id: crypto.randomUUID(),
      resellerId: move.resellerId,
      type: 'credit',
      amountToman: move.amountToman,
      reason: move.reason,
      provider: move.provider,
      reference: move.reference,
      actorUserId: move.actorUserId ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: walletEntries.id })
  return { applied: inserted.length > 0 }
}

/**
 * Idempotent debit. One atomic statement checks the balance and inserts, so
 * concurrent debits can never overdraw (works on D1, which has no
 * transactions). `overdraftToman` lets a credit limit go below zero.
 */
export async function debit(
  move: WalletMove & { overdraftToman?: number },
  database: Db = defaultDb,
) {
  assertAmount(move.amountToman)
  const overdraft = move.overdraftToman ?? 0
  const rows = await database.all<{ id: string }>(sql`
    insert into wallet_entries
      (id, reseller_id, type, amount_toman, reason, provider, reference, actor_user_id, created_at)
    select ${crypto.randomUUID()}, ${move.resellerId}, 'debit', ${move.amountToman},
      ${move.reason}, ${move.provider}, ${move.reference}, ${move.actorUserId ?? null},
      cast(unixepoch('subsecond') * 1000 as integer)
    where (
      select coalesce(sum(case type when 'credit' then amount_toman else -amount_toman end), 0)
      from wallet_entries where reseller_id = ${move.resellerId}
    ) - ${move.amountToman} >= ${-overdraft}
    on conflict do nothing
    returning id
  `)
  if (rows.length > 0) return { applied: true }
  if (await entryExists(move.provider, move.reference, database)) {
    return { applied: false }
  }
  throw new InsufficientFundsError()
}

export async function getOutstandingToman(
  resellerId: string,
  database: Db = defaultDb,
): Promise<number> {
  const [row] = await database
    .select({
      total: sql<number>`coalesce(sum(${billingEvents.amountToman}), 0)`,
    })
    .from(billingEvents)
    .where(
      and(
        eq(billingEvents.resellerId, resellerId),
        isNull(billingEvents.settledAt),
      ),
    )
  return Number(row?.total ?? 0)
}

/**
 * Throws when charging `amountToman` would push the reseller past their credit
 * limit. A NULL limit keeps the legacy post-paid behaviour (unlimited debt).
 */
export async function assertCanSpend(
  resellerId: string,
  amountToman: number,
  database: Db = defaultDb,
) {
  const [profile] = await database
    .select({ limit: resellerProfiles.creditLimitToman })
    .from(resellerProfiles)
    .where(eq(resellerProfiles.userId, resellerId))
    .limit(1)
  if (!profile || profile.limit == null) return
  const net =
    (await getBalance(resellerId, database)) -
    (await getOutstandingToman(resellerId, database))
  if (net - amountToman < -profile.limit) {
    throw new InsufficientFundsError(
      'Credit limit exceeded. Top up your wallet or settle outstanding balance.',
    )
  }
}

/**
 * Pay an unsettled billing event from the wallet when the balance covers it.
 * Idempotent: safe to retry after a crash between debit and settle.
 */
export async function settleEventFromWallet(
  eventId: string,
  database: Db = defaultDb,
): Promise<'settled' | 'insufficient' | 'already_settled'> {
  const [event] = await database
    .select()
    .from(billingEvents)
    .where(eq(billingEvents.id, eventId))
    .limit(1)
  if (!event) throw new Error('Billing event not found')
  if (event.settledAt) return 'already_settled'

  try {
    await debit(
      {
        resellerId: event.resellerId,
        amountToman: event.amountToman,
        reason: `billing:${event.type}:${event.marzbanUsername}`,
        provider: 'billing',
        reference: event.id,
      },
      database,
    )
  } catch (error) {
    if (error instanceof InsufficientFundsError) return 'insufficient'
    throw error
  }
  await database
    .update(billingEvents)
    .set({ settledAt: new Date(), settledByUserId: event.resellerId })
    .where(and(eq(billingEvents.id, event.id), isNull(billingEvents.settledAt)))
  return 'settled'
}

/** Pay the oldest unsettled billing events from the wallet while funds last. */
export async function settleOutstandingFromWallet(
  resellerId: string,
  database: Db = defaultDb,
) {
  const events = await database
    .select({ id: billingEvents.id })
    .from(billingEvents)
    .where(
      and(
        eq(billingEvents.resellerId, resellerId),
        isNull(billingEvents.settledAt),
      ),
    )
    .orderBy(asc(billingEvents.createdAt))
  let settled = 0
  for (const e of events) {
    const outcome = await settleEventFromWallet(e.id, database)
    if (outcome !== 'settled') break
    settled++
  }
  return settled
}
