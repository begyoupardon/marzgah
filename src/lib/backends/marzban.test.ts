import { afterAll, beforeAll, beforeEach, expect, it } from 'bun:test'

import { createFakeMarzbanServer } from '../../../test/fakes/marzban-server'
import { marzban } from '#/lib/marzban/client'
import { createMarzbanBackend } from './marzban'
import { BackendError } from './types'

const realFetch = globalThis.fetch
const realEnv = { ...process.env }
let server = createFakeMarzbanServer()
const backend = createMarzbanBackend()

beforeAll(() => {
  process.env.MARZBAN_BASE_URL = 'https://marzban.test'
  process.env.MARZBAN_USERNAME = 'admin'
  process.env.MARZBAN_PASSWORD = 'secret'
})
beforeEach(() => {
  server = createFakeMarzbanServer()
  globalThis.fetch = server.fetch
  marzban.clearTokenCache()
})
afterAll(() => {
  globalThis.fetch = realFetch
  Object.assign(process.env, realEnv)
})

it('heals accounts that have protocols but no inbound tags, unless told not to', async () => {
  server.seed({
    username: 'broken_user',
    proxies: { vless: {} },
    inbounds: {},
    links: [],
  })
  await backend.getUser('broken_user', { repair: false })
  expect(server.raw('broken_user')?.inbounds).toEqual({})

  await backend.getUser('broken_user')
  expect(server.raw('broken_user')?.inbounds).toEqual({ vless: ['VLESS TCP'] })
  expect(server.raw('broken_user')?.links.length).toBeGreaterThan(0)
})

it('attaches inbound tags when creating, so the subscription is not empty', async () => {
  await backend.createUser({
    username: 'fresh_user',
    dataLimitBytes: null,
    expireAt: null,
  })
  expect(server.raw('fresh_user')?.inbounds).toEqual({ vless: ['VLESS TCP'] })
})

it('changes passwords only on password-based protocols', async () => {
  server.seed({
    username: 'vless_only',
    proxies: { vless: {} },
    inbounds: { vless: ['VLESS TCP'] },
    links: ['x'],
  })
  const error = await backend
    .updateUser('vless_only', { password: 'new-password-1' })
    .then(
      () => null,
      (e) => e,
    )
  expect(error).toBeInstanceOf(BackendError)
  expect((error as BackendError).code).toBe('UNSUPPORTED')

  server.seed({
    username: 'trojan_user',
    proxies: { trojan: { password: 'old' } },
    inbounds: { trojan: ['TROJAN'] },
    links: ['x'],
  })
  await backend.updateUser('trojan_user', { password: 'new-password-1' })
  expect(JSON.stringify(server.raw('trojan_user')?.proxies)).toContain(
    'new-password-1',
  )
})

it('maps zero or missing limits to unlimited and no expiry', async () => {
  server.seed({ username: 'zero_user', data_limit: 0, expire: 0 })
  expect(await backend.getUser('zero_user')).toMatchObject({
    dataLimitBytes: null,
    expireAt: null,
  })
})

it('translates server errors by status', async () => {
  const failing = (status: number) =>
    (async (input: string | URL) =>
      String(input).endsWith('/api/admin/token')
        ? Response.json({ access_token: 't' })
        : Response.json(
            { detail: 'boom' },
            { status },
          )) as unknown as typeof fetch
  const codeFor = async (status: number) => {
    globalThis.fetch = failing(status)
    marzban.clearTokenCache()
    const error = await backend.getUser('anyone').then(
      () => null,
      (e) => e,
    )
    expect(error).toBeInstanceOf(BackendError)
    return [(error as BackendError).code, (error as BackendError).status]
  }
  expect(await codeFor(404)).toEqual(['NOT_FOUND', 404])
  expect(await codeFor(409)).toEqual(['CONFLICT', 409])
  expect(await codeFor(422)).toEqual(['INVALID', 422])
  expect(await codeFor(503)).toEqual(['UNAVAILABLE', 503])
})

it('reports unconfigured when credentials are missing', () => {
  const saved = process.env.MARZBAN_PASSWORD
  process.env.MARZBAN_PASSWORD = ''
  expect(backend.info().configured).toBe(false)
  process.env.MARZBAN_PASSWORD = saved
  expect(backend.info()).toMatchObject({
    id: 'marzban',
    configured: true,
    baseUrl: 'https://marzban.test',
  })
})
