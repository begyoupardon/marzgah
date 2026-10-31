import { beforeEach, expect, it } from 'bun:test'
import { hoisted, vi } from '../../../test/helpers/hoisted'
import { call } from '@orpc/server'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'

const mocks = hoisted(() => ({
  owned: vi.fn(),
  profile: vi.fn(),
  sync: vi.fn(),
  reset: vi.fn(),
  modify: vi.fn(),
  bill: vi.fn(),
  audit: vi.fn(),
  remove: vi.fn(),
  revoke: vi.fn(),
  select: vi.fn(),
  refresh: vi.fn(),
}))
vi.mock('../middleware', async () => {
  const { os } = await import('@orpc/server')
  return { authed: os.$context<{ user: { id: string; role: string } }>() }
})
vi.mock('#/db', () => ({ db: { select: mocks.select } }))
vi.mock('#/lib/marzban/quotas', () => ({
  getOwnedVpnUser: mocks.owned,
  getResellerProfile: mocks.profile,
  assertCanCreateVpnUser: mocks.profile,
  QuotaExceededError: class extends Error {},
}))
vi.mock('#/lib/marzban/sync', () => ({
  syncVpnUserFromMarzban: mocks.sync,
  softRemoveMirroredVpnUser: mocks.remove,
  refreshVpnUserMirrors: mocks.refresh,
}))
vi.mock('#/lib/marzban/client', () => ({
  marzban: {
    resetUserDataUsage: mocks.reset,
    modifyUser: mocks.modify,
    revokeUserSubscription: mocks.revoke,
  },
  MarzbanApiError: class extends Error {},
}))
vi.mock('#/lib/ledger', () => ({
  insertBillingEvent: mocks.bill,
  writeAuditLog: mocks.audit,
}))
const {
  listVpnUsers,
  deleteVpnUser,
  renewVpnUser,
  resetVpnUserUsage,
  revokeVpnUserSub,
  syncVpnUser,
  updateVpnUser,
} = await import('./vpn-users')
vi.mock('#/lib/wallet', () => ({
  assertCanSpend: async () => {},
  settleEventFromWallet: async () => 'settled',
  InsufficientFundsError: class extends Error {},
}))
const context = {
  headers: new Headers(),
  user: { id: 'owner', role: 'reseller' },
}
const username = 'ab_user'
const local = {
  id: 'vpn',
  resellerId: 'owner',
  dataLimitBytes: 10 * 1024 ** 3,
  expireAt: new Date('2026-01-01'),
  removedAt: null,
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.owned.mockResolvedValue(local)
  mocks.profile.mockResolvedValue({
    allowUnlimitedExpire: false,
    pricePerGbToman: 1000,
  })
  mocks.sync.mockResolvedValue({ ...local, expireAt: new Date('2030-01-01') })
  mocks.bill.mockResolvedValue({ id: 'bill', amountToman: 10000 })
  // The real Marzban client always returns the updated user.
  const remote = { username, status: 'active', used_traffic: 0 }
  mocks.modify.mockResolvedValue(remote)
  mocks.reset.mockResolvedValue(remote)
  mocks.revoke.mockResolvedValue(remote)
})
it('starts renewal from today, adds quota, and preserves usage', async () => {
  await call(renewVpnUser, { username, durationDays: 30 }, { context })
  const expiry = mocks.modify.mock.calls[0][1].expire
  expect(expiry).toBeGreaterThan(Date.now() / 1000 + 29 * 86_400)
  expect(expiry).toBeLessThan(Date.now() / 1000 + 31 * 86_400)
  expect(mocks.bill).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'renew', dataLimitGb: 10 }),
  )
  expect(mocks.reset).not.toHaveBeenCalled()
  expect(mocks.bill).toHaveBeenCalledOnce()
})
it('rejects renewal for unlimited quota before backend mutation or billing', async () => {
  mocks.sync.mockResolvedValue({ ...local, dataLimitBytes: null })
  await expect(
    call(renewVpnUser, { username, durationDays: 30 }, { context }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  expect(mocks.reset).not.toHaveBeenCalled()
  expect(mocks.modify).not.toHaveBeenCalled()
  expect(mocks.bill).not.toHaveBeenCalled()
})
it('rejects a locally known unlimited cap before reading the backend', async () => {
  mocks.owned.mockResolvedValue({ ...local, dataLimitBytes: null })
  await expect(
    call(renewVpnUser, { username, durationDays: 30 }, { context }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  expect(mocks.sync).not.toHaveBeenCalled()
  expect(mocks.modify).not.toHaveBeenCalled()
  expect(mocks.bill).not.toHaveBeenCalled()
})
it('rejects sub-minimum added quota before ownership, backend, or billing work', async () => {
  await expect(
    call(
      renewVpnUser,
      {
        username,
        durationDays: 30,
        additionalDataLimitBytes: 1024 ** 3,
      },
      { context },
    ),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  expect(mocks.owned).not.toHaveBeenCalled()
  expect(mocks.sync).not.toHaveBeenCalled()
  expect(mocks.modify).not.toHaveBeenCalled()
  expect(mocks.bill).not.toHaveBeenCalled()
})
it('rejects an unsafe total quota before reading or mutating the backend', async () => {
  await expect(
    call(
      renewVpnUser,
      {
        username,
        durationDays: 30,
        additionalDataLimitBytes: Number.MAX_SAFE_INTEGER,
      },
      { context },
    ),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  expect(mocks.sync).not.toHaveBeenCalled()
  expect(mocks.modify).not.toHaveBeenCalled()
  expect(mocks.bill).not.toHaveBeenCalled()
})
it('rejects unlimited renewals without reseller permission', async () => {
  await expect(
    call(renewVpnUser, { username, durationMonths: 0 }, { context }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  expect(mocks.reset).not.toHaveBeenCalled()
})
it('uses live quota when calculating extra traffic billing', async () => {
  mocks.sync.mockResolvedValue({ ...local, dataLimitBytes: 20 * 1024 ** 3 })
  await call(
    updateVpnUser,
    { username, dataLimitBytes: 30 * 1024 ** 3 },
    { context },
  )
  expect(mocks.bill).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'extra_gb', dataLimitGb: 10 }),
  )
})
it('does not bill a disable action', async () => {
  await call(updateVpnUser, { username, status: 'disabled' }, { context })
  expect(mocks.bill).not.toHaveBeenCalled()
})
it('resellers cannot remove users', async () => {
  await expect(
    call(deleteVpnUser, { username }, { context }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  expect(mocks.remove).not.toHaveBeenCalled()
})
it.each([resetVpnUserUsage, revokeVpnUserSub, syncVpnUser])(
  'rejects non-owned users before remote actions',
  async (procedure) => {
    mocks.owned.mockResolvedValue(null)
    await expect(
      call(procedure, { username }, { context }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(mocks.reset).not.toHaveBeenCalled()
    expect(mocks.revoke).not.toHaveBeenCalled()
    expect(mocks.sync).not.toHaveBeenCalled()
  },
)
it('rejects remote deleted users before renewal', async () => {
  mocks.sync.mockResolvedValue({ ...local, removedAt: new Date() })
  await expect(
    call(renewVpnUser, { username, durationMonths: 1 }, { context }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  expect(mocks.reset).not.toHaveBeenCalled()
})

it('refreshes only the authorized page and matches literal underscores in usernames', async () => {
  const pageRow = {
    ...local,
    marzbanUsername: username,
    status: 'active',
    usedTrafficBytes: 10,
    subscriptionUrl: null,
    note: null,
    lastSyncedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  const where = vi.fn()
  const pageQuery = {
    where: (condition: unknown) => {
      where(condition)
      return pageQuery
    },
    orderBy: () => pageQuery,
    limit: () => pageQuery,
    offset: async () => [pageRow],
  }
  mocks.select
    .mockReturnValueOnce({ from: () => ({ where: async () => [{ c: 1 }] }) })
    .mockReturnValueOnce({ from: () => pageQuery })
    .mockReturnValueOnce({
      from: () => ({ where: () => ({ orderBy: async () => [] }) }),
    })
  mocks.refresh.mockResolvedValue({
    rows: [{ ...pageRow, usedTrafficBytes: 99 }],
    failed: false,
  })
  const result = await call(
    listVpnUsers,
    { resellerId: 'other-owner', q: 'ab_user', page: 1, pageSize: 10 },
    { context },
  )
  expect(result.items[0].usedTrafficBytes).toBe(99)
  expect(result.syncFailed).toBe(false)
  expect(mocks.refresh).toHaveBeenCalledWith([pageRow])
  const query = new SQLiteSyncDialect().sqlToQuery(where.mock.calls[0][0])
  expect(query.params).toContain('owner')
  expect(query.params).not.toContain('other-owner')
  expect(query.params).toContain('%ab\\_user%')
  expect(query.sql).toContain("ESCAPE '\\'")
})
