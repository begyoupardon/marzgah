import { beforeEach, describe, expect, it } from 'bun:test'
import { hoisted, vi } from '../../../test/helpers/hoisted'
import { MarzbanApiError } from './client'
import {
  mapMarzbanUserToMirror,
  refreshVpnUserMirrors,
  syncVpnUserFromMarzban,
} from './sync'
import { marzbanUserResponseSchema } from './types'

const mocks = hoisted(() => ({
  getUser: vi.fn(),
  modifyUser: vi.fn(),
  getInbounds: vi.fn(),
  select: vi.fn(),
  set: vi.fn(),
  insert: vi.fn(),
  audit: vi.fn(),
}))
vi.mock('#/db', () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: mocks.select }) }),
    }),
    update: () => ({
      set: (value: unknown) => {
        mocks.set(value)
        return { where: async () => {} }
      },
    }),
    insert: () => ({ values: mocks.insert }),
  },
}))
vi.mock('#/lib/ledger', () => ({ writeAuditLog: mocks.audit }))
vi.mock('./client.ts', () => ({
  marzban: mocks,
  MarzbanApiError: class extends Error {
    constructor(
      message: string,
      public status: number,
    ) {
      super(message)
    }
  },
}))

const remote = marzbanUserResponseSchema.parse({
  username: 'ab_user',
  status: 'active',
  used_traffic: 456,
  lifetime_used_traffic: 999,
  data_limit: 1024,
  expire: 1800000000,
})
const existing = {
  id: 'vpn',
  resellerId: 'owner',
  marzbanUsername: remote.username,
  removedAt: null,
  usedTrafficBytes: 1,
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.select.mockResolvedValue([existing])
  mocks.getUser.mockResolvedValue(remote)
})
describe('Marzban sync', () => {
  it('maps current traffic, quota and Unix seconds exactly', () => {
    expect(mapMarzbanUserToMirror(remote, 'owner', 'vpn')).toMatchObject({
      id: 'vpn',
      usedTrafficBytes: 456,
      dataLimitBytes: 1024,
      expireAt: new Date(1800000000000),
    })
  })
  it.each([null, 0, undefined])(
    'normalizes unlimited quota and expiry %s',
    (value) => {
      expect(
        mapMarzbanUserToMirror(
          { ...remote, data_limit: value, expire: value },
          'owner',
        ),
      ).toMatchObject({ dataLimitBytes: null, expireAt: null })
    },
  )
  it('refreshes live values without modifying remote inbounds', async () => {
    const result = await refreshVpnUserMirrors([existing])
    expect(result.rows[0]).toMatchObject({
      usedTrafficBytes: 456,
      expireAt: new Date(1800000000000),
    })
    expect(result.failed).toBe(false)
    expect(mocks.getInbounds).not.toHaveBeenCalled()
    expect(mocks.modifyUser).not.toHaveBeenCalled()
  })
  it('retains last known values and reports upstream failure', async () => {
    mocks.getUser.mockRejectedValue(new Error('network'))
    expect(await refreshVpnUserMirrors([existing])).toEqual({
      rows: [existing],
      failed: true,
    })
  })
  it('does not refresh soft-removed users', async () => {
    await refreshVpnUserMirrors([{ ...existing, removedAt: new Date() }])
    expect(mocks.getUser).not.toHaveBeenCalled()
  })
  it('soft-removes remote 404 without deleting billing history', async () => {
    mocks.getUser.mockRejectedValue(new MarzbanApiError('missing', 404))
    expect(await syncVpnUserFromMarzban(remote.username)).toMatchObject({
      status: 'disabled',
      removedAt: expect.any(Date),
    })
    expect(mocks.audit).toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it('does not assign orphan remote users to another owner', async () => {
    mocks.select.mockResolvedValue([])
    expect(
      await syncVpnUserFromMarzban(remote.username, { repairInbounds: false }),
    ).toBeNull()
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it('preserves ownership unless explicitly reassigned', async () => {
    const result = await syncVpnUserFromMarzban(remote.username, {
      resellerId: 'different',
      repairInbounds: false,
    })
    expect(result?.resellerId).toBe('owner')
    expect(mocks.set.mock.calls[0][0]).not.toHaveProperty('resellerId')
  })
})

it('stops scheduling more upstream reads after an outage', async () => {
  mocks.getUser.mockRejectedValue(new Error('upstream down'))
  const rows = Array.from({ length: 50 }, () => ({ ...existing }))
  expect((await refreshVpnUserMirrors(rows)).failed).toBe(true)
  expect(mocks.getUser.mock.calls.length).toBeLessThanOrEqual(5)
})
it('reuses recently synchronized mirrors until the next refresh interval', async () => {
  const row = { ...existing, lastSyncedAt: new Date() }
  expect((await refreshVpnUserMirrors([row])).rows).toEqual([row])
  expect(mocks.getUser).not.toHaveBeenCalled()
})
