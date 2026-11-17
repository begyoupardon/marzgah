import { getAssignment } from './access-store'
export { getAssignment } from './access-store'
import { ORPCError } from '@orpc/server'
import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm'
import { db } from '#/db'
import {
  auditLogs,
  accessAssignments,
  accessLeases,
  accessOperations,
  accessPolicies,
  accessTasks,
  resellerProfiles,
  vpnUsers,
} from '#/db/schema'
import { getBackend, DEFAULT_BACKEND_ID } from '#/lib/backends/registry'
import { BackendError } from '#/lib/backends/types'
import type { InboundRef } from '#/lib/backends/types'
import { withKeyedLock } from '#/lib/keyed-lock'
import { hasPendingVpnOperation } from '#/lib/vpn-operations'
import {
  accessPolicySchema,
  accessSelectionSchema,
  allowedInbounds,
  assertCatalogSelection as assertCatalogSelectionUnsafe,
  baseInbounds as baseInboundsUnsafe,
  defaultSelection,
  effectiveInbounds as effectiveInboundsUnsafe,
  inboundKey,
  normalizeInbounds,
  sameInbounds,
  sameBackendInbounds,
  backendInbounds,
  effectiveUserSelection,
  resellerSelection,
} from './access-policy'
import type { AccessPolicy, AccessSelection } from './access-policy'
export type AccessActor = { id: string; role: string }
const fail = (message: string): never => {
  throw new ORPCError('BAD_REQUEST', { message })
}
const conflict = (): never => {
  throw new ORPCError('CONFLICT', {
    message: 'Access changed. Refresh and review again.',
  })
}
function effectiveInbounds(
  ...args: Parameters<typeof effectiveInboundsUnsafe>
) {
  try {
    return effectiveInboundsUnsafe(...args)
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Invalid access selection')
  }
}
function baseInbounds(...args: Parameters<typeof baseInboundsUnsafe>) {
  try {
    return baseInboundsUnsafe(...args)
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Invalid access selection')
  }
}
function assertCatalogSelection(
  ...args: Parameters<typeof assertCatalogSelectionUnsafe>
) {
  try {
    return assertCatalogSelectionUnsafe(...args)
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Invalid access selection')
  }
}
const MAX_ATTEMPTS = 5
const LEASE_MS = 120_000

