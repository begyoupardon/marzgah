import * as z from 'zod'

export const marzbanUserStatusSchema = z.enum([
  'active',
  'disabled',
  'limited',
  'expired',
  'on_hold',
])

export type MarzbanUserStatus = z.infer<typeof marzbanUserStatusSchema>

export const marzbanWebhookActionSchema = z.enum([
  'user_created',
  'user_updated',
  'user_deleted',
  'user_limited',
  'user_expired',
  'user_disabled',
  'user_enabled',
])

export type MarzbanWebhookAction = z.infer<typeof marzbanWebhookActionSchema>

export const marzbanWebhookPayloadSchema = z.object({
  username: z.string().min(1),
  action: marzbanWebhookActionSchema,
  enqueued_at: z.number(),
  tries: z.number().optional().default(0),
})

export type MarzbanWebhookPayload = z.infer<typeof marzbanWebhookPayloadSchema>

export const marzbanUserResponseSchema = z
  .object({
    username: z.string(),
    status: marzbanUserStatusSchema,
    used_traffic: z.number().default(0),
    lifetime_used_traffic: z.number().optional().default(0),
    data_limit: z.number().nullable().optional(),
    expire: z.number().nullable().optional(),
    note: z.string().nullable().optional(),
    subscription_url: z.string().optional().default(''),
    links: z.array(z.string()).optional().default([]),
    proxies: z.record(z.string(), z.unknown()).optional().default({}),
    inbounds: z.record(z.string(), z.array(z.string())).optional().default({}),
    data_limit_reset_strategy: z.string().optional(),
    created_at: z.string().optional(),
  })
  .passthrough()

export type MarzbanUserResponse = z.infer<typeof marzbanUserResponseSchema>

export const marzbanUsersResponseSchema = z.object({
  users: z.array(marzbanUserResponseSchema),
  total: z.number(),
})

export const marzbanCreateUserSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9-_@.]+$/),
  proxies: z.record(z.string(), z.unknown()).default({ vless: {} }),
  inbounds: z.record(z.string(), z.array(z.string())).optional(),
  expire: z.number().nullable().optional(),
  data_limit: z.number().nullable().optional(),
  data_limit_reset_strategy: z
    .enum(['no_reset', 'day', 'week', 'month', 'year'])
    .optional()
    .default('no_reset'),
  status: z.enum(['active', 'on_hold']).optional().default('active'),
  note: z.string().max(500).nullable().optional(),
})

export type MarzbanCreateUserInput = z.infer<typeof marzbanCreateUserSchema>

export const marzbanModifyUserSchema = z.object({
  proxies: z.record(z.string(), z.unknown()).optional(),
  inbounds: z.record(z.string(), z.array(z.string())).optional(),
  expire: z.number().nullable().optional(),
  data_limit: z.number().nullable().optional(),
  data_limit_reset_strategy: z
    .enum(['no_reset', 'day', 'week', 'month', 'year'])
    .optional(),
  status: z.enum(['active', 'disabled', 'on_hold']).optional(),
  note: z.string().max(500).nullable().optional(),
})

export type MarzbanModifyUserInput = z.infer<typeof marzbanModifyUserSchema>

export const marzbanSystemStatsSchema = z
  .object({
    version: z.string().optional(),
    total_user: z.number().optional(),
    users_active: z.number().optional(),
    incoming_bandwidth: z.number().optional(),
    outgoing_bandwidth: z.number().optional(),
  })
  .passthrough()

/** GET /api/inbounds — protocol → inbound objects (at least `tag`). */
export const marzbanInboundsSchema = z.record(
  z.string(),
  z.array(
    z
      .object({
        tag: z.string(),
        protocol: z.string().optional(),
        network: z.string().optional(),
      })
      .passthrough(),
  ),
)

export type MarzbanInbounds = z.infer<typeof marzbanInboundsSchema>
