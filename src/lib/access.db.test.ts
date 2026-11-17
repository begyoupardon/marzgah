import { beforeEach, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { setupRouterTest, callAs } from '../../test/helpers/orpc'
import {
  makeReseller,
  makeUser,
  makeVpnUser,
} from '../../test/helpers/factories'
import { FakeBackend } from '../../test/fakes/backend'
import { setBackend } from './backends/registry'
import { BackendError } from './backends/types'
import {
  accessAssignments,
  accessTasks,
  user as users,
  vpnUsers,
} from '#/db/schema'
import type { AccessPolicy } from './access-policy'
const db = await setupRouterTest()
const access = await import('./access')
const api = await import('#/orpc/router/access')
const a = { protocol: 'vless', tag: 'VLESS TCP' }
const b = { protocol: 'trojan', tag: 'TROJAN' }
let backend: FakeBackend
let admin: Awaited<ReturnType<typeof makeUser>>
let seller: Awaited<ReturnType<typeof makeReseller>>
let username: string
beforeEach(async () => {
  await db.delete(accessTasks)
  const { accessLeases, accessOperations, accessPolicies } =
    await import('#/db/schema')
  await db.delete(accessLeases)
  await db.delete(accessAssignments)
  await db.delete(accessOperations)
  await db.delete(accessPolicies)
  await db.delete(vpnUsers)
  backend = new FakeBackend()
  setBackend('marzban', backend)
  admin = await makeUser(db, 'admin')
  seller = await makeReseller(db)
  const row = await makeVpnUser(db, seller.id)
  username = row.marzbanUsername
  backend.seed({
    username,
    inbounds: [a],
    status: 'disabled',
    dataLimitBytes: 100,
    usedBytes: 20,
    expireAt: new Date('2030-01-01'),
  })
})
async function policy() {
  return access.ensureAccessPolicy()
}
async function save(p: AccessPolicy) {
  const state = await policy()
  return access.saveAccessPolicy(
    {
      backend: 'marzban',
      policy: p,
      revision: state.revision,
      idempotencyKey: crypto.randomUUID(),
    },
    admin,
  )
}
async function assign(
  selection: import('./access-policy').AccessSelection,
  actor = seller,
) {
  const view = await access.userAccessView(username, actor)
  return access.setUserAccess(
    {
      username,
      selection,
      revision: view.revision,
      policyRevision: view.policyRevision,
      idempotencyKey: crypto.randomUUID(),
    },
    actor,
  )
}
test('global activation captures legacy selections, preserves account state, and removal retains independent access', async () => {
  const state = await policy()
  const { operationId } = await save({ ...state.policy, required: [b] })
  await access.drainAccessTasks()
  expect((await backend.getUser(username)).inbounds).toEqual([b, a])
  expect(await backend.getUser(username)).toMatchObject({
    status: 'disabled',
    dataLimitBytes: 100,
    usedBytes: 20,
    expireAt: new Date('2030-01-01'),
  })
  expect((await access.getAccessOperation(operationId, admin)).applied).toBe(1)
  await save({ ...state.policy, required: [] })
  await access.drainAccessTasks()
  expect((await backend.getUser(username)).inbounds).toEqual([a])
})
test('linked templates propagate while custom selections remain independent', async () => {
  const state = await policy()
  await save({
    ...state.policy,
    templates: [{ id: 't', name: 'Template', inbounds: [a] }],
  })
  await assign({ mode: 'template', templateId: 't' })
  await access.drainAccessTasks()
  await save({
    ...state.policy,
    templates: [{ id: 't', name: 'Template', inbounds: [b] }],
  })
  await access.drainAccessTasks()
  expect((await backend.getUser(username)).inbounds).toEqual([b])
  await assign({ mode: 'custom', inbounds: [a] })
  await access.drainAccessTasks()
  await save({
    ...state.policy,
    templates: [{ id: 't', name: 'Template', inbounds: [a, b] }],
  })
  await access.drainAccessTasks()
  expect((await backend.getUser(username)).inbounds).toEqual([a])
})
test('empty assignments and deletion of a referenced template are rejected', async () => {
  const state = await policy()
  await expect(assign({ mode: 'custom', inbounds: [] })).rejects.toThrow(
    'at least one',
  )
  await save({
    ...state.policy,
    templates: [{ id: 't', name: 'Template', inbounds: [a] }],
  })
  await assign({ mode: 'template', templateId: 't' })
  await expect(save(state.policy)).rejects.toThrow('template')
})
test('reseller allowlists and cross-reseller ownership are enforced by real middleware', async () => {
  const state = await policy()
  await save({
    ...state.policy,
    resellers: [
      { resellerId: seller.id, allowed: [a], defaultTemplateId: null },
    ],
  })
  await expect(assign({ mode: 'custom', inbounds: [b] })).rejects.toThrow(
    'unapproved',
  )
  const other = await makeReseller(db)
  await expect(callAs(api.user, { username }, other.id)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  })
  await expect(callAs(api.policy, {}, seller.id)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  })
  await expect(callAs(api.catalog, {}, null)).rejects.toMatchObject({
    code: 'UNAUTHORIZED',
  })
  await db.update(users).set({ role: 'reseller' }).where(eq(users.id, admin.id))
  await expect(
    callAs(
      api.savePolicy,
      {
        backend: 'marzban',
        policy: state.policy,
        revision: 1,
        idempotencyKey: crypto.randomUUID(),
      },
      admin.id,
    ),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' })
})
test('idempotent requests return the same operation and stale edits are rejected', async () => {
  const state = await policy()
  const input = {
    username,
    selection: { mode: 'custom' as const, inbounds: [b] },
    revision: 0,
    policyRevision: state.revision,
    idempotencyKey: crypto.randomUUID(),
  }
  const first = await access.setUserAccess(input, seller)
  expect(await access.setUserAccess(input, seller)).toEqual(first)
  await expect(
    access.setUserAccess(
      { ...input, idempotencyKey: crypto.randomUUID() },
      seller,
    ),
  ).rejects.toMatchObject({ code: 'CONFLICT' })
  await expect(
    access.setUserAccess(
      { ...input, selection: { mode: 'custom', inbounds: [a] } },
      seller,
    ),
  ).rejects.toMatchObject({ code: 'CONFLICT' })
})
test('timeout after successful remote mutation resumes without repeating the write', async () => {
  await assign({ mode: 'custom', inbounds: [b] })
  const original = backend.setAccess.bind(backend)
  backend.setAccess = async (name, inbounds) => {
    await original(name, inbounds)
    throw new BackendError('timeout', 'UNAVAILABLE')
  }
  await access.drainAccessTasks()
  backend.setAccess = original
  await access.drainAccessTasks(20, Date.now() + 10_000)
  expect(backend.callsTo('setAccess').length).toBe(1)
  const assignment = await access.getAssignment(
    (await access.assertAccessOwner(username, seller)).id,
  )
  expect(assignment?.error).toBeNull()
})
test('queued operations apply the newest policy and skip archived users', async () => {
  const state = await policy()
  await save({ ...state.policy, required: [b] })
  await save({ ...state.policy, required: [a] })
  await access.drainAccessTasks()
  expect((await backend.getUser(username)).inbounds).toEqual([a])
  const result = await assign({ mode: 'custom', inbounds: [b] })
  await db
    .update(vpnUsers)
    .set({ removedAt: new Date() })
    .where(eq(vpnUsers.marzbanUsername, username))
  await access.drainAccessTasks()
  expect(
    (await access.getAccessOperation(result.operationId, seller)).tasks[0]
      ?.status,
  ).toBe('skipped')
})
test('drift reconciliation is idempotent and required inbounds apply to new users', async () => {
  const state = await policy()
  await save({ ...state.policy, required: [b] })
  await access.drainAccessTasks()
  const prepared = await access.prepareCreateAccess(seller.id, seller)
  expect(prepared?.effective).toEqual([b, a])
  await backend.setAccess(username, [a])
  const row = await access.assertAccessOwner(username, seller)
  await access.enqueueAccessReconciliation(row.id)
  await access.enqueueAccessReconciliation(row.id)
  await access.drainAccessTasks()
  expect((await backend.getUser(username)).inbounds).toEqual([b, a])
})
test('concurrent workers claim each account once and recover expired leases', async () => {
  const result = await assign({ mode: 'custom', inbounds: [b] })
  await Promise.all([access.drainAccessTasks(), access.drainAccessTasks()])
  expect(backend.callsTo('setAccess').length).toBe(1)
  expect(
    (await access.getAccessOperation(result.operationId, seller)).applied,
  ).toBe(1)
  const next = await assign({ mode: 'custom', inbounds: [a] })
  const row = await access.assertAccessOwner(username, seller)
  const { accessLeases } = await import('#/db/schema')
  await db.insert(accessLeases).values({
    vpnUserId: row.id,
    token: 'crashed',
    lockedUntil: Date.now() - 1000,
  })
  await access.drainAccessTasks()
  expect(
    (await access.getAccessOperation(next.operationId, seller)).applied,
  ).toBe(1)
})
test('allowlist reductions retain template links and prevent empty effective access', async () => {
  const state = await policy()
  await save({
    ...state.policy,
    templates: [{ id: 't', name: 'Both', inbounds: [a, b] }],
  })
  await assign({ mode: 'template', templateId: 't' })
  await access.drainAccessTasks()
  const before = await policy()
  await save({
    ...before.policy,
    resellers: [
      { resellerId: seller.id, allowed: [a], defaultTemplateId: null },
    ],
  })
  await access.drainAccessTasks()
  expect((await backend.getUser(username)).inbounds).toEqual([a])
  expect((await access.userAccessView(username, seller)).selection).toEqual({
    mode: 'template',
    templateId: 't',
  })
  const latest = await policy()
  await expect(
    save({
      ...latest.policy,
      resellers: [
        { resellerId: seller.id, allowed: [], defaultTemplateId: null },
      ],
    }),
  ).rejects.toThrow('all access')
})
test('new catalog entries require approval and admin-controlled selections cannot be removed by resellers', async () => {
  await policy()
  backend.catalog.inbounds.push({ protocol: 'vless', tag: 'NEW', hosts: [] })
  await expect(
    assign({ mode: 'custom', inbounds: [{ protocol: 'vless', tag: 'NEW' }] }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  await assign(
    { mode: 'custom', inbounds: [{ protocol: 'vless', tag: 'NEW' }] },
    admin,
  )
  await access.drainAccessTasks()
  await expect(assign({ mode: 'custom', inbounds: [a] })).rejects.toMatchObject(
    { code: 'FORBIDDEN' },
  )
})
test('permanent failures are visible, retryable, and do not change other users', async () => {
  const result = await assign({ mode: 'custom', inbounds: [b] })
  backend.failNext.set(
    'setAccess',
    new BackendError('Unavailable tag', 'INVALID'),
  )
  await access.drainAccessTasks()
  expect(
    (await access.getAccessOperation(result.operationId, seller)).failed,
  ).toBe(1)
  expect((await backend.getUser(username)).inbounds).toEqual([a])
  await access.retryAccessOperation(result.operationId, seller)
  await access.drainAccessTasks()
  expect(
    (await access.getAccessOperation(result.operationId, seller)).applied,
  ).toBe(1)
})
test('Marzban webhooks enqueue drift repair without mutating during delivery or replay', async () => {
  await assign({ mode: 'custom', inbounds: [b] })
  await access.drainAccessTasks()
  await backend.setAccess(username, [a])
  const before = backend.callsTo('setAccess').length
  process.env.MARZBAN_WEBHOOK_SECRET = 'access-test-secret'
  const { handleWebhook } = await import('./marzban/webhook-handler')
  const send = () =>
    handleWebhook({
      request: new Request('https://panel.test/api/webhooks/marzban', {
        method: 'POST',
        headers: { 'x-webhook-secret': 'access-test-secret' },
        body: JSON.stringify({
          username,
          action: 'user_updated',
          enqueued_at: 654321,
        }),
      }),
    })
  expect((await send()).status).toBe(200)
  expect(await (await send()).json()).toEqual({ status: 'duplicate' })
  expect(backend.callsTo('setAccess').length).toBe(before)
  await access.drainAccessTasks()
  expect((await backend.getUser(username)).inbounds).toEqual([b])
})
test('policy previews become stale when another user selection is saved', async () => {
  const state = await policy()
  const preview = await access.previewAccessPolicy({
    ...state.policy,
    required: [b],
  })
  await assign({ mode: 'custom', inbounds: [a] })
  await expect(
    access.saveAccessPolicy(
      {
        backend: 'marzban',
        policy: preview.policy,
        revision: preview.revision,
        idempotencyKey: crypto.randomUUID(),
      },
      admin,
    ),
  ).rejects.toMatchObject({ code: 'CONFLICT' })
  expect((await policy()).policy.required).toEqual([])
})
test('global previews are bounded while operations include every user and page their results', async () => {
  const state = await policy()
  for (let i = 0; i < 205; i++) {
    await makeVpnUser(db, seller.id, { marzbanUsername: `bulk_${i}` })
  }
  const next = { ...state.policy, required: [b] }
  const preview = await access.previewAccessPolicy(next)
  expect(preview.affected).toBe(206)
  expect(preview.changes).toHaveLength(200)
  expect(preview.truncated).toBe(true)
  const operation = await save(next)
  const first = await access.getAccessOperation(operation.operationId, admin)
  expect(first.total).toBe(206)
  expect(first.pending).toBe(206)
  expect(first.tasks).toHaveLength(50)
  expect(first.hasMore).toBe(true)
  const last = await access.getAccessOperation(
    operation.operationId,
    admin,
    200,
  )
  expect(last.tasks).toHaveLength(6)
  expect(last.hasMore).toBe(false)
})
test('reseller edits preserve only the protected admin grants when allowlists later narrow', async () => {
  await policy()
  const grant = { protocol: 'vless', tag: 'ADMIN ONLY' }
  backend.catalog.inbounds.push({ ...grant, hosts: [] })
  await assign({ mode: 'custom', inbounds: [grant] }, admin)
  await access.drainAccessTasks()
  await assign({ mode: 'custom', inbounds: [grant, a] })
  await access.drainAccessTasks()
  expect((await backend.getUser(username)).inbounds).toEqual([grant, a])
  const state = await policy()
  await save({
    ...state.policy,
    resellers: [
      { resellerId: seller.id, allowed: [], defaultTemplateId: null },
    ],
  })
  await access.drainAccessTasks()
  expect((await backend.getUser(username)).inbounds).toEqual([grant])
  expect((await access.userAccessView(username, seller)).locked).toEqual([
    grant,
  ])
})
test('a removed allowlist grant is not presented as a protected template grant', async () => {
  const state = await policy()
  await save({
    ...state.policy,
    templates: [{ id: 't', name: 'Both', inbounds: [a, b] }],
  })
  await assign({ mode: 'template', templateId: 't' })
  await access.drainAccessTasks()
  const next = await policy()
  await save({
    ...next.policy,
    resellers: [
      { resellerId: seller.id, allowed: [a], defaultTemplateId: null },
    ],
  })
  await access.drainAccessTasks()
  expect((await access.userAccessView(username, seller)).locked).toEqual([])
  await assign({ mode: 'custom', inbounds: [a] })
  await access.drainAccessTasks()
  expect((await backend.getUser(username)).inbounds).toEqual([a])
})
test('reseller template assignment binds existing and future users to individual hosts', async () => {
  const host = {
    id: 'a'.repeat(64),
    address: 'one.example.test',
    remark: 'One',
    port: 443,
  }
  backend.catalog.inbounds[0]!.hosts = [
    host,
    { ...host, id: 'b'.repeat(64), address: 'two.example.test', remark: 'Two' },
  ]
  const state = await policy()
  const selection = [{ ...a, hostIds: [host.id] }]
  const binding = crypto.randomUUID()
  await save({
    ...state.policy,
    templates: [
      { id: 'host-template', name: 'Host template', inbounds: selection },
    ],
    resellers: [
      {
        resellerId: seller.id,
        allowed: selection,
        defaultTemplateId: 'host-template',
        assignmentId: binding,
      },
    ],
  })
  await access.drainAccessTasks()
  const view = await access.userAccessView(username, admin)
  expect(view.selection).toEqual({
    mode: 'template',
    templateId: 'host-template',
  })
  expect(view.effective).toEqual(selection)
  expect((await backend.getUser(username)).inbounds).toEqual([a])
  expect(view.pending).toBe(false)
  expect(
    (await access.prepareCreateAccess(seller.id, seller)).effective,
  ).toEqual(selection)
  expect(
    (
      await access.getAssignment(
        (await access.assertAccessOwner(username, admin)).id,
      )
    )?.resellerBinding,
  ).toBe(binding)
})
test('all access endpoints are admin-only and resellers cannot submit access while creating users', async () => {
  for (const [procedure, input] of [
    [api.catalog, {}],
    [api.user, { username }],
    [api.operations, undefined],
    [api.operation, { id: 'unknown' }],
    [api.retry, { id: 'unknown' }],
  ] as const)
    await expect(callAs(procedure, input, seller.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  const vpn = await import('#/orpc/router/vpn-users')
  await expect(
    callAs(
      vpn.createVpnUser,
      {
        username: 'new',
        durationDays: 30,
        dataLimitBytes: 1024 ** 3,
        access: { mode: 'custom', inbounds: [a] },
      },
      seller.id,
    ),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' })
})
test('managed subscription links filter a sibling host and invalidate after revocation without exposing upstream URLs', async () => {
  process.env.BETTER_AUTH_URL = 'https://panel.test'
  process.env.BETTER_AUTH_SECRET = 'test-only-subscription-secret-'.repeat(2)
  const host = {
    id: 'a'.repeat(64),
    address: 'one.example.test',
    remark: 'One',
    port: 443,
  }
  backend.catalog.inbounds[0]!.hosts = [
    host,
    { ...host, id: 'b'.repeat(64), address: 'two.example.test', remark: 'Two' },
  ]
  const row = await access.assertAccessOwner(username, admin)
  const remote = await backend.updateUser(username, { status: 'active' })
  await db
    .update(vpnUsers)
    .set({ subscriptionUrl: remote.subscriptionUrl })
    .where(eq(vpnUsers.id, row.id))
  await assign(
    { mode: 'custom', inbounds: [{ ...a, hostIds: [host.id] }] },
    admin,
  )
  backend.subscriptionBodies.v2ray = Buffer.from(
    'vless://id@one.example.test:443#One\nvless://id@two.example.test:443#Two',
  ).toString('base64')
  const { publicSubscriptionUrl, serveManagedSubscription } =
    await import('./managed-subscription')
  const account = await access.assertAccessOwner(username, admin)
  const url = (await publicSubscriptionUrl(account))!
  expect(url).toStartWith('https://panel.test/subscription/')
  expect(url).not.toContain('fake-')
  const token = new URL(url).pathname.split('/').pop()!
  const response = await serveManagedSubscription(
    new Request(url),
    row.id,
    token,
  )
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toContain('no-store')
  expect(Buffer.from(await response.text(), 'base64').toString()).toBe(
    'vless://id@one.example.test:443#One',
  )
  expect(
    (await serveManagedSubscription(new Request(url), row.id, 'x'.repeat(43)))
      .status,
  ).toBe(404)
  await backend.revokeSubscription(username)
  expect(
    (await serveManagedSubscription(new Request(url), row.id, token)).status,
  ).toBe(404)
})
test('explicit system host defaults can create non-VLESS users and linked reseller templates can grow', async () => {
  const first = {
    id: 'c'.repeat(64),
    address: 'trojan.test',
    remark: 'Trojan',
    port: 443,
  }
  const second = {
    id: 'd'.repeat(64),
    address: 'vless.test',
    remark: 'VLESS',
    port: 443,
  }
  backend.catalog.inbounds[1]!.hosts = [first]
  backend.catalog.inbounds[0]!.hosts = [second]
  const state = await policy()
  const onlyTrojan = [{ ...b, hostIds: [first.id] }]
  await save({ ...state.policy, hostDefaults: true, approved: onlyTrojan })
  expect(
    (await access.prepareCreateAccess(seller.id, seller)).effective,
  ).toEqual(onlyTrojan)
  const current = await policy()
  const binding = crypto.randomUUID()
  await save({
    ...current.policy,
    templates: [{ id: 'grow', name: 'Growing', inbounds: onlyTrojan }],
    resellers: [
      {
        resellerId: seller.id,
        allowed: onlyTrojan,
        defaultTemplateId: 'grow',
        assignmentId: binding,
      },
    ],
  })
  await access.drainAccessTasks()
  const next = await policy()
  const both = [...onlyTrojan, { ...a, hostIds: [second.id] }]
  await save({
    ...next.policy,
    templates: [{ id: 'grow', name: 'Growing', inbounds: both }],
  })
  await access.drainAccessTasks()
  expect((await access.userAccessView(username, admin)).effective).toEqual(both)
  expect(
    (await access.prepareCreateAccess(seller.id, seller)).effective,
  ).toEqual(both)
})
