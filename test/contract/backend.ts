import { beforeEach, describe, expect, it } from 'bun:test'

import { BackendError } from '#/lib/backends/types'
import type { BackendErrorCode, VpnBackend } from '#/lib/backends/types'

export type ContractHarness = {
  backend: VpnBackend
  /** Make a user consume traffic, as the real service would. */
  addUsage: (username: string, bytes: number) => void
}

const GB = 1024 ** 3
const expectCode = async (
  promise: Promise<unknown>,
  code: BackendErrorCode,
) => {
  const error = await promise.then(
    () => null,
    (e) => e,
  )
  expect(error).toBeInstanceOf(BackendError)
  expect((error as BackendError).code).toBe(code)
}

/**
 * Behaviour every VpnBackend must share. Run it against each implementation
 * (fake, Marzban adapter, any future adapter) so they stay interchangeable.
 */
export function backendContract(
  name: string,
  makeHarness: () => Promise<ContractHarness> | ContractHarness,
) {
  describe(`VpnBackend contract: ${name}`, () => {
    let h: ContractHarness
    let n = 0
    const newName = () => `user_${++n}`
    const expire = new Date('2030-06-01T12:00:00Z')

    beforeEach(async () => {
      h = await makeHarness()
    })

    it('creates a user that reads back with the same limits', async () => {
      const username = newName()
      const created = await h.backend.createUser({
        username,
        dataLimitBytes: 10 * GB,
        expireAt: expire,
        note: 'hello',
      })
      const read = await h.backend.getUser(username)
      for (const u of [created, read]) {
        expect(u).toMatchObject({
          username,
          status: 'active',
          usedBytes: 0,
          dataLimitBytes: 10 * GB,
          note: 'hello',
        })
        expect(u.expireAt?.getTime()).toBe(expire.getTime())
        expect(u.subscriptionUrl).not.toBe('')
      }
    })

    it('supports unlimited volume and no expiry', async () => {
      const username = newName()
      await h.backend.createUser({
        username,
        dataLimitBytes: null,
        expireAt: null,
      })
      expect(await h.backend.getUser(username)).toMatchObject({
        dataLimitBytes: null,
        expireAt: null,
        note: null,
      })
    })

    it('reports duplicates and missing users with stable error codes', async () => {
      const username = newName()
      await h.backend.createUser({
        username,
        dataLimitBytes: null,
        expireAt: null,
      })
      await expectCode(
        h.backend.createUser({
          username,
          dataLimitBytes: null,
          expireAt: null,
        }),
        'CONFLICT',
      )
      await expectCode(h.backend.getUser('nobody_here'), 'NOT_FOUND')
      await expectCode(
        h.backend.updateUser('nobody_here', { note: 'x' }),
        'NOT_FOUND',
      )
      await expectCode(h.backend.resetUsage('nobody_here'), 'NOT_FOUND')
      await expectCode(h.backend.revokeSubscription('nobody_here'), 'NOT_FOUND')
      await expectCode(h.backend.deleteUser('nobody_here'), 'NOT_FOUND')
    })

    it('updates only the fields that are present', async () => {
      const username = newName()
      await h.backend.createUser({
        username,
        dataLimitBytes: 10 * GB,
        expireAt: expire,
        note: 'keep',
      })

      const disabled = await h.backend.updateUser(username, {
        status: 'disabled',
      })
      expect(disabled).toMatchObject({
        status: 'disabled',
        dataLimitBytes: 10 * GB,
        note: 'keep',
      })
      expect(disabled.expireAt?.getTime()).toBe(expire.getTime())

      const bigger = await h.backend.updateUser(username, {
        dataLimitBytes: 50 * GB,
        status: 'active',
      })
      expect(bigger).toMatchObject({
        status: 'active',
        dataLimitBytes: 50 * GB,
        note: 'keep',
      })

      const noExpiry = await h.backend.updateUser(username, { expireAt: null })
      expect(noExpiry.expireAt).toBeNull()
      expect(noExpiry.dataLimitBytes).toBe(50 * GB)

      const unlimited = await h.backend.updateUser(username, {
        dataLimitBytes: null,
        note: null,
      })
      expect(unlimited).toMatchObject({ dataLimitBytes: null, note: null })

      const later = new Date('2031-01-01T00:00:00Z')
      expect(
        (
          await h.backend.updateUser(username, { expireAt: later })
        ).expireAt?.getTime(),
      ).toBe(later.getTime())
    })

    it('resets usage and brings a limited user back', async () => {
      const username = newName()
      await h.backend.createUser({
        username,
        dataLimitBytes: 10 * GB,
        expireAt: null,
      })
      h.addUsage(username, 10 * GB)
      expect(await h.backend.getUser(username)).toMatchObject({
        usedBytes: 10 * GB,
        status: 'limited',
      })
      expect(await h.backend.resetUsage(username)).toMatchObject({
        usedBytes: 0,
        status: 'active',
      })
      expect((await h.backend.getUser(username)).usedBytes).toBe(0)
    })

    it('revoking a subscription issues a different link', async () => {
      const username = newName()
      const before = await h.backend.createUser({
        username,
        dataLimitBytes: null,
        expireAt: null,
      })
      const after = await h.backend.revokeSubscription(username)
      expect(after.subscriptionUrl).not.toBe('')
      expect(after.subscriptionUrl).not.toBe(before.subscriptionUrl)
      expect((await h.backend.getUser(username)).subscriptionUrl).toBe(
        after.subscriptionUrl,
      )
    })

    it('deletes users for good', async () => {
      const username = newName()
      await h.backend.createUser({
        username,
        dataLimitBytes: null,
        expireAt: null,
      })
      await h.backend.deleteUser(username)
      await expectCode(h.backend.getUser(username), 'NOT_FOUND')
    })

    it('lists with paging, name filter and a correct total', async () => {
      const prefix = `list${++n}_`
      for (let i = 0; i < 5; i++)
        await h.backend.createUser({
          username: `${prefix}${i}`,
          dataLimitBytes: null,
          expireAt: null,
        })
      await h.backend.createUser({
        username: `other_${n}`,
        dataLimitBytes: null,
        expireAt: null,
      })

      const firstPage = await h.backend.listUsers({
        username: prefix,
        offset: 0,
        limit: 2,
      })
      expect(firstPage.total).toBe(5)
      expect(firstPage.users).toHaveLength(2)
      const rest = await h.backend.listUsers({
        username: prefix,
        offset: 2,
        limit: 10,
      })
      expect(rest.users).toHaveLength(3)
      const names = [...firstPage.users, ...rest.users].map((u) => u.username)
      expect(new Set(names).size).toBe(5)
      expect(names.every((x) => x.startsWith(prefix))).toBe(true)

      await h.backend.updateUser(`${prefix}1`, { status: 'disabled' })
      const disabled = await h.backend.listUsers({
        username: prefix,
        status: 'disabled',
      })
      expect(disabled.users.map((u) => u.username)).toEqual([`${prefix}1`])
    })

    it('describes itself and passes a health check', async () => {
      const info = h.backend.info()
      expect(info.id).toBe(h.backend.id)
      expect(info.configured).toBe(true)
      const health = await h.backend.health()
      expect(Object.keys(health).sort()).toEqual([
        'activeUsers',
        'incomingBytes',
        'outgoingBytes',
        'totalUsers',
        'version',
      ])
    })
  })
}
