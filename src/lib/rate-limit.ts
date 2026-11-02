/**
 * In-memory fixed-window limiter. Good enough for one process; with several
 * instances each keeps its own counts, which only makes limits looser.
 */
export function createRateLimiter({
  windowMs,
  max,
}: {
  windowMs: number
  max: number
}) {
  const hits = new Map<string, { count: number; resetAt: number }>()
  return {
    hit(key: string, now = Date.now()) {
      if (hits.size > 10_000) {
        for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k)
      }
      const entry = hits.get(key)
      if (!entry || entry.resetAt <= now) {
        hits.set(key, { count: 1, resetAt: now + windowMs })
        return { allowed: true, retryAfterMs: 0 }
      }
      entry.count++
      return entry.count <= max
        ? { allowed: true, retryAfterMs: 0 }
        : { allowed: false, retryAfterMs: entry.resetAt - now }
    },
  }
}

const onCloudflare = () =>
  globalThis.navigator?.userAgent === 'Cloudflare-Workers'

/**
 * Client IP from a header the nearest trusted proxy set. Cloudflare overwrites
 * cf-connecting-ip; elsewhere the proxy appends to X-Forwarded-For, so the last
 * entry is its doing and earlier ones are client-controlled.
 * shortcut: with no proxy at all the header is client-controlled, put one in front.
 */
export function clientIp(headers: Headers) {
  if (onCloudflare()) return headers.get('cf-connecting-ip') || 'unknown'
  return (
    headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() ||
    headers.get('x-real-ip') ||
    'unknown'
  )
}
