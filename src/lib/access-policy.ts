import * as z from 'zod'
import type { InboundRef } from '#/lib/backends/types'

export const inboundRefSchema = z
  .object({
    protocol: z.string().min(1).max(64),
    tag: z.string().min(1).max(255),
  })
  .strict()
export const inboundListSchema = z.array(inboundRefSchema).max(500)
export const accessSelectionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('custom'), inbounds: inboundListSchema }).strict(),
  z
    .object({
      mode: z.literal('template'),
      templateId: z.string().min(1).max(80),
    })
    .strict(),
])
export type AccessSelection = z.infer<typeof accessSelectionSchema>
export const accessPolicySchema = z
  .object({
    required: inboundListSchema,
    approved: inboundListSchema,
    templates: z
      .array(
        z
          .object({
            id: z.string().min(1).max(80),
            name: z.string().trim().min(1).max(100),
            inbounds: inboundListSchema.min(1),
          })
          .strict(),
      )
      .max(200),
    resellers: z
      .array(
        z
          .object({
            resellerId: z.string().min(1),
            allowed: inboundListSchema,
            defaultTemplateId: z.string().nullable(),
          })
          .strict(),
      )
      .max(2000),
  })
  .strict()
export type AccessPolicy = z.infer<typeof accessPolicySchema>
export const inboundKey = (i: InboundRef) => JSON.stringify([i.protocol, i.tag])
export function normalizeInbounds(values: InboundRef[]): InboundRef[] {
  return [
    ...new Map(
      values.map((i) => [inboundKey(i), { protocol: i.protocol, tag: i.tag }]),
    ).values(),
  ].sort((a, b) => inboundKey(a).localeCompare(inboundKey(b)))
}
export function sameInbounds(a: InboundRef[], b: InboundRef[]) {
  return (
    JSON.stringify(normalizeInbounds(a)) ===
    JSON.stringify(normalizeInbounds(b))
  )
}
export function allowedInbounds(policy: AccessPolicy, resellerId: string) {
  return (
    policy.resellers.find((r) => r.resellerId === resellerId)?.allowed ??
    policy.approved
  )
}
export function baseInbounds(
  policy: AccessPolicy,
  selection: AccessSelection,
): InboundRef[] {
  if (selection.mode === 'custom') return normalizeInbounds(selection.inbounds)
  const template = policy.templates.find((t) => t.id === selection.templateId)
  if (!template) throw new Error('Access template is unavailable')
  return normalizeInbounds(template.inbounds)
}
export function effectiveInbounds(
  policy: AccessPolicy,
  selection: AccessSelection,
) {
  return normalizeInbounds([
    ...baseInbounds(policy, selection),
    ...policy.required,
  ])
}
export function assertCatalogSelection(
  inbounds: InboundRef[],
  catalog: InboundRef[],
) {
  const keys = new Set(catalog.map(inboundKey))
  if (inbounds.some((i) => !keys.has(inboundKey(i))))
    throw new Error('An inbound is unavailable. Refresh the catalog.')
}
export function defaultSelection(
  policy: AccessPolicy,
  resellerId: string,
  protocols = ['vless'],
): AccessSelection {
  const templateId = policy.resellers.find(
    (r) => r.resellerId === resellerId,
  )?.defaultTemplateId
  return templateId
    ? { mode: 'template', templateId }
    : {
        mode: 'custom',
        inbounds: allowedInbounds(policy, resellerId).filter((i) =>
          protocols.includes(i.protocol),
        ),
      }
}
