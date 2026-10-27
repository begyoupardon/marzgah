import { beforeEach, expect, it } from 'bun:test'
import { hoisted, vi } from '../../test/helpers/hoisted'
import { call } from '@orpc/server'
import { adminOnly, authed } from './middleware'

const mocks = hoisted(() => ({ session: vi.fn(), role: vi.fn() }))
vi.mock('#/lib/auth', () => ({ auth: { api: { getSession: mocks.session } } }))
vi.mock('#/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: mocks.role }) }) }),
  },
}))
const context = { headers: new Headers() }
const readRole = authed.handler(({ context: ctx }) => ctx.user.role)
const adminProcedure = adminOnly.handler(() => 'allowed')
beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({
    user: {
      id: 'user',
      name: 'User',
      email: 'user@example.com',
      role: 'admin',
    },
    session: {},
  })
  mocks.role.mockResolvedValue([{ role: 'reseller' }])
})
it('rejects requests with no session', async () => {
  mocks.session.mockResolvedValue(null)
  await expect(call(readRole, undefined, { context })).rejects.toMatchObject({
    code: 'UNAUTHORIZED',
  })
})
it('uses the database role after an admin is demoted', async () => {
  expect(await call(readRole, undefined, { context })).toBe('reseller')
  await expect(
    call(adminProcedure, undefined, { context }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' })
})
it('allows database admins even when session role is missing', async () => {
  mocks.role.mockResolvedValue([{ role: 'admin' }])
  mocks.session.mockResolvedValue({
    user: { id: 'user', name: 'User', email: 'user@example.com' },
    session: {},
  })
  expect(await call(adminProcedure, undefined, { context })).toBe('allowed')
})
it('never grants admin access to a deleted account with a stale session', async () => {
  mocks.role.mockResolvedValue([])
  await expect(
    call(adminProcedure, undefined, { context }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' })
})
