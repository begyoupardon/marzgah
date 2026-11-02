import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { tanstackStartCookies } from 'better-auth/tanstack-start'

import { db } from '#/db'
import * as schema from '#/db/schema'

export const auth = betterAuth({
  advanced: {
    disableOriginCheck: false,
    ...(globalThis.navigator?.userAgent === 'Cloudflare-Workers'
      ? { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } }
      : {}),
  },
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
    // Min applies to new/changed passwords only; sign-in of older short ones still works.
    // Max stays generous so existing long credentials keep working, but is bounded for hashing cost.
    minPasswordLength: 12,
    maxPasswordLength: 1024,
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
