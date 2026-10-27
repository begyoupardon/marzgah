import { expect, it } from 'bun:test'

import { clientIp, createRateLimiter } from './rate-limit'

it('allows up to max per window per key, then blocks with a retry hint', () => {
  const rl = createRateLimiter({ windowMs: 1000, max: 2 })
  expect(rl.hit('a', 0).allowed).toBe(true)
  expect(rl.hit('a', 10).allowed).toBe(true)
  const blocked = rl.hit('a', 20)
  expect(blocked).toEqual({ allowed: false, retryAfterMs: 980 })
  expect(rl.hit('b', 20).allowed).toBe(true) // other keys unaffected
  expect(rl.hit('a', 1001).allowed).toBe(true) // window reset
})

it('takes the first forwarded address', () => {
  expect(
    clientIp(new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' })),
  ).toBe('1.2.3.4')
  expect(clientIp(new Headers({ 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9')
  expect(clientIp(new Headers())).toBe('unknown')
})
