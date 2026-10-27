import type { MarzbanInbounds, MarzbanUserResponse } from './types.ts'

/**
 * Build inbound tag map for the given proxy protocols.
 * Marzban on this deployment leaves `inbounds` empty when the field is omitted,
 * which yields an empty subscription body (valid URL, zero configs).
 */
export function buildInboundsForProxies(
  proxies: Record<string, unknown>,
  catalog: MarzbanInbounds,
): Record<string, string[]> {
  const inbounds: Record<string, string[]> = {}
  for (const protocol of Object.keys(proxies)) {
    const tags = (catalog[protocol] ?? [])
      .map((item) => item.tag)
      .filter(Boolean)
    if (tags.length > 0) {
      inbounds[protocol] = tags
    }
  }
  return inbounds
}

/** True when the user has proxies but no usable inbound tags / share links. */
export function needsInboundRepair(user: MarzbanUserResponse): boolean {
  const proxies = Object.keys(user.proxies ?? {})
  if (proxies.length === 0) return false

  if ((user.links ?? []).length > 0) return false

  return proxies.some((protocol) => {
    const tags = user.inbounds?.[protocol]
    return !tags || tags.length === 0
  })
}