export async function getAccessCatalog(backend = DEFAULT_BACKEND_ID) {
  const provider = getBackend(backend)
  if (!provider.accessCatalog || !provider.setAccess)
    throw new ORPCError('BAD_REQUEST', {
      message: 'This backend does not support inbound management',
    })
  return provider.accessCatalog()
}
export async function readAccessPolicy(backend = DEFAULT_BACKEND_ID) {
  const [row] = await db
    .select()
    .from(accessPolicies)
    .where(eq(accessPolicies.backend, backend))
  return row
    ? {
        revision: row.revision,
        policy: accessPolicySchema.parse(JSON.parse(row.document)),
      }
    : null
}
/** First explicit catalog use captures the initial grant. Later discoveries are not automatically granted. */
export async function ensureAccessPolicy(backend = DEFAULT_BACKEND_ID) {
  let state = await readAccessPolicy(backend)
  if (!state) {
    const catalog = await getAccessCatalog(backend)
    const policy: AccessPolicy = {
      required: [],
      approved: normalizeInbounds(catalog.inbounds),
      templates: [],
      resellers: [],
    }
    await db
      .insert(accessPolicies)
      .values({ backend, document: JSON.stringify(policy) })
      .onConflictDoNothing()
    state = await readAccessPolicy(backend)
  }
  return state!
}
export async function assertAccessOwner(
  username: string,
  actor: AccessActor,
  writable = false,
) {
  const [row] = await db
    .select()
    .from(vpnUsers)
    .where(
      and(
        eq(vpnUsers.marzbanUsername, username),
        isNull(vpnUsers.removedAt),
        actor.role === 'admin' ? undefined : eq(vpnUsers.resellerId, actor.id),
      ),
    )
  if (!row) throw new ORPCError('NOT_FOUND', { message: 'VPN user not found' })
  if (writable) {
    const [profile] = await db
      .select()
      .from(resellerProfiles)
      .where(eq(resellerProfiles.userId, row.resellerId))
    if (profile?.status !== 'active')
      throw new ORPCError('FORBIDDEN', {
        message: 'Reseller account is disabled',
      })
  }
  return row
}
function protectedInbounds(
  assignment: Awaited<ReturnType<typeof getAssignment>>,
): InboundRef[] {
  return assignment
    ? (JSON.parse(assignment.protectedInbounds) as InboundRef[])
    : []
}
export async function userAccessView(username: string, actor: AccessActor) {
  const user = await assertAccessOwner(username, actor)
  const state = await ensureAccessPolicy(user.backend)
  const assignment = await getAssignment(user.id)
  const remote = await getBackend(user.backend).getUser(username, {
    repair: false,
  })
  const selection = effectiveUserSelection(
    state.policy,
    user.resellerId,
    assignment,
    remote.inbounds ?? [],
  )
  const editable = restrictSelection(
    state.policy,
    selection,
    user.resellerId,
    assignment?.adminControlled ?? true,
    protectedInbounds(assignment),
  )
  const base = baseInbounds(state.policy, editable)
  const effective = effectiveInbounds(state.policy, editable)
  const allowed = allowedInbounds(state.policy, user.resellerId)
  const allowedKeys = new Set(
    [...allowed, ...state.policy.required].map(inboundKey),
  )
  const locked =
    actor.role === 'admin'
      ? []
      : base.filter((i) => !allowedKeys.has(inboundKey(i)))
  return {
    username,
    backend: user.backend,
    base,
    templateName:
      selection.mode === 'template'
        ? (state.policy.templates.find((t) => t.id === selection.templateId)
            ?.name ?? selection.templateId)
        : null,
    revision: assignment?.revision ?? 0,
    policyRevision: state.revision,
    managed: Boolean(assignment),
    selection,
    effective,
    observed: remote.inbounds ?? [],
    required: state.policy.required,
    allowed,
    locked,
    adminControlled: assignment?.adminControlled ?? false,
    error: assignment?.error ?? null,
    pending: !sameBackendInbounds(effective, remote.inbounds ?? []),
  }
}
function validateSelection(
  policy: AccessPolicy,
  selection: AccessSelection,
  catalog: InboundRef[],
  resellerId: string,
  admin: boolean,
  existing?: AccessSelection,
) {
  const effective = effectiveInbounds(policy, selection)
  if (!effective.length) fail('Select at least one inbound')
  assertCatalogSelection(effective, catalog)
  if (!admin) {
    const allowed = new Set(
      [...allowedInbounds(policy, resellerId), ...policy.required].map(
        inboundKey,
      ),
    )
    const locked = existing
      ? baseInbounds(policy, existing).filter(
          (i) => !allowed.has(inboundKey(i)),
        )
      : []
    const nextBase = baseInbounds(policy, selection)
    if (
      nextBase.some(
        (i) =>
          !allowed.has(inboundKey(i)) &&
          !locked.some((l) => inboundKey(l) === inboundKey(i)),
      ) ||
      locked.some((i) => !nextBase.some((n) => inboundKey(i) === inboundKey(n)))
    )
      throw new ORPCError('FORBIDDEN', {
        message: 'Selection contains admin-controlled or unapproved inbounds',
      })
  }
  return effective
}
async function existingOperation(id: string, actorId: string, request: string) {
  const [existing] = await db
    .select()
    .from(accessOperations)
    .where(eq(accessOperations.id, id))
  if (!existing) return null
  if (existing.actorUserId !== actorId || existing.request !== request)
    throw new ORPCError('CONFLICT', {
      message: 'Idempotency key already used for another request',
    })
  return { operationId: id }
}
function operationId(actorId: string, key: string) {
  return `${actorId}:${key}`
}

