import * as z from 'zod'
import { db } from '#/db'
import { accessOperations } from '#/db/schema'
import { desc, eq } from 'drizzle-orm'
import { adminOnly } from '../middleware'
import { outputSpec } from '../openapi-response'
import {
  accessPolicySchema,
  accessSelectionSchema,
  allowedInbounds,
  inboundKey,
  defaultSelection,
} from '#/lib/access-policy'
import {
  ensureAccessPolicy,
  getAccessCatalog,
  userAccessView,
  setUserAccess,
  previewAccessPolicy,
  saveAccessPolicy,
  getAccessOperation,
  retryAccessOperation,
  drainAccessTasks,
} from '#/lib/access'

const backendSchema = z.string().min(1).max(80).default('marzban')
const keySchema = z.string().uuid()
export const catalog = adminOnly
  .route({
    tags: ['Connection access'],
    summary: 'Discover permitted inbounds and shared templates',
    spec: outputSpec('access.catalog'),
  })
  .input(
    z
      .object({ backend: backendSchema, resellerId: z.string().optional() })
      .default({ backend: 'marzban' }),
  )
  .handler(async ({ input, context }) => {
    const state = await ensureAccessPolicy(input.backend)
    const catalog = await getAccessCatalog(input.backend)
    const resellerId =
      context.user.role === 'admin'
        ? (input.resellerId ?? context.user.id)
        : context.user.id
    const allowed = allowedInbounds(state.policy, resellerId)
    const keys = new Set([...allowed, ...state.policy.required].map(inboundKey))
    return {
      backend: input.backend,
      revision: state.revision,
      ...catalog,
      inbounds: catalog.inbounds.filter(
        (i) => context.user.role === 'admin' || keys.has(inboundKey(i)),
      ),
      required: state.policy.required,
      allowed,
      defaultSelection: defaultSelection(state.policy, resellerId),
      templates: state.policy.templates.filter(
        (t) =>
          context.user.role === 'admin' ||
          t.inbounds.every((i) => keys.has(inboundKey(i))),
      ),
      defaultTemplateId:
        state.policy.resellers.find((r) => r.resellerId === resellerId)
          ?.defaultTemplateId ?? null,
    }
  })
export const user = adminOnly
  .route({
    tags: ['Connection access'],
    summary: 'Read user desired and observed access',
    spec: outputSpec('access.user'),
  })
  .input(z.object({ username: z.string().min(1) }))
  .handler(({ input, context }) => userAccessView(input.username, context.user))
export const assign = adminOnly
  .route({
    tags: ['Connection access'],
    summary: 'Assign a linked template or custom inbound selection',
    spec: outputSpec('access.assign'),
  })
  .input(
    z.object({
      username: z.string().min(1),
      selection: accessSelectionSchema,
      revision: z.number().int().min(0),
      policyRevision: z.number().int().min(0),
      idempotencyKey: keySchema,
    }),
  )
  .handler(({ input, context }) => setUserAccess(input, context.user))
export const policy = adminOnly
  .route({
    tags: ['Connection access'],
    summary: 'Read administrator access policy',
    spec: outputSpec('access.policy'),
  })
  .input(z.object({ backend: backendSchema }).default({ backend: 'marzban' }))
  .handler(({ input }) => ensureAccessPolicy(input.backend))
export const preview = adminOnly
  .route({
    tags: ['Connection access'],
    summary: 'Preview template, allowlist and global access changes',
    spec: outputSpec('access.preview'),
  })
  .input(z.object({ backend: backendSchema, policy: accessPolicySchema }))
  .handler(({ input }) => previewAccessPolicy(input.policy, input.backend))
export const savePolicy = adminOnly
  .route({
    tags: ['Connection access'],
    summary: 'Apply a reviewed access policy and enqueue affected users',
    spec: outputSpec('access.savePolicy'),
  })
  .input(
    z.object({
      backend: backendSchema,
      policy: accessPolicySchema,
      revision: z.number().int().min(0),
      idempotencyKey: keySchema,
    }),
  )
  .handler(({ input, context }) => saveAccessPolicy(input, context.user))
export const operation = adminOnly
  .route({
    tags: ['Connection access'],
    summary: 'Read connection access operation progress',
    spec: outputSpec('access.operation'),
  })
  .input(
    z.object({
      id: z.string().min(1).max(200),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(100).default(50),
    }),
  )
  .handler(({ input, context }) =>
    getAccessOperation(input.id, context.user, input.offset, input.limit),
  )
export const operations = adminOnly
  .route({
    tags: ['Connection access'],
    summary: 'List recent connection access operations',
    spec: outputSpec('access.operations'),
  })
  .handler(async ({ context }) =>
    db
      .select({
        id: accessOperations.id,
        backend: accessOperations.backend,
        createdAt: accessOperations.createdAt,
      })
      .from(accessOperations)
      .where(
        context.user.role === 'admin'
          ? undefined
          : eq(accessOperations.actorUserId, context.user.id),
      )
      .orderBy(desc(accessOperations.createdAt))
      .limit(30),
  )
export const retry = adminOnly
  .route({
    tags: ['Connection access'],
    summary: 'Retry failed access application tasks',
    spec: outputSpec('access.retry'),
  })
  .input(z.object({ id: z.string().min(1).max(200) }))
  .handler(({ input, context }) => retryAccessOperation(input.id, context.user))
export const drain = adminOnly
  .route({
    tags: ['Connection access'],
    summary: 'Process a bounded batch of pending access tasks',
    spec: outputSpec('access.drain'),
  })
  .input(
    z
      .object({ limit: z.number().int().min(1).max(50).default(20) })
      .default({ limit: 20 }),
  )
  .handler(({ input }) => drainAccessTasks(input.limit))
