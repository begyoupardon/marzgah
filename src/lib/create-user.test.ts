import { beforeEach, expect, it } from 'bun:test'
import { hoisted, vi } from '../../test/helpers/hoisted'
import { verifyPassword } from 'better-auth/crypto'
import { createCredentialUser, setCredentialPassword } from './create-user'
import { account, user } from '#/db/schema'

const mocks = hoisted(() => ({
  select: vi.fn(),
  values: vi.fn(),
  batch: vi.fn(),
  set: vi.fn(),
}))
vi.mock('#/db', () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: mocks.select }) }),
    }),
    insert: (table: unknown) => ({
      values: (value: unknown) => {
        mocks.values(table, value)
        return value
      },
    }),
    batch: mocks.batch,
    update: () => ({
      set: (value: unknown) => {
        mocks.set(value)
        return { where: async () => {} }
      },
    }),
  },
}))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.select.mockResolvedValue([])
  mocks.batch.mockResolvedValue([])
})
it('writes matching user and credential records atomically, with a working password hash', async () => {
  const created = await createCredentialUser({
    email: ' User@Example.com ',
    name: 'User',
    password: '1234',
    role: 'reseller',
  })
  expect(created.email).toBe('user@example.com')
  expect(mocks.batch).toHaveBeenCalledTimes(1)
  expect(mocks.values.mock.calls[0][0]).toBe(user)
  const credential = mocks.values.mock.calls[1][1]
  expect(mocks.values.mock.calls[1][0]).toBe(account)
  expect(credential).toMatchObject({
    userId: created.id,
    accountId: created.id,
    providerId: 'credential',
  })
  expect(
    await verifyPassword({ hash: credential.password, password: '1234' }),
  ).toBe(true)
})
it('rejects existing emails before writing', async () => {
  mocks.select.mockResolvedValue([{ id: 'existing' }])
  await expect(
    createCredentialUser({
      email: 'user@example.com',
      name: 'User',
      password: '1234',
      role: 'reseller',
    }),
  ).rejects.toThrow('User already exists')
  expect(mocks.batch).not.toHaveBeenCalled()
})
it('propagates atomic write failure', async () => {
  mocks.batch.mockRejectedValue(new Error('write failed'))
  await expect(
    createCredentialUser({
      email: 'user@example.com',
      name: 'User',
      password: '1234',
      role: 'reseller',
    }),
  ).rejects.toThrow('write failed')
})
it('updates credential password with a verifiable hash', async () => {
  mocks.select.mockResolvedValue([{ id: 'account' }])
  await setCredentialPassword('user', 'new-password')
  expect(
    await verifyPassword({
      hash: mocks.set.mock.calls[0][0].password,
      password: 'new-password',
    }),
  ).toBe(true)
})
it('reports missing credential accounts', async () => {
  await expect(setCredentialPassword('user', 'new-password')).rejects.toThrow(
    'Credential account not found',
  )
  expect(mocks.set).not.toHaveBeenCalled()
})
