import { afterEach, beforeEach, expect, it } from 'bun:test'
import { vi } from '../../../test/helpers/hoisted'
import { marzban, MarzbanApiError } from './client'

const fetchMock = vi.fn()
const remote = {
  username: 'ab_user',
  status: 'active',
  data_limit: 0,
  used_traffic: 123,
  expire: 1800000000,
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })
beforeEach(() => {
  vi.stubEnv('MARZBAN_BASE_URL', 'https://marzban.test/')
  vi.stubEnv('MARZBAN_USERNAME', 'admin')
  vi.stubEnv('MARZBAN_PASSWORD', 'password')
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  marzban.clearTokenCache()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
it('authenticates and reuses the token for subsequent reads', async () => {
  fetchMock
    .mockResolvedValueOnce(json({ access_token: 'token' }))
    .mockImplementation(async () => json(remote))
  expect((await marzban.getUser('ab_user')).used_traffic).toBe(123)
  await marzban.getUser('ab_user')
  expect(fetchMock).toHaveBeenCalledTimes(3)
  expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer token')
  expect(fetchMock.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal)
})
it('refreshes an expired upstream token once', async () => {
  fetchMock
    .mockResolvedValueOnce(json({ access_token: 'old' }))
    .mockResolvedValueOnce(json({}, 401))
    .mockResolvedValueOnce(json({ access_token: 'new' }))
    .mockResolvedValueOnce(json(remote))
  await marzban.getUser('ab_user')
  expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe('Bearer new')
})
it('does not loop indefinitely on authentication failure', async () => {
  fetchMock
    .mockResolvedValueOnce(json({ access_token: 'old' }))
    .mockResolvedValueOnce(json({}, 401))
    .mockResolvedValueOnce(json({ access_token: 'new' }))
    .mockResolvedValueOnce(json({}, 401))
  await expect(marzban.getUser('ab_user')).rejects.toMatchObject({
    status: 401,
  })
  expect(fetchMock).toHaveBeenCalledTimes(4)
})
it('preserves upstream 404 for soft removal', async () => {
  fetchMock
    .mockResolvedValueOnce(json({ access_token: 'token' }))
    .mockResolvedValueOnce(json({ detail: 'missing' }, 404))
  await expect(marzban.getUser('ab_user')).rejects.toBeInstanceOf(
    MarzbanApiError,
  )
})
it('rejects malformed remote data instead of corrupting mirrors', async () => {
  fetchMock
    .mockResolvedValueOnce(json({ access_token: 'token' }))
    .mockResolvedValueOnce(json({ username: 'ab_user', status: 'invalid' }))
  await expect(marzban.getUser('ab_user')).rejects.toThrow()
})
it('handles successful no-content deletion', async () => {
  fetchMock
    .mockResolvedValueOnce(json({ access_token: 'token' }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
  await expect(marzban.deleteUser('ab_user')).resolves.toBeUndefined()
})

it('shares a token request across concurrent page refreshes', async () => {
  fetchMock
    .mockResolvedValueOnce(json({ access_token: 'token' }))
    .mockImplementation(async () => json(remote))
  await Promise.all(Array.from({ length: 5 }, () => marzban.getUser('ab_user')))
  expect(
    fetchMock.mock.calls.filter(([url]) => url.endsWith('/api/admin/token')),
  ).toHaveLength(1)
})
