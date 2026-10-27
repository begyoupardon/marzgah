import * as p from '@clack/prompts'
import { defineCommand } from 'citty'

import { cancelIfAborted, loadEnvFile } from '../lib.ts'

export default defineCommand({
  meta: { name: 'create-admin', description: 'Create an admin user' },
  args: {
    email: { type: 'string', description: 'Admin email' },
    password: { type: 'string', description: 'Admin password (min 12 chars)' },
    name: { type: 'string', description: 'Display name', default: 'Admin' },
  },
  async run({ args }) {
    loadEnvFile()
    const email =
      args.email ?? cancelIfAborted(await p.text({ message: 'Admin email' }))
    const password =
      args.password ??
      cancelIfAborted(
        await p.password({
          message: 'Admin password (min 12 chars)',
          validate: (v) => ((v ?? '').length < 12 ? 'Too short' : undefined),
        }),
      )
    if (password.length < 12) throw new Error('Password must be 12+ chars')
    const { createCredentialUser } =
      await import('../../src/lib/create-user.ts')
    const created = await createCredentialUser({
      email,
      name: args.name,
      password,
      role: 'admin',
    })
    console.log(`Admin created: ${created.email}`)
  },
})
