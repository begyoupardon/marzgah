import { createFileRoute } from '@tanstack/react-router'

import { auth } from '#/lib/auth'
import { clientIp } from '#/lib/rate-limit'

/**
 * better-auth rate-limits by the first X-Forwarded-For entry, which a client
 * controls behind an appending proxy. Pass it the entry our own limiter trusts.
 */
function withTrustedIp(request: Request) {
  const headers = new Headers(request.headers)
  const ip = clientIp(request.headers)
  if (ip !== 'unknown') headers.set('x-forwarded-for', ip)
  return new Request(request, { headers })
}

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => auth.handler(withTrustedIp(request)),
      POST: ({ request }) => auth.handler(withTrustedIp(request)),
    },
  },
})