export async function setUserAccess(
  input: {
    username: string
    selection: AccessSelection
    revision: number
    policyRevision: number
    idempotencyKey: string
  },
  actor: AccessActor,
) {
  const user = await assertAccessOwner(input.username, actor, true)
  const id = operationId(actor.id, input.idempotencyKey)
  const request = JSON.stringify(input)
  const existing = await existingOperation(id, actor.id, request)
  if (existing) return existing
  const state = await ensureAccessPolicy(user.backend)
  if (state.revision !== input.policyRevision) conflict()
  const assignment = await getAssignment(user.id)
  if ((assignment?.revision ?? 0) !== input.revision) conflict()
  const catalog = await getAccessCatalog(user.backend)
  const current = assignment
    ? accessSelectionSchema.parse(JSON.parse(assignment.selection))
    : {
        mode: 'custom' as const,
        inbounds:
          (
            await getBackend(user.backend).getUser(user.marzbanUsername, {
              repair: false,
            })
          ).inbounds ?? [],
      }
  const currentEditable = restrictSelection(
    state.policy,
    current,
    user.resellerId,
    assignment?.adminControlled ?? true,
    protectedInbounds(assignment),
  )
  const allowed = new Set(
    [
      ...allowedInbounds(state.policy, user.resellerId),
      ...state.policy.required,
    ].map(inboundKey),
  )
  const protectedRefs =
    actor.role === 'admin'
      ? []
      : baseInbounds(state.policy, currentEditable).filter(
          (i) => !allowed.has(inboundKey(i)),
        )
  validateSelection(
    state.policy,
    input.selection,
    catalog.inbounds,
    user.resellerId,
    actor.role === 'admin',
    currentEditable,
  )
  const op = {
    id,
    actorUserId: actor.id,
    backend: user.backend,
    request,
    createdAt: Date.now(),
  }
  // Operation and assignment are committed together. A conflict leaves no upstream effects.
  const guard = sql`exists (select 1 from access_policies where backend = ${user.backend} and revision = ${input.policyRevision + 1} and operation_id = ${id})`
  const inserted = assignment
    ? db
        .update(accessAssignments)
        .set({
          selection: JSON.stringify(input.selection),
          revision: input.revision + 1,
          adminControlled: actor.role === 'admin',
          protectedInbounds: JSON.stringify(protectedRefs),
          resellerBinding:
            state.policy.resellers.find((r) => r.resellerId === user.resellerId)
              ?.assignmentId ?? null,
          operationId: id,
          error: null,
        })
        .where(
          and(
            eq(accessAssignments.vpnUserId, user.id),
            eq(accessAssignments.revision, input.revision),
            guard,
          ),
        )
    : db
        .insert(accessAssignments)
        .select(
          db
            .select({
              vpnUserId: sql<string>`${user.id}`.as('vpnUserId'),
              selection: sql<string>`${JSON.stringify(input.selection)}`.as(
                'selection',
              ),
              revision: sql<number>`1`.as('revision'),
              adminControlled:
                sql<boolean>`${actor.role === 'admin' ? 1 : 0}`.as(
                  'adminControlled',
                ),
              operationId: sql<string>`${id}`.as('operationId'),
              observed: sql<string | null>`null`.as('observed'),
              applied: sql<string | null>`null`.as('applied'),
              error: sql<string | null>`null`.as('error'),
              protectedInbounds:
                sql<string>`${JSON.stringify(protectedRefs)}`.as(
                  'protectedInbounds',
                ),
              resellerBinding: sql<
                string | null
              >`${state.policy.resellers.find((r) => r.resellerId === user.resellerId)?.assignmentId ?? null}`.as(
                'resellerBinding',
              ),
            })
            .from(accessPolicies)
            .where(
              and(
                eq(accessPolicies.backend, user.backend),
                eq(accessPolicies.revision, input.policyRevision + 1),
                eq(accessPolicies.operationId, id),
              ),
            ),
        )
        .onConflictDoNothing()
  await db.batch([
    db
      .update(accessPolicies)
      .set({ revision: input.policyRevision + 1, operationId: id })
      .where(
        and(
          eq(accessPolicies.backend, user.backend),
          eq(accessPolicies.revision, input.policyRevision),
        ),
      ),
    inserted,
    db
      .insert(accessOperations)
      .select(
        db
          .select({
            id: sql<string>`${id}`.as('id'),
            actorUserId: sql<string>`${actor.id}`.as('actorUserId'),
            backend: sql<string>`${user.backend}`.as('backend'),
            request: sql<string>`${request}`.as('request'),
            createdAt: sql<number>`${op.createdAt}`.as('createdAt'),
          })
          .from(accessAssignments)
          .where(
            and(
              eq(accessAssignments.vpnUserId, user.id),
              eq(accessAssignments.operationId, id),
            ),
          ),
      )
      .onConflictDoNothing(),
    db
      .insert(accessTasks)
      .select(
        db
          .select({
            id: sql<string>`${id + ':' + user.id}`.as('id'),
            operationId: sql<string>`${id}`.as('operationId'),
            vpnUserId: sql<string>`${user.id}`.as('vpnUserId'),
            status: sql<'pending'>`'pending'`.as('status'),
            attempts: sql<number>`0`.as('attempts'),
            nextAttemptAt: sql<number>`0`.as('nextAttemptAt'),
            leaseToken: sql<string | null>`null`.as('leaseToken'),
            lockedUntil: sql<number | null>`null`.as('lockedUntil'),
            error: sql<string | null>`null`.as('error'),
          })
          .from(accessOperations)
          .where(eq(accessOperations.id, id)),
      )
      .onConflictDoNothing(),
    auditAccess(actor, 'access.user', id, {
      username: input.username,
      before: current,
      after: input.selection,
    }),
  ])
  if (!(await existingOperation(id, actor.id, request))) conflict()
  return { operationId: id }
}

