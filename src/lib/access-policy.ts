import * as z from 'zod'
import type { InboundRef } from '#/lib/backends/types'

export const inboundRefSchema = z
  .object({
    protocol: z.string().min(1).max(64),
    tag: z.string().min(1).max(255),
    hostIds: z
      .array(z.string().regex(/^[a-f0-9]{64}$/))
      .min(1)
      .max(500)
      .optional(),
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
    hostDefaults: z.boolean().optional(),
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
            assignmentId: z.string().uuid().optional(),
          })
          .strict(),
      )
      .max(2000),
  })
  .strict()
export type AccessPolicy = z.infer<typeof accessPolicySchema>
export const inboundKey = (i: InboundRef) => JSON.stringify([i.protocol, i.tag])
export function normalizeInbounds(values: InboundRef[]): InboundRef[] {
  const merged = new Map<string, InboundRef>()
  for (const item of values) {
    const key = inboundKey(item)
    const previous = merged.get(key)
    const hostIds = item.hostIds ? [...new Set(item.hostIds)].sort() : undefined
    merged.set(key, {
      protocol: item.protocol,
      tag: item.tag,
      ...(previous
        ? previous.hostIds && hostIds
          ? { hostIds: [...new Set([...previous.hostIds, ...hostIds])].sort() }
          : {}
        : hostIds
          ? { hostIds }
          : {}),
    })
  }
  return [...merged.values()].sort((a, b) =>
    inboundKey(a).localeCompare(inboundKey(b)),
  )
}
export function backendInbounds(values: InboundRef[]): InboundRef[] {
  return normalizeInbounds(
    values.map(({ protocol, tag }) => ({ protocol, tag })),
  )
}
export function sameBackendInbounds(a: InboundRef[], b: InboundRef[]) {
  return sameInbounds(backendInbounds(a), backendInbounds(b))
}
export function resellerSelection(
  policy: AccessPolicy,
  resellerId: string,
): AccessSelection | null {
  const reseller = policy.resellers.find((r) => r.resellerId === resellerId)
  if (!reseller?.assignmentId) return null
  return reseller.defaultTemplateId
    ? { mode: 'template', templateId: reseller.defaultTemplateId }
    : { mode: 'custom', inbounds: reseller.allowed }
}
export function effectiveUserSelection(
  policy: AccessPolicy,
  resellerId: string,
  assignment: { selection: string; resellerBinding: string | null } | null,
  fallback: InboundRef[] = [],
): AccessSelection {
  const reseller = policy.resellers.find((r) => r.resellerId === resellerId)
  if (
    reseller?.assignmentId &&
    reseller.assignmentId !== assignment?.resellerBinding
  )
    return resellerSelection(policy, resellerId)!
  return assignment
    ? accessSelectionSchema.parse(JSON.parse(assignment.selection))
    : { mode: 'custom', inbounds: fallback }
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
  catalog: Array<
    InboundRef & { hosts?: Array<{ id?: string; disabled?: boolean }> }
  >,
) {
  const keys = new Set(catalog.map(inboundKey))
  if (inbounds.some((i) => !keys.has(inboundKey(i))))
    throw new Error('An inbound is unavailable. Refresh the catalog.')
  for (const inbound of inbounds) {
    if (
      inbound.hostIds &&
      inbound.hostIds.some(
        (id) =>
          !catalog
            .find((i) => inboundKey(i) === inboundKey(inbound))
            ?.hosts?.some((host) => host.id === id && !host.disabled),
      )
    )
      throw new Error('A selected host is unavailable. Refresh the catalog.')
  }
}
export function defaultSelection(
  policy: AccessPolicy,
  resellerId: string,
  protocols?: string[],
): AccessSelection {
  const assigned = resellerSelection(policy, resellerId)
  if (assigned) return assigned
  const templateId = policy.resellers.find(
    (r) => r.resellerId === resellerId,
  )?.defaultTemplateId
  return templateId
    ? { mode: 'template', templateId }
    : {
        mode: 'custom',
        inbounds: allowedInbounds(policy, resellerId).filter(
          (i) =>
            (protocols ?? (policy.hostDefaults ? null : ['vless']))?.includes(
              i.protocol,
            ) ?? true,
        ),
      }
}
