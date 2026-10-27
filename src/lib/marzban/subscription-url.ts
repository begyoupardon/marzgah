import { getEnv } from '#/lib/env'
/**
 * Marzban builds `subscription_url` as:
 *   `${XRAY_SUBSCRIPTION_URL_PREFIX}/${XRAY_SUBSCRIPTION_PATH}/${token}`
 * When the prefix env is empty, the API returns a relative path like `/sub/<token>`,
 * which is unusable in VPN clients / QR codes. Resolve against the public Marzban URL.
 *
 * Prefer MARZBAN_SUBSCRIPTION_URL_PREFIX when the API host differs from the
 * public subscription host; otherwise fall back to MARZBAN_BASE_URL.
 */
export function resolveSubscriptionUrl(
  raw: string | null | undefined,
  options?: { publicBase?: string | null },
): string | null {
  const value = raw?.trim()
  if (!value) return null

  const publicBase = (
    options?.publicBase ??
    getEnv().MARZBAN_SUBSCRIPTION_URL_PREFIX ??
    getEnv().MARZBAN_BASE_URL ??
    ''
  )
    .trim()
    .replace(/\/$/, '')

  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value)
      const isLoopback =
        parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1' ||
        parsed.hostname === '0.0.0.0' ||
        parsed.hostname === '::1' ||
        parsed.hostname.endsWith('.local')

      if (isLoopback && publicBase) {
        const base = new URL(
          publicBase.includes('://') ? publicBase : `https://${publicBase}`,
        )
        return `${base.origin}${parsed.pathname}${parsed.search}${parsed.hash}`
      }
    } catch {
      return value
    }
    return value
  }

  if (value.startsWith('//')) {
    return `https:${value}`
  }

  if (!publicBase) return value

  const baseWithScheme = publicBase.includes('://')
    ? publicBase
    : `https://${publicBase}`

  if (value.startsWith('/')) return `${baseWithScheme}${value}`
  return `${baseWithScheme}/${value}`
}
