import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { tanstackStartCookies } from 'better-auth/tanstack-start'

import { db } from '#/db'
import * as schema from '#/db/schema'

export const auth = betterAuth({
  advanced: { disableOriginCheck: false },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    storage: 'memory',
    customRules: {
      '/sign-in/email': { window: 60, max: 5 },
      '/change-password': { window: 300, max: 5 },
    },
  },
  database: drizzleAdapter(db, {
    provider: 'sqlite',
    schema,
  }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 1,
    maxPasswordLength: Number.MAX_SAFE_INTEGER,
  },
  user: {
    additionalFields: {
      role: {
        type: 'string',
        required: false,
        defaultValue: 'reseller',
        input: false,
      },
    },
  },
  plugins: [tanstackStartCookies()],
})

export type SessionUser = {
  id: string
  name: string
  email: string
  role: 'admin' | 'reseller'
}