export async function previewAccessPolicy(
  policy: AccessPolicy,
  backend = DEFAULT_BACKEND_ID,
) {
  const current = await ensureAccessPolicy(backend)
  if (policy.hostDefaults && !policy.approved.length && !policy.required.length)
    fail('Select at least one host for the system default')
  const catalog = await getAccessCatalog(backend)
  assertCatalogSelection(
    [
      ...policy.required,
      ...policy.approved,
      ...policy.templates.flatMap((t) => t.inbounds),
      ...policy.resellers.flatMap((r) => r.allowed),
    ],
    catalog.inbounds,
  )
  if (
    new Set(policy.templates.map((t) => t.id)).size !==
      policy.templates.length ||
    new Set(policy.resellers.map((r) => r.resellerId)).size !==
      policy.resellers.length
  )
    fail('Duplicate template or reseller')
  const profiles = await db.select().from(resellerProfiles)
  for (const r of policy.resellers) {
    if (!profiles.some((p) => p.userId === r.resellerId))
      fail('Reseller not found')
    if (r.defaultTemplateId) {
      const selection: AccessSelection = {
        mode: 'template',
        templateId: r.defaultTemplateId,
      }
      validateSelection(
        policy,
        selection,
        catalog.inbounds,
        r.resellerId,
        Boolean(r.assignmentId),
      )
    }
  }
  const users = await db
    .select()
    .from(vpnUsers)
    .where(and(eq(vpnUsers.backend, backend), isNull(vpnUsers.removedAt)))
  const assignments = await db.select().from(accessAssignments)
  const byUser = new Map(assignments.map((a) => [a.vpnUserId, a]))
  let affected = 0
  const changes: Array<{
    username: string
    before: InboundRef[] | null
    after: InboundRef[]
    legacy: boolean
  }> = []
  function addChange(change: (typeof changes)[number]) {
    affected++
    if (changes.length < 200) changes.push(change)
  }
  for (const user of users) {
    const assignment = byUser.get(user.id)
    const inherited = resellerSelection(policy, user.resellerId)
    if (!assignment) {
      if (inherited) {
        const after = effectiveInbounds(policy, inherited)
        if (!after.length)
          fail(`Policy would remove all access from ${user.marzbanUsername}`)
        addChange({
          username: user.marzbanUsername,
          before: null,
          after,
          legacy: true,
        })
        continue
      }
      if (policy.required.length)
        addChange({
          username: user.marzbanUsername,
          before: null,
          after: policy.required,
          legacy: true,
        })
      continue
    }
    const selection = accessSelectionSchema.parse(
      JSON.parse(assignment.selection),
    )
    // A referenced template must remain available. Explicit overrides survive policy changes.
    const before = effectiveInbounds(current.policy, selection)
    const resolved = effectiveUserSelection(policy, user.resellerId, assignment)
    const nextSelection = restrictSelection(
      policy,
      resolved,
      user.resellerId,
      assignment.adminControlled,
      protectedInbounds(assignment),
    )
    const after = effectiveInbounds(policy, nextSelection)
    if (!after.length)
      fail(`Policy would remove all access from ${user.marzbanUsername}`)
    assertCatalogSelection(after, catalog.inbounds)
    if (
      !sameInbounds(before, after) ||
      policy.resellers.find((r) => r.resellerId === user.resellerId)
        ?.assignmentId !==
        current.policy.resellers.find((r) => r.resellerId === user.resellerId)
          ?.assignmentId
    )
      addChange({
        username: user.marzbanUsername,
        before,
        after,
        legacy: false,
      })
  }
  return {
    revision: current.revision,
    affected,
    truncated: affected > changes.length,
    totalUsers: users.length,
    changes,
    policy,
  }
}
/** Restrict reseller-controlled assignments; a template remains linked and is filtered, not copied. */
function restrictSelection(
  policy: AccessPolicy,
  selection: AccessSelection,
  resellerId: string,
  adminControlled: boolean,
  protectedRefs: InboundRef[] = [],
): AccessSelection {
  if (
    adminControlled ||
    policy.resellers.some((r) => r.resellerId === resellerId && r.assignmentId)
  )
    return selection
  const keys = new Set(
    [
      ...allowedInbounds(policy, resellerId),
      ...policy.required,
      ...protectedRefs,
    ].map(inboundKey),
  )
  return {
    mode: 'custom',
    inbounds: baseInbounds(policy, selection).filter((i) =>
      keys.has(inboundKey(i)),
    ),
  }
}
export async function saveAccessPolicy(
  input: {
    backend: string
    policy: AccessPolicy
    revision: number
    idempotencyKey: string
  },
  actor: AccessActor,
) {
  if (actor.role !== 'admin') throw new ORPCError('FORBIDDEN')
  const id = operationId(actor.id, input.idempotencyKey)
  const request = JSON.stringify(input)
  const existing = await existingOperation(id, actor.id, request)
  if (existing) return existing
  const previous = await readAccessPolicy(input.backend)
  const preview = await previewAccessPolicy(input.policy, input.backend)
  if (preview.revision !== input.revision) conflict()
  await db.batch([
    db
      .update(accessPolicies)
      .set({
        document: JSON.stringify(input.policy),
        revision: input.revision + 1,
        operationId: id,
      })
      .where(
        and(
          eq(accessPolicies.backend, input.backend),
          eq(accessPolicies.revision, input.revision),
        ),
      ),
    db
      .insert(accessOperations)
      .select(
        db
          .select({
            id: sql<string>`${id}`.as('id'),
            actorUserId: sql<string>`${actor.id}`.as('actorUserId'),
            backend: sql<string>`${input.backend}`.as('backend'),
            request: sql<string>`${request}`.as('request'),
            createdAt: sql<number>`${Date.now()}`.as('createdAt'),
          })
          .from(accessPolicies)
          .where(
            and(
              eq(accessPolicies.backend, input.backend),
              eq(accessPolicies.operationId, id),
            ),
          ),
      )
      .onConflictDoNothing(),
    db
      .insert(accessTasks)
      .select(
        db
          .select({
            id: sql<string>`${id} || ':' || ${vpnUsers.id}`.as('id'),
            operationId: sql<string>`${id}`.as('operationId'),
            vpnUserId: vpnUsers.id,
            status: sql<'pending'>`'pending'`.as('status'),
            attempts: sql<number>`0`.as('attempts'),
            nextAttemptAt: sql<number>`0`.as('nextAttemptAt'),
            leaseToken: sql<string | null>`null`.as('leaseToken'),
            lockedUntil: sql<number | null>`null`.as('lockedUntil'),
            error: sql<string | null>`null`.as('error'),
          })
          .from(vpnUsers)
          .where(
            and(
              eq(vpnUsers.backend, input.backend),
              isNull(vpnUsers.removedAt),
              sql`exists (select 1 from access_operations where id = ${id})`,
              input.policy.required.length ||
                input.policy.resellers.some((r) => r.assignmentId)
                ? undefined
                : sql`exists (select 1 from access_assignments where vpn_user_id = ${vpnUsers.id})`,
            ),
          ),
      )
      .onConflictDoNothing(),
    auditAccess(actor, 'access.policy', id, {
      revision: input.revision + 1,
      affected: preview.affected,
      before: previous?.policy ?? null,
      after: input.policy,
    }),
  ])
  if (!(await existingOperation(id, actor.id, request))) conflict()
  return { operationId: id }
}
function auditAccess(
  actor: AccessActor,
  action: string,
  id: string,
  payload: unknown,
) {
  return db
    .insert(auditLogs)
    .select(
      db
        .select({
          id: sql<string>`${'audit:' + id}`.as('id'),
          actorUserId: sql<string | null>`${actor.id}`.as('actorUserId'),
          actorRole: sql<
            'admin' | 'reseller'
          >`${actor.role === 'admin' ? 'admin' : 'reseller'}`.as('actorRole'),
          action: sql<string>`${action}`.as('action'),
          entityType: sql<string>`'access_operation'`.as('entityType'),
          entityId: sql<string | null>`${id}`.as('entityId'),
          vpnUsername: sql<string | null>`null`.as('vpnUsername'),
          resellerId: sql<
            string | null
          >`${actor.role === 'admin' ? null : actor.id}`.as('resellerId'),
          payloadJson: sql<string | null>`${JSON.stringify(payload)}`.as(
            'payloadJson',
          ),
          createdAt: sql<Date>`${Date.now()}`.as('createdAt'),
        })
        .from(accessOperations)
        .where(eq(accessOperations.id, id)),
    )
    .onConflictDoNothing()
}
export async function getAccessOperation(
  id: string,
  actor: AccessActor,
  offset = 0,
  limit = 50,
) {
  const [operation] = await db
    .select()
    .from(accessOperations)
    .where(
      and(
        eq(accessOperations.id, id),
        actor.role === 'admin'
          ? undefined
          : eq(accessOperations.actorUserId, actor.id),
      ),
    )
  if (!operation) throw new ORPCError('NOT_FOUND')
  const tasks = await db
    .select({
      id: accessTasks.id,
      username: vpnUsers.marzbanUsername,
      status: accessTasks.status,
      attempts: accessTasks.attempts,
      error: accessTasks.error,
    })
    .from(accessTasks)
    .innerJoin(vpnUsers, eq(vpnUsers.id, accessTasks.vpnUserId))
    .where(eq(accessTasks.operationId, id))
    .orderBy(asc(accessTasks.id))
    .limit(limit)
    .offset(offset)
  const counts = await db
    .select({ status: accessTasks.status, count: sql<number>`count(*)` })
    .from(accessTasks)
    .where(eq(accessTasks.operationId, id))
    .groupBy(accessTasks.status)
  const countFor = (status: string) =>
    Number(counts.find((row) => row.status === status)?.count ?? 0)
  const total = counts.reduce((sum, row) => sum + Number(row.count), 0)
  return {
    operationId: id,
    createdAt: operation.createdAt,
    total,
    applied: countFor('applied'),
    failed: countFor('failed'),
    pending: countFor('pending'),
    skipped: countFor('skipped'),
    offset,
    limit,
    hasMore: offset + tasks.length < total,
    tasks,
  }
}
export async function retryAccessOperation(id: string, actor: AccessActor) {
  const operation = await getAccessOperation(id, actor)
  if (actor.role !== 'admin') {
    const [profile] = await db
      .select()
      .from(resellerProfiles)
      .where(eq(resellerProfiles.userId, actor.id))
    if (profile?.status !== 'active')
      throw new ORPCError('FORBIDDEN', {
        message: 'Reseller account is disabled',
      })
  }
  // Retry the current desired state; historical request payloads are never replayed.
  await db
    .update(accessTasks)
    .set({ status: 'pending', attempts: 0, nextAttemptAt: 0, error: null })
    .where(
      and(eq(accessTasks.operationId, id), eq(accessTasks.status, 'failed')),
    )
  return { operationId: operation.operationId }
}

