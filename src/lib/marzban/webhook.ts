import { getEnv } from '#/lib/env'

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let out = 0
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return out === 0
}

export function verifyMarzbanWebhookSecret(
  headerValue: string | null,
): boolean {
  const expected = getEnv().MARZBAN_WEBHOOK_SECRET
  if (!expected) return false
  if (!headerValue) return false
  return timingSafeEqualString(headerValue, expected)
}
