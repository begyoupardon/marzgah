import { beforeEach, expect, it, mock } from 'bun:test'

import { mockDb } from '../../../test/helpers/db'
import { webhookEvents } from '#/db/schema'

const db = await mockDb()
let calls = 0
let release!: () => void
const gate = new Promise<void>((r) => (release = r))
mock.module('./sync', () => ({
  syncVpnUserFromMarzban: async () => {
    calls++
    await gate
    return {}
  },
  softRemoveMirroredVpnUser: async () => {},
}))
process.env.MARZBAN_WEBHOOK_SECRET = 'secret'
const { handleWebhook } = await import('./webhook-handler')

const send = () =>
  handleWebhook({
    request: new Request('https://panel.test/api/webhooks/marzban', {
      method: 'POST',
      headers: { 'x-webhook-secret': 'secret' },
      body: JSON.stringify({
        username: 'ab_user',
        action: 'user_updated',
        enqueued_at: 7,
      }),
    }),
  })

beforeEach(() => {
  calls = 0
})

it('processes a concurrently delivered event only once', async () => {
  const first = send()
  await Bun.sleep(20)
  const second = await send()
  expect(second.status).toBe(503)
  expect(await second.json()).toEqual({ status: 'in_progress' })
  release()
  expect((await first).status).toBe(200)
  expect(calls).toBe(1)

  const rows = await db.select().from(webhookEvents)
  expect(rows).toHaveLength(1)
  expect(rows[0]?.processedAt).not.toBeNull()
  expect(rows[0]?.lockedUntil).toBeNull()

  const again = await send()
  expect(await again.json()).toEqual({ status: 'duplicate' })
  expect(calls).toBe(1)
})
