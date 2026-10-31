import { hashPassword } from 'better-auth/crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'

import { createBunDb } from '../src/db/bun'
import { account, billingEvents, user, vpnUsers } from '../src/db/schema'
import { makeReseller, makeUser } from '../test/helpers/factories'

const base = new URL(process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4179')
if (!['127.0.0.1', 'localhost', '::1'].includes(base.hostname)) {
  throw new Error('Refusing to start E2E app on a non-local URL')
}
const appPort = Number(base.port || 4179)
async function unusedPort() {
  const probe = createServer()
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', resolve)
  })
  const port = (probe.address() as import('node:net').AddressInfo).port
  await new Promise<void>((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  )
  return port
}
const marzbanPort = await unusedPort()
const portFile = join(import.meta.dir, '../.playwright-e2e-port')
writeFileSync(portFile, String(marzbanPort))
const tempDir = mkdtempSync(join(tmpdir(), 'marzgah-e2e-'))
const dbPath = join(tempDir, 'panel.db')
const email = 'reseller.e2e@example.test'
const password = 'E2E-only-password-12345'
const authSecret = 'e2e-secret-at-least-thirty-two-characters-long'

process.env.DATABASE_PATH = dbPath
const { Database } = await import('bun:sqlite')
const { drizzle } = await import('drizzle-orm/bun-sqlite')
const migrationDb = drizzle(new Database(dbPath, { create: true }))
migrate(migrationDb, { migrationsFolder: join(import.meta.dir, '../drizzle') })
const db = await createBunDb(dbPath)

const admin = await makeUser(db, 'admin', {
  email: 'admin.e2e@example.test',
  name: 'E2E Admin',
})
const reseller = await makeReseller(db, {
  usernameSuffix: 'e2e',
  pricePerGbToman: 1200,
})
await db
  .update(user)
  .set({ email, name: 'E2E Reseller' })
  .where((await import('drizzle-orm')).eq(user.id, reseller.id))
for (const id of [admin.id, reseller.id]) {
  const [row] = await db
    .select()
    .from(account)
    .where((await import('drizzle-orm')).eq(account.userId, id))
  if (row) {
    const storedPassword = await hashPassword(password)
    await db
      .update(account)
      .set({ password: storedPassword })
      .where((await import('drizzle-orm')).eq(account.id, row.id))
  }
}
await db.insert(vpnUsers).values({
  id: 'e2e-vpn-user',
  resellerId: reseller.id,
  marzbanUsername: 'e2e_qa_customer',
  backend: 'marzban',
  status: 'active',
  dataLimitBytes: 10 * 1024 ** 3,
  usedTrafficBytes: 2 * 1024 ** 3,
  expireAt: new Date('2030-01-01T00:00:00.000Z'),
  subscriptionUrl: `http://127.0.0.1:${marzbanPort}/sub/qa_customer`,
})
await db.insert(billingEvents).values({
  id: 'e2e-existing-bill',
  resellerId: reseller.id,
  vpnUserId: 'e2e-vpn-user',
  marzbanUsername: 'e2e_qa_customer',
  type: 'create',
  dataLimitGb: 10,
  durationMonths: null,
  durationDays: 30,
  pricePerGbToman: 1200,
  amountToman: 12000,
  actorUserId: reseller.id,
})

