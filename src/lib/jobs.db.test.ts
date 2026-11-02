import { expect, it } from 'bun:test'

import { setupRouterTest } from '../../test/helpers/orpc'
import { webhookEvents } from '#/db/schema'

const db = await setupRouterTest()
const { pruneOldRows } = await import('./jobs')

it('prunes processed webhook events older than 30 days but keeps recent and unprocessed ones', async () => {
  const now = new Date('2026-06-01T00:00:00Z')
  const old = new Date('2026-04-01T00:00:00Z')
  const row = (id: string, createdAt: Date, processedAt: Date | null) => ({
    id,
    username: id,
    action: 'user_updated',
    enqueuedAt: 1,
    createdAt,
    processedAt,
  })
  await db
    .insert(webhookEvents)
    .values([
      row('old-done', old, old),
      row('old-pending', old, null),
      row('fresh-done', now, now),
    ])
  await pruneOldRows(now)
  const left = (await db.select().from(webhookEvents)).map((r) => r.id).sort()
  expect(left).toEqual(['fresh-done', 'old-pending'])
})
