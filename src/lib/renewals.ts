import { and, desc, eq } from 'drizzle-orm'

import { db as defaultDb } from '#/db'
import { renewalRequests, vpnUsers } from '#/db/schema'
import type { Db } from '#/db/types'
import { enqueue } from '#/lib/notifications/outbox'

type Deps = { db?: Db; now?: Date }

export class RenewalError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'ALREADY_PENDING'
      | 'BAD_INPUT'
      | 'NOT_FOUND'
      | 'NOT_PENDING',
  ) {
    super(message)
    this.name = 'RenewalError'
  }
}

/** Strip control characters and cap length; messages are shown to sellers. */
export function cleanMessage(raw: string | undefined | null) {
  const text = (raw ?? '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text ? text.slice(0, 200) : null
}

export async function requestRenewal(
  input: {
    vpnUserId: string
    durationDays?: number
    months?: number
    message?: string | null
  },
  { db = defaultDb, now = new Date() }: Deps = {},
) {
  const legacy = input.durationDays === undefined
  if (
    legacy
      ? !Number.isInteger(input.months) ||
        input.months! < 1 ||
        input.months! > 3
      : ![30, 60, 90].includes(input.durationDays!)
  ) {
    throw new RenewalError('duration must be 30, 60, or 90 days', 'BAD_INPUT')
  }
  const [target] = await db
    .select()
    .from(vpnUsers)
    .where(eq(vpnUsers.id, input.vpnUserId))
    .limit(1)
  if (!target || target.removedAt)
    throw new RenewalError('not found', 'NOT_FOUND')

  const id = crypto.randomUUID()
  try {
    await db.insert(renewalRequests).values({
      id,
      vpnUserId: target.id,
      resellerId: target.resellerId,
      months: legacy ? input.months! : 1,
      durationDays: legacy ? null : input.durationDays!,
      message: cleanMessage(input.message),
    })
  } catch {
    // the partial unique index: one open request per customer
    throw new RenewalError('A request is already waiting', 'ALREADY_PENDING')
  }
  try {
    await enqueue(
      {
        userId: target.resellerId,
        event: 'renewal_requested',
        dedupeKey: `renewal-requested:${id}`,
        text: legacy
          ? `🔁 ${target.marzbanUsername} درخواست تمدید ${input.months!.toLocaleString('fa-IR')} ماهه داده است.`
          : `🔁 ${target.marzbanUsername} درخواست تمدید ${input.durationDays!.toLocaleString('fa-IR')} روزه داده است.`,
      },
      { db, now },
    )
  } catch (error) {
    console.error('renewal notification failed', error)
  }
  return { id }
}

export async function listPendingRenewals(
  resellerId: string | null,
  db: Db = defaultDb,
) {
  return db
    .select({
      id: renewalRequests.id,
      months: renewalRequests.months,
      durationDays: renewalRequests.durationDays,
      message: renewalRequests.message,
      createdAt: renewalRequests.createdAt,
      username: vpnUsers.marzbanUsername,
      resellerId: renewalRequests.resellerId,
    })
    .from(renewalRequests)
    .innerJoin(vpnUsers, eq(vpnUsers.id, renewalRequests.vpnUserId))
    .where(
      and(
        eq(renewalRequests.status, 'pending'),
        resellerId ? eq(renewalRequests.resellerId, resellerId) : undefined,
      ),
    )
    .orderBy(desc(renewalRequests.createdAt))
}

export async function getRenewal(id: string, db: Db = defaultDb) {
  const [row] = await db
    .select({ request: renewalRequests, username: vpnUsers.marzbanUsername })
    .from(renewalRequests)
    .innerJoin(vpnUsers, eq(vpnUsers.id, renewalRequests.vpnUserId))
    .where(eq(renewalRequests.id, id))
    .limit(1)
  return row ?? null
}

/** Compare-and-set so a request can be decided only once. */
export async function markDecided(
  id: string,
  status: 'approved' | 'rejected',
  actorId: string,
  { db = defaultDb, now = new Date() }: Deps = {},
) {
  const updated = await db
    .update(renewalRequests)
    .set({ status, decidedByUserId: actorId, decidedAt: now })
    .where(
      and(eq(renewalRequests.id, id), eq(renewalRequests.status, 'pending')),
    )
    .returning({ id: renewalRequests.id })
  return updated.length > 0
}

/** Put a claimed request back (renewal failed after we claimed it). */
export async function reopen(id: string, db: Db = defaultDb) {
  await db
    .update(renewalRequests)
    .set({ status: 'pending', decidedByUserId: null, decidedAt: null })
    .where(eq(renewalRequests.id, id))
}
