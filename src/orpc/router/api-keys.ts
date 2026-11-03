import { ORPCError } from '@orpc/server'
import * as z from 'zod'

import { createApiKey, listApiKeys, revokeApiKey } from '#/lib/api-keys'
import { writeAuditLog } from '#/lib/ledger'
import { sessionOnly } from '../middleware'

export const list = sessionOnly.handler(async ({ context }) =>
  listApiKeys(context.user.id),
)

export const create = sessionOnly
  .input(
    z.object({
      name: z.string().trim().min(1).max(80),
      expiresInDays: z
        .union([z.literal(30), z.literal(90), z.literal(365)])
        .default(90),
    }),
  )
  .handler(async ({ input, context }) => {
    const result = await createApiKey(
      context.user.id,
      input.name,
      input.expiresInDays,
    )
    await writeAuditLog({
      actorUserId: context.user.id,
      actorRole: context.user.role === 'admin' ? 'admin' : 'reseller',
      action: 'api_key.create',
      entityType: 'api_key',
      entityId: result.key.id,
    }).catch((error) => console.error('API key creation audit failed', error))
    return result
  })

export const revoke = sessionOnly
  .input(z.object({ id: z.string().uuid() }))
  .handler(async ({ input, context }) => {
    if (!(await revokeApiKey(context.user.id, input.id))) {
      throw new ORPCError('NOT_FOUND', { message: 'کلید پیدا نشد' })
    }
    await writeAuditLog({
      actorUserId: context.user.id,
      actorRole: context.user.role === 'admin' ? 'admin' : 'reseller',
      action: 'api_key.revoke',
      entityType: 'api_key',
      entityId: input.id,
    }).catch((error) => console.error('API key revocation audit failed', error))
    return { ok: true }
  })
