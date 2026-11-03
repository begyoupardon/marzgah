import { expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'

import { callAs, setupRouterTest } from '../../../test/helpers/orpc'
import { makeReseller, makeUser } from '../../../test/helpers/factories'
import { apiKeys, user } from '#/db/schema'
import { MIN_DATA_LIMIT_BYTES } from '#/lib/vpn-plans'

const db = await setupRouterTest()
const keys = await import('./api-keys')
const dashboard = await import('./dashboard')
const adminRouter = await import('./admin')
const { Route: openApiRoute } = await import('#/routes/api.$')
const alice = await makeReseller(db)
const bob = await makeReseller(db)
const admin = await makeUser(db, 'admin')

it('creates a one-time secret and keeps key lists private', async () => {
  const created = (await callAs(
    keys.create,
    { name: 'agent', expiresInDays: 90 },
    alice.id,
  )) as { token: string; key: { id: string } }
  expect(created.token).toMatch(/^mzg_[A-Za-z0-9_-]{43}$/)
  const rows = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.id, created.key.id))
  expect(rows[0].tokenHash).not.toBe(created.token)
  expect(
    JSON.stringify(await callAs(keys.list, undefined, alice.id)),
  ).not.toContain(created.token)
  expect(await callAs(keys.list, undefined, bob.id)).toEqual([])
  await expect(
    callAs(keys.revoke, { id: created.key.id }, bob.id),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' })
})

it('authenticates bearer keys with the owner current role and rejects cookie fallback', async () => {
  const created = (await callAs(
    keys.create,
    { name: 'role test' },
    alice.id,
  )) as { token: string; key: { id: string } }
  const bearer = { authorization: `Bearer ${created.token}` }
  const me = (await callAs(dashboard.getMe, undefined, null, bearer)) as {
    user: { id: string; role: string }
  }
  expect(me.user).toMatchObject({ id: alice.id, role: 'reseller' })
  await expect(
    callAs(adminRouter.listResellers, undefined, null, bearer),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  await expect(
    callAs(keys.create, { name: 'cannot mint' }, null, bearer),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  await expect(
    callAs(dashboard.getMe, undefined, alice.id, {
      authorization: 'Bearer invalid',
    }),
  ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  await db.update(user).set({ role: 'admin' }).where(eq(user.id, alice.id))
  const promoted = (await callAs(dashboard.getMe, undefined, null, bearer)) as {
    user: { role: string }
  }
  expect(promoted.user.role).toBe('admin')
  await callAs(keys.revoke, { id: created.key.id }, alice.id)
  await expect(
    callAs(dashboard.getMe, undefined, null, bearer),
  ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
})

it('expires keys and removes access when an owner is deleted', async () => {
  const expired = (await callAs(
    keys.create,
    { name: 'expired', expiresInDays: 30 },
    admin.id,
  )) as { token: string; key: { id: string } }
  await db
    .update(apiKeys)
    .set({ expiresAt: new Date(Date.now() - 1) })
    .where(eq(apiKeys.id, expired.key.id))
  await expect(
    callAs(dashboard.getMe, undefined, null, {
      authorization: `Bearer ${expired.token}`,
    }),
  ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  const valid = (await callAs(
    keys.create,
    { name: 'owner deletion' },
    bob.id,
  )) as { token: string }
  await db.delete(user).where(eq(user.id, bob.id))
  await expect(
    callAs(dashboard.getMe, undefined, null, {
      authorization: `Bearer ${valid.token}`,
    }),
  ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
})

it('serves the public spec and authenticates a real OpenAPI HTTP call', async () => {
  const handlers = openApiRoute.options.server!.handlers as unknown as {
    GET: (arg: { request: Request }) => Promise<Response>
    POST: (arg: { request: Request }) => Promise<Response>
  }
  const get = handlers.GET
  const post = handlers.POST
  const specResponse = await get({
    request: new Request('https://panel.test/api/spec.json'),
  } as never)
  expect(specResponse.status).toBe(200)
  const spec = (await specResponse.json()) as {
    paths: Record<string, { post: { security?: unknown } }>
    components: { securitySchemes: Record<string, unknown> }
  }
  expect(spec.components.securitySchemes.bearerAuth).toBeDefined()
  expect(spec.paths['/me']).toBeDefined()
  expect(Object.keys(spec.paths).length).toBeGreaterThan(40)
  for (const path of Object.values(spec.paths)) {
    expect(path.post).toBeDefined()
    expect(
      (
        path.post as {
          responses: {
            200: { content: { 'application/json': { schema: object } } }
          }
        }
      ).responses[200].content['application/json'].schema,
    ).toBeDefined()
  }
  expect(spec.paths['/apiKeys/create']).toBeUndefined()
  expect(spec.paths['/public/view'].post.security).toEqual([])
  const createInput = spec.paths['/vpnUsers/create'].post as {
    requestBody: {
      content: {
        'application/json': {
          schema: { properties: { dataLimitBytes: { minimum: number } } }
        }
      }
    }
  }
  expect(
    createInput.requestBody.content['application/json'].schema.properties
      .dataLimitBytes.minimum,
  ).toBe(MIN_DATA_LIMIT_BYTES)

  const created = (await callAs(
    keys.create,
    { name: 'http test' },
    admin.id,
  )) as { token: string }
  const response = await post({
    request: new Request('https://panel.test/api/me', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${created.token}`,
        'content-type': 'application/json',
      },
      body: '{}',
    }),
  } as never)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    user: { id: admin.id, role: 'admin' },
  })
  const invalid = await post({
    request: new Request('https://panel.test/api/me', {
      method: 'POST',
      headers: {
        authorization: 'Bearer invalid',
        'content-type': 'application/json',
      },
      body: '{}',
    }),
  })
  expect(invalid.status).toBe(401)
})