export async function prepareCreateAccess(
  resellerId: string,
  actor: AccessActor,
  selection?: AccessSelection,
  protocols?: Record<string, unknown>,
) {
  const state = await ensureAccessPolicy()
  const chosen =
    selection ??
    defaultSelection(
      state.policy,
      resellerId,
      protocols ? Object.keys(protocols) : undefined,
    )
  const catalog = await getAccessCatalog()
  const effective = validateSelection(
    state.policy,
    chosen,
    catalog.inbounds,
    resellerId,
    actor.role === 'admin' || selection === undefined,
  )
  return {
    selection: chosen,
    effective,
    policyRevision: state.revision,
    resellerBinding:
      state.policy.resellers.find((r) => r.resellerId === resellerId)
        ?.assignmentId ?? null,
  }
}
export async function recordCreatedAccess(
  vpnUserId: string,
  prepared: {
    selection: AccessSelection
    effective: InboundRef[]
    policyRevision: number
    resellerBinding?: string | null
  },
  adminControlled: boolean,
) {
  const token = crypto.randomUUID()
  const [user] = await db
    .select()
    .from(vpnUsers)
    .where(eq(vpnUsers.id, vpnUserId))
  if (!user) conflict()
  const selection = JSON.stringify(prepared.selection)
  const effective = JSON.stringify(prepared.effective)
  await db.batch([
    db
      .update(accessPolicies)
      .set({ revision: prepared.policyRevision + 1, operationId: token })
      .where(
        and(
          eq(accessPolicies.backend, user.backend),
          eq(accessPolicies.revision, prepared.policyRevision),
        ),
      ),
    db
      .insert(accessAssignments)
      .select(
        db
          .select({
            vpnUserId: sql<string>`${vpnUserId}`.as('vpnUserId'),
            selection: sql<string>`${selection}`.as('selection'),
            revision: sql<number>`1`.as('revision'),
            adminControlled: sql<boolean>`${adminControlled ? 1 : 0}`.as(
              'adminControlled',
            ),
            operationId: sql<string>`${token}`.as('operationId'),
            observed: sql<string | null>`${effective}`.as('observed'),
            applied: sql<string | null>`${effective}`.as('applied'),
            error: sql<string | null>`null`.as('error'),
            protectedInbounds: sql<string>`${'[]'}`.as('protectedInbounds'),
            resellerBinding: sql<
              string | null
            >`${prepared.resellerBinding ?? null}`.as('resellerBinding'),
          })
          .from(accessPolicies)
          .where(
            and(
              eq(accessPolicies.backend, user.backend),
              eq(accessPolicies.operationId, token),
            ),
          ),
      )
      .onConflictDoUpdate({
        target: accessAssignments.vpnUserId,
        set: {
          selection,
          revision: sql`${accessAssignments.revision} + 1`,
          adminControlled,
          protectedInbounds: '[]',
          resellerBinding: prepared.resellerBinding ?? null,
          operationId: token,
          observed: effective,
          applied: effective,
          error: null,
        },
      }),
  ])
  if ((await getAssignment(vpnUserId))?.operationId !== token) conflict()
}

