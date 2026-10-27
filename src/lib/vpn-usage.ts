/** Marzban uses both zero and null for unlimited traffic. */
export function remainingTrafficBytes(used: number, limit: number | null) {
  return limit == null || limit <= 0 ? null : Math.max(0, limit - used)
}

export function remainingDays(expireAt: string | null, now = Date.now()) {
  if (!expireAt) return null
  const expiry = Date.parse(expireAt)
  if (!Number.isFinite(expiry)) return null
  return Math.max(0, Math.ceil((expiry - now) / 86_400_000))
}
