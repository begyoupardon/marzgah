import { call } from '@orpc/server'
import { mock } from 'bun:test'

import { mockDb } from './db'

/**
 * Real middleware + real in-memory DB; only the session lookup is faked.
 * The caller is identified by the `x-test-user` header.
 */
export async function setupRouterTest() {
  const db = await mockDb()
  mock.module('#/lib/auth', () => ({
    auth: {
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          const id = headers.get('x-test-user')
          return id
            ? { user: { id, name: id, email: `${id}@t.test` }, session: {} }
            : null
        },
      },
    },
  }))
  return db
}

export function callAs(
  procedure: any,
  input: unknown,
  userId: string | null,
  extraHeaders: Record<string, string> = {},
) {
  const headers = new Headers(extraHeaders)
  if (userId) headers.set('x-test-user', userId)
  return call(procedure, input, { context: { headers } })
}