/** Webhooks only enqueue; reads never change managed accounts. */
export async function enqueueAccessReconciliation(vpnUserId: string) {
  const [user] = await db
    .select()
    .from(vpnUsers)
    .where(eq(vpnUsers.id, vpnUserId))
  if (!user || user.removedAt) return
  const state = await readAccessPolicy(user.backend)
  const assignment = await getAssignment(user.id)
  if (
    !state ||
    (!assignment &&
      !state.policy.required.length &&
      !resellerSelection(state.policy, user.resellerId))
  )
    return
  const operationId = `reconcile:${user.backend}:${user.resellerId}`
  await db
    .insert(accessOperations)
    .values({
      id: operationId,
      actorUserId: user.resellerId,
      backend: user.backend,
      request: 'reconcile',
      createdAt: Date.now(),
    })
    .onConflictDoNothing()
  const id = `reconcile:${user.id}`
  await db
    .insert(accessTasks)
    .values({ id, operationId, vpnUserId: user.id })
    .onConflictDoUpdate({
      target: accessTasks.id,
      set: { status: 'pending', attempts: 0, nextAttemptAt: 0, error: null },
      where: sql`${accessTasks.status} in ('applied', 'skipped')`,
    })
}

export async function drainAccessTasks(limit = 20, now = Date.now()) {
  const due = await db
    .select()
    .from(accessTasks)
    .where(
      and(
        eq(accessTasks.status, 'pending'),
        lte(accessTasks.nextAttemptAt, now),
        or(isNull(accessTasks.lockedUntil), lte(accessTasks.lockedUntil, now)),
      ),
    )
    .orderBy(asc(accessTasks.nextAttemptAt), asc(accessTasks.id))
    .limit(Math.min(limit, 50))
  let processed = 0
  for (const task of due) {
    const [owner] = await db
      .select({ resellerId: vpnUsers.resellerId })
      .from(vpnUsers)
      .where(eq(vpnUsers.id, task.vpnUserId))
    await withKeyedLock(owner?.resellerId ?? task.vpnUserId, async () => {
      const token = crypto.randomUUID()
      const leaseNow = Math.max(now, Date.now())
      const [lease] = await db
        .insert(accessLeases)
        .values({
          vpnUserId: task.vpnUserId,
          token,
          lockedUntil: leaseNow + LEASE_MS,
        })
        .onConflictDoUpdate({
          target: accessLeases.vpnUserId,
          set: { token, lockedUntil: leaseNow + LEASE_MS },
          where: lte(accessLeases.lockedUntil, leaseNow),
        })
        .returning()
      if (!lease || lease.token !== token) return
      try {
        const [claimed] = await db
          .update(accessTasks)
          .set({ leaseToken: token, lockedUntil: leaseNow + LEASE_MS })
          .where(
            and(
              eq(accessTasks.id, task.id),
              eq(accessTasks.status, 'pending'),
              or(
                isNull(accessTasks.lockedUntil),
                lte(accessTasks.lockedUntil, leaseNow),
              ),
            ),
          )
          .returning()
        if (!claimed) return
        const [user] = await db
          .select()
          .from(vpnUsers)
          .where(eq(vpnUsers.id, task.vpnUserId))
        if (!user || user.removedAt) {
          await finishTask(task.id, token, 'skipped')
          return
        }
        if (await hasPendingVpnOperation(user.marzbanUsername))
          throw new BackendError(
            'VPN operation recovery is pending',
            'UNAVAILABLE',
          )
        const state = await readAccessPolicy(user.backend)
        if (!state) {
          await finishTask(task.id, token, 'skipped')
          return
        }
        const provider = getBackend(user.backend)
        if (!provider.setAccess)
          fail('Backend does not support inbound management')
        const remote = await provider.getUser(user.marzbanUsername, {
          repair: false,
        })
        let assignment = await getAssignment(user.id)
        if (
          !assignment &&
          !state.policy.required.length &&
          !resellerSelection(state.policy, user.resellerId)
        ) {
          await finishTask(task.id, token, 'skipped')
          return
        }
        const binding =
          state.policy.resellers.find((r) => r.resellerId === user.resellerId)
            ?.assignmentId ?? null
        if (
          !assignment ||
          (binding && binding !== assignment.resellerBinding)
        ) {
          await recordCreatedAccess(
            user.id,
            {
              selection: effectiveUserSelection(
                state.policy,
                user.resellerId,
                assignment,
                remote.inbounds ?? [],
              ),
              resellerBinding: binding,
              effective: remote.inbounds ?? [],
              policyRevision: state.revision,
            },
            true,
          )
          state.revision += 1
          assignment = await getAssignment(user.id)
        }
        const selection = accessSelectionSchema.parse(
          JSON.parse(assignment!.selection),
        )
        const effective = effectiveInbounds(
          state.policy,
          restrictSelection(
            state.policy,
            selection,
            user.resellerId,
            assignment!.adminControlled,
            protectedInbounds(assignment),
          ),
        )
        if (!effective.length) fail('Select at least one inbound')
        assertCatalogSelection(
          effective,
          (await getAccessCatalog(user.backend)).inbounds,
        )
        // Read the latest revision immediately before the remote call. A concurrent newer write is retried below.
        if (
          (await readAccessPolicy(user.backend))?.revision !== state.revision ||
          (await getAssignment(user.id))?.revision !== assignment!.revision
        )
          throw new BackendError(
            'Access changed during application',
            'UNAVAILABLE',
          )
        const changed = !sameBackendInbounds(effective, remote.inbounds ?? [])
        if (changed)
          await provider.setAccess!(
            user.marzbanUsername,
            backendInbounds(effective),
          )
        const observed = await provider.getUser(user.marzbanUsername, {
          repair: false,
        })
        if (!sameBackendInbounds(effective, observed.inbounds ?? []))
          throw new BackendError(
            'Backend has not applied the requested selection',
            'UNAVAILABLE',
          )
        if (
          (await readAccessPolicy(user.backend))?.revision !== state.revision ||
          (await getAssignment(user.id))?.revision !== assignment!.revision
        )
          throw new BackendError(
            'A newer access revision is pending',
            'UNAVAILABLE',
          )
        await db
          .update(accessAssignments)
          .set({
            observed: JSON.stringify(observed.inbounds ?? []),
            applied: JSON.stringify(effective),
            error: null,
          })
          .where(
            and(
              eq(accessAssignments.vpnUserId, user.id),
              eq(accessAssignments.revision, assignment!.revision),
            ),
          )
        await finishTask(
          task.id,
          token,
          'applied',
          changed || !task.id.startsWith('reconcile:'),
        )
        processed++
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Access application failed'
        const attempts = task.attempts + 1
        const permanent =
          (error instanceof BackendError &&
            ['INVALID', 'UNSUPPORTED', 'NOT_FOUND'].includes(error.code)) ||
          (error instanceof ORPCError && error.code !== 'CONFLICT') ||
          (!(error instanceof BackendError) &&
            /unavailable|at least one|template/.test(message))
        await db.batch([
          taskAudit(
            task.id,
            token,
            'failed',
            message,
            permanent || attempts >= MAX_ATTEMPTS,
          ),
          db
            .update(accessTasks)
            .set({
              status:
                permanent || attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
              attempts,
              error: message,
              lockedUntil: null,
              leaseToken: null,
              nextAttemptAt: now + Math.min(300_000, 1000 * 2 ** attempts),
            })
            .where(
              and(
                eq(accessTasks.id, task.id),
                eq(accessTasks.leaseToken, token),
              ),
            ),
        ])
        await db
          .update(accessAssignments)
          .set({ error: message })
          .where(eq(accessAssignments.vpnUserId, task.vpnUserId))
      } finally {
        await db
          .delete(accessLeases)
          .where(
            and(
              eq(accessLeases.vpnUserId, task.vpnUserId),
              eq(accessLeases.token, token),
            ),
          )
      }
    })
  }

  return { processed, inspected: due.length }
}
function taskAudit(
  id: string,
  token: string,
  status: string,
  error: string | null = null,
  enabled = true,
) {
  return db
    .insert(auditLogs)
    .select(
      db
        .select({
          id: sql<string>`${'result:' + id + ':' + token}`.as('id'),
          actorUserId: sql<string | null>`null`.as('actorUserId'),
          actorRole: sql<'system'>`'system'`.as('actorRole'),
          action: sql<string>`${'access.' + status}`.as('action'),
          entityType: sql<string>`'vpn_user'`.as('entityType'),
          entityId: accessTasks.vpnUserId,
          vpnUsername: vpnUsers.marzbanUsername,
          resellerId: vpnUsers.resellerId,
          payloadJson: sql<
            string | null
          >`${JSON.stringify({ taskId: id, error })}`.as('payloadJson'),
          createdAt: sql<Date>`${Date.now()}`.as('createdAt'),
        })
        .from(accessTasks)
        .innerJoin(vpnUsers, eq(vpnUsers.id, accessTasks.vpnUserId))
        .where(
          and(
            eq(accessTasks.id, id),
            eq(accessTasks.leaseToken, token),
            enabled ? undefined : sql`0`,
          ),
        ),
    )
    .onConflictDoNothing()
}
async function finishTask(
  id: string,
  token: string,
  status: 'applied' | 'skipped',
  audit = !id.startsWith('reconcile:'),
) {
  await db.batch([
    taskAudit(id, token, status, null, audit),
    db
      .update(accessTasks)
      .set({ status, error: null, lockedUntil: null, leaseToken: null })
      .where(and(eq(accessTasks.id, id), eq(accessTasks.leaseToken, token))),
  ])
}