type RemoteUser = {
  username: string
  status: string
  used_traffic: number
  data_limit: number | null
  expire: number | null
  note: string | null
  proxies: Record<string, unknown>
  inbounds: Record<string, string[]>
}
const remoteUsers = new Map<string, RemoteUser>([
  [
    'e2e_qa_customer',
    {
      username: 'e2e_qa_customer',
      status: 'active',
      used_traffic: 2 * 1024 ** 3,
      data_limit: 10 * 1024 ** 3,
      expire: Math.floor(new Date('2030-01-01T00:00:00.000Z').getTime() / 1000),
      note: null,
      proxies: { vless: { id: 'test-vless' } },
      inbounds: { vless: ['VLESS TCP'] },
    },
  ],
])
const json = (
  res: import('node:http').ServerResponse,
  value: unknown,
  status = 200,
) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(value))
}
const marzban = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${marzbanPort}`)
  const method = req.method ?? 'GET'
  const chunks: Array<Buffer> = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  const rawBody = Buffer.concat(chunks).toString()
  const body = rawBody.startsWith('{') ? JSON.parse(rawBody) : {}
  if (url.pathname === '/__e2e/state') {
    if (req.headers['x-e2e-secret'] !== 'local-e2e-only') {
      return json(res, { detail: 'Not found' }, 404)
    }
    return json(res, [...remoteUsers.values()])
  }
  const toView = (u: RemoteUser) => ({
    ...u,
    links: ['vless://e2e'],
    subscription_url: `http://127.0.0.1:${marzbanPort}/sub/${encodeURIComponent(u.username)}`,
  })
  if (url.pathname === '/api/admin/token')
    return json(res, { access_token: 'local-e2e-token', token_type: 'bearer' })
  if (url.pathname === '/api/inbounds')
    return json(res, {
      vless: [{ tag: 'VLESS TCP', protocol: 'vless', network: 'tcp' }],
      trojan: [],
    })
  if (url.pathname === '/api/system')
    return json(res, {
      version: 'e2e',
      total_user: remoteUsers.size,
      users_active: remoteUsers.size,
      incoming_bandwidth: 0,
      outgoing_bandwidth: 0,
    })
  if (url.pathname === '/api/users' && method === 'GET')
    return json(res, {
      users: [...remoteUsers.values()].map(toView),
      total: remoteUsers.size,
    })
  if (url.pathname === '/api/user' && method === 'POST') {
    const u: RemoteUser = {
      username: body.username,
      status: body.status ?? 'active',
      used_traffic: 0,
      data_limit: body.data_limit ?? null,
      expire: body.expire ?? null,
      note: body.note ?? null,
      proxies: body.proxies ?? {},
      inbounds: body.inbounds ?? {},
    }
    remoteUsers.set(u.username, u)
    return json(res, toView(u))
  }
  const match = /^\/api\/user\/([^/]+)(\/reset|\/revoke_sub)?$/.exec(
    url.pathname,
  )
  if (!match) return json(res, { detail: 'Not found' }, 404)
  const username = decodeURIComponent(match[1]!)
  const u = remoteUsers.get(username)
  if (!u) return json(res, { detail: 'User not found' }, 404)
  if (match[2] === '/reset' && method === 'POST') {
    u.used_traffic = 0
    return json(res, toView(u))
  }
  if (method === 'GET') return json(res, toView(u))
  if (method === 'PUT') {
    if ('status' in body) u.status = body.status
    if ('data_limit' in body) u.data_limit = body.data_limit
    if ('expire' in body) u.expire = body.expire
    if ('note' in body) u.note = body.note
    if ('proxies' in body) u.proxies = body.proxies
    if ('inbounds' in body) u.inbounds = body.inbounds
    return json(res, toView(u))
  }
  return json(res, {}, 404)
})
marzban.listen(marzbanPort, '127.0.0.1')

const vite = spawn(
  'bun',
  ['--bun', 'vite', 'dev', '--host', '127.0.0.1', '--port', String(appPort)],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_PATH: dbPath,
      BETTER_AUTH_URL: base.origin,
      BETTER_AUTH_SECRET: authSecret,
      BOOTSTRAP_ADMIN_EMAIL: admin.email,
      MARZBAN_BASE_URL: `http://127.0.0.1:${marzbanPort}`,
      MARZBAN_USERNAME: 'e2e',
      MARZBAN_PASSWORD: 'local-only',
      SCHEDULER: 'off',
    },
  },
)

function cleanup() {
  vite.kill('SIGTERM')
  marzban.close()
  rmSync(tempDir, { recursive: true, force: true })
  rmSync(portFile, { force: true })
}
process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)
process.on('exit', cleanup)
vite.on('exit', (code) => {
  cleanup()
  process.exit(code ?? 0)
})
