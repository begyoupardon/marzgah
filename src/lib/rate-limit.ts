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

/** First hop from X-Forwarded-For (set by the reverse proxy), else a shared bucket. */
export function clientIp(headers: Headers) {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    'unknown'
  )
}
