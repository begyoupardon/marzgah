import { and, desc, eq } from 'drizzle-orm'
import * as z from 'zod'

import { db } from '#/db'
import { auditLogs } from '#/db/schema'
import { serializeAuditRow } from '#/lib/ledger'
import { adminOnly } from '../middleware'
import { outputSpec } from '../openapi-response'

export const listAuditLogs = adminOnly
  .route({
    summary: 'List audit logs',
    description:
      'Use this operation to list audit logs under the caller’s current role and ownership rules.',
    tags: ['Audit'],
    spec: outputSpec('audit.listAuditLogs'),
  })
  .input(
    z
      .object({
        resellerId: z.string().optional(),
        action: z.string().optional(),
        vpnUsername: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      })
      .optional(),
  )
  .handler(async ({ input }) => {
    const limit = input?.limit ?? 100
    const conditions = []

    if (input?.resellerId) {
      conditions.push(eq(auditLogs.resellerId, input.resellerId))
    }
    if (input?.action) {
      conditions.push(eq(auditLogs.action, input.action))
    }
    if (input?.vpnUsername) {
      conditions.push(eq(auditLogs.vpnUsername, input.vpnUsername))
    }

    const rows = await db
      .select()
      .from(auditLogs)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)

    return rows.map(serializeAuditRow)
  })
