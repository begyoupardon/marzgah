import { createAuthClient } from 'better-auth/react'
import { inferAdditionalFields } from 'better-auth/client/plugins'

export const authClient = createAuthClient({
  fetchOptions: { timeout: 20_000 },
  plugins: [
    inferAdditionalFields({
      user: {
        role: {
          type: 'string',
        },
      },
    }),
  ],
})
