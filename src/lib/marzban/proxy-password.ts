/** Proxy protocols in Marzban that store a plaintext password. */
const PASSWORD_PROXY_TYPES = new Set([
  'trojan',
  'shadowsocks',
  'socks',
  'shadowsocks2022',
])

function asProxyObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) }
  }
  return {}
}

/**
 * Sets `password` on every password-based proxy the user already has.
 * Returns null when no such proxy exists (e.g. VLESS/VMess only).
 */
export function applyProxyPassword(
  proxies: Record<string, unknown>,
  password: string,
): Record<string, unknown> | null {
  const next: Record<string, unknown> = {}
  let applied = 0

  for (const [protocol, settings] of Object.entries(proxies)) {
    const base = asProxyObject(settings)
    if (PASSWORD_PROXY_TYPES.has(protocol.toLowerCase())) {
      next[protocol] = { ...base, password }
      applied += 1
    } else {
      next[protocol] = base
    }
  }

  return applied > 0 ? next : null
}
