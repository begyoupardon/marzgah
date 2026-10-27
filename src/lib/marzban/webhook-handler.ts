import { and, eq, isNull, lt, or } from 'drizzle-orm'

import { db } from '#/db'
import { webhookEvents } from '#/db/schema'
import { marzbanWebhookPayloadSchema } from '#/lib/marzban/types'
import { verifyMarzbanWebhookSecret } from '#/lib/marzban/webhook'
import {
  softRemoveMirroredVpnUser,
  syncVpnUserFromMarzban,
} from '#/lib/marzban/sync'

const LEASE_MS = 30_000

/** Compare-and-set: only one delivery may process an event at a time. */
async function claimEvent(eventId: string) {
  const now = new Date()
  const claimed = await db
    .update(webhookEvents)
    .set({ lockedUntil: new Date(now.getTime() + LEASE_MS) })
    .where(
      and(
        eq(webhookEvents.id, eventId),
        or(
          isNull(webhookEvents.lockedUntil),
          lt(webhookEvents.lockedUntil, now),
        ),
      ),
    )
    .returning({ id: webhookEvents.id })
  return claimed.length > 0
}

export async function handleWebhook({ request }: { request: Request }) {
  if (!verifyMarzbanWebhookSecret(request.headers.get('x-webhook-secret'))) {
    return Response.json({ error: 'Invalid webhook secret' }, { status: 403 })
  }

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = marzbanWebhookPayloadSchema.safeParse(json)
  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const payload = parsed.data
  let eventId: string
  try {
    const inserted = await db
      .insert(webhookEvents)
      .values({
        id: crypto.randomUUID(),
        username: payload.username,
        action: payload.action,
        enqueuedAt: payload.enqueued_at,
        tries: payload.tries,
      })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id })
    if (inserted[0]) {
      eventId = inserted[0].id
    } else {
      const [existing] = await db
        .select()
        .from(webhookEvents)
        .where(
          and(
            eq(webhookEvents.username, payload.username),
            eq(webhookEvents.action, payload.action),
            eq(webhookEvents.enqueuedAt, payload.enqueued_at),
          ),
        )
        .limit(1)
      if (!existing)
        return Response.json({ error: 'Event unavailable' }, { status: 503 })
      if (existing.processedAt && !existing.error) {
        return Response.json({ status: 'duplicate' })
      }
      eventId = existing.id
    }
  } catch {
    return Response.json(
      { error: 'Event storage unavailable' },
      { status: 503 },
    )
  }

  try {
    if (!(await claimEvent(eventId))) {
      return Response.json({ status: 'in_progress' }, { status: 503 })
    }
    if (payload.action === 'user_deleted') {
      await softRemoveMirroredVpnUser(payload.username, {
        actorRole: 'system',
        reason: 'webhook_user_deleted',
      })
    } else {
      await syncVpnUserFromMarzban(payload.username)
    }

    await db
      .update(webhookEvents)
      .set({ processedAt: new Date(), error: null, lockedUntil: null })
      .where(eq(webhookEvents.id, eventId))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    await db
      .update(webhookEvents)
      .set({ processedAt: null, error: message, lockedUntil: null })
      .where(eq(webhookEvents.id, eventId))
    return Response.json({ error: 'Sync failed' }, { status: 503 })
  }

  return Response.json({ status: 'ok' }, { status: 200 })
}
