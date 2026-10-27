import { beforeEach, expect, it } from 'bun:test'
import { hoisted, vi } from '../../../test/helpers/hoisted'
import { handleWebhook } from './webhook-handler'

const mocks = hoisted(() => ({
  inserted: vi.fn(),
  existing: vi.fn(),
  set: vi.fn(),
  sync: vi.fn(),
  remove: vi.fn(),
}))
vi.mock('#/db', () => ({
  db: {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({ returning: mocks.inserted }),
      }),
    }),
    select: () => ({
      from: () => ({ where: () => ({ limit: mocks.existing }) }),
    }),
    update: () => ({
      set: (value: unknown) => {
        const isClaim =
          'lockedUntil' in (value as object) &&
          (value as { lockedUntil: unknown }).lockedUntil !== null
        if (!isClaim) mocks.set(value)
        return {
          where: () =>
            Object.assign(Promise.resolve(), {
              returning: async () => [{ id: 'event' }],
            }),
        }
      },
    }),
  },
}))
vi.mock('./sync', () => ({
  syncVpnUserFromMarzban: mocks.sync,
  softRemoveMirroredVpnUser: mocks.remove,
}))
const payload = {
  username: 'ab_user',
  action: 'user_updated',
  enqueued_at: 123,
}
function request(body: unknown = payload, secret = 'secret') {
  return new Request('https://panel.test/api/webhooks/marzban', {
    method: 'POST',
    headers: { 'x-webhook-secret': secret },
    body: JSON.stringify(body),
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('MARZBAN_WEBHOOK_SECRET', 'secret')
  mocks.inserted.mockResolvedValue([{ id: 'event' }])
  mocks.sync.mockResolvedValue({})
})
it('rejects invalid secrets without touching the database', async () => {
  expect(
    (await handleWebhook({ request: request(payload, 'wrong') })).status,
  ).toBe(403)
  expect(mocks.inserted).not.toHaveBeenCalled()
})
it('rejects invalid payloads', async () => {
  expect((await handleWebhook({ request: request({}) })).status).toBe(400)
})
it('marks successful events processed', async () => {
  expect((await handleWebhook({ request: request() })).status).toBe(200)
  expect(mocks.set).toHaveBeenCalledWith({
    processedAt: expect.any(Date),
    error: null,
    lockedUntil: null,
  })
})
it('returns retryable failure and leaves event unprocessed', async () => {
  mocks.sync.mockRejectedValue(new Error('upstream down'))
  expect((await handleWebhook({ request: request() })).status).toBe(503)
  expect(mocks.set).toHaveBeenCalledWith({
    processedAt: null,
    error: 'upstream down',
    lockedUntil: null,
  })
})
it('retries a previously failed event', async () => {
  mocks.inserted.mockResolvedValue([])
  mocks.existing.mockResolvedValue([
    { id: 'event', processedAt: null, error: 'upstream down' },
  ])
  expect((await handleWebhook({ request: request() })).status).toBe(200)
  expect(mocks.sync).toHaveBeenCalledWith('ab_user')
})
it('acknowledges completed duplicates without syncing', async () => {
  mocks.inserted.mockResolvedValue([])
  mocks.existing.mockResolvedValue([
    { id: 'event', processedAt: new Date(), error: null },
  ])
  expect(await (await handleWebhook({ request: request() })).json()).toEqual({
    status: 'duplicate',
  })
  expect(mocks.sync).not.toHaveBeenCalled()
})
it('does not mistake database outage for a duplicate', async () => {
  mocks.inserted.mockRejectedValue(new Error('D1 down'))
  expect((await handleWebhook({ request: request() })).status).toBe(503)
})
it('soft-removes deleted users', async () => {
  expect(
    (
      await handleWebhook({
        request: request({ ...payload, action: 'user_deleted' }),
      })
    ).status,
  ).toBe(200)
  expect(mocks.remove).toHaveBeenCalledWith('ab_user', expect.any(Object))
  expect(mocks.sync).not.toHaveBeenCalled()
})
