import { afterAll, beforeAll } from 'bun:test'

import { backendContract } from '../../../test/contract/backend'
import { FakeBackend } from '../../../test/fakes/backend'
import { createFakeMarzbanServer } from '../../../test/fakes/marzban-server'
import { marzban } from '#/lib/marzban/client'
import { createMarzbanBackend } from './marzban'

backendContract('FakeBackend', () => {
  const backend = new FakeBackend()
  return { backend, addUsage: (u: string, b: number) => backend.addUsage(u, b) }
})

// The real Marzban client + adapter, talking to an emulated Marzban over "HTTP".
const realFetch = globalThis.fetch
const realEnv = { ...process.env }
const server = createFakeMarzbanServer()

beforeAll(() => {
  globalThis.fetch = server.fetch
  process.env.MARZBAN_BASE_URL = 'https://marzban.test'
  process.env.MARZBAN_USERNAME = 'admin'
  process.env.MARZBAN_PASSWORD = 'secret'
  marzban.clearTokenCache()
})
afterAll(() => {
  globalThis.fetch = realFetch
  Object.assign(process.env, realEnv)
})

backendContract('Marzban adapter', () => ({
  backend: createMarzbanBackend(),
  addUsage: (u: string, b: number) => server.addUsage(u, b),
}))
