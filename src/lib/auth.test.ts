import { beforeAll, expect, it } from 'bun:test'
import { hoisted, vi } from '../../test/helpers/hoisted'
import { hashPassword } from 'better-auth/crypto'

const store = hoisted(() => ({
  user: [] as Array<Record<string, unknown>>,
  account: [] as Array<Record<string, unknown>>,
  session: [],
  verification: [],
}))
vi.mock('#/db', () => ({ db: {} }))
vi.mock('better-auth/adapters/drizzle', async () => {
  const { memoryAdapter } = await import('better-auth/adapters/memory')
  return { drizzleAdapter: () => memoryAdapter(store) }
})
vi.mock('better-auth/tanstack-start', () => ({
  tanstackStartCookies: () => ({ id: 'test-cookies' }),
}))
hoisted(() => {
  process.env.BETTER_AUTH_URL = 'https://panel.test'
  process.env.BETTER_AUTH_SECRET =
    'test-secret-at-least-thirty-two-characters-long'
})

const { auth } = await import('./auth')

const password = 'a'.repeat(129)
beforeAll(async () => {
  store.user.push({
    id: 'reseller',
    email: 'reseller@example.com',
    name: 'Reseller',
    role: 'reseller',
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  store.account.push({
    id: 'credential',
    userId: 'reseller',
    accountId: 'reseller',
    providerId: 'credential',
    password: await hashPassword(password),
    createdAt: new Date(),
    updatedAt: new Date(),
  })
})
function signIn(
  email: string,
  inputPassword: string,
  origin = 'https://panel.test',
) {
  return auth.handler(
    new Request('https://panel.test/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ email, password: inputPassword }),
    }),
  )
}
it('authenticates existing credentials longer than the library default and sets a secure session cookie', async () => {
  const response = await signIn('RESELLER@example.com', password)
  expect(response.status).toBe(200)
  expect(response.headers.get('set-cookie')).toContain('HttpOnly')
  expect(response.headers.get('set-cookie')).toContain('Secure')
  const body = await response.json<{ user: { id: string; role: string } }>()
  expect(body.user.id).toBe('reseller')
  expect(body.user.role).toBe('reseller')
})
it('rejects an incorrect password', async () => {
  const response = await signIn('reseller@example.com', 'wrong')
  expect(response.status).toBe(401)
  expect((await response.json<{ code: string }>()).code).toBe(
    'INVALID_EMAIL_OR_PASSWORD',
  )
})
it('rejects unknown accounts', async () => {
  expect((await signIn('missing@example.com', password)).status).toBe(401)
})
it('rejects requests from untrusted origins', async () => {
  expect(
    (await signIn('reseller@example.com', password, 'https://evil.test'))
      .status,
  ).toBe(403)
})
it('keeps public signup disabled', async () => {
  const response = await auth.handler(
    new Request('https://panel.test/api/auth/sign-up/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://panel.test',
      },
      body: JSON.stringify({ email: 'new@example.com', password, name: 'New' }),
    }),
  )
  expect(response.status).not.toBe(200)
  expect(store.user).toHaveLength(1)
})
it('rate limits repeated sign-in attempts from one address', async () => {
  const attempt = () =>
    auth.handler(
      new Request('https://panel.test/api/auth/sign-in/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://panel.test',
          'x-forwarded-for': '203.0.113.9',
        },
        body: JSON.stringify({
          email: 'reseller@example.com',
          password: 'bad',
        }),
      }),
    )
  const statuses: number[] = []
  for (let i = 0; i < 7; i++) statuses.push((await attempt()).status)
  expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true)
  expect(statuses.slice(5)).toEqual([429, 429])
})
