import * as p from '@clack/prompts'
import { defineCommand } from 'citty'
import { eq } from 'drizzle-orm'

import { cancelIfAborted, loadEnvFile } from '../lib.ts'

export default defineCommand({
  meta: { name: 'reset-password', description: 'Reset a user password' },
  args: {
    email: { type: 'string', description: 'User email' },
    password: { type: 'string', description: 'New password (min 12 chars)' },
  },
  async run({ args }) {
    loadEnvFile()
    const email =
      args.email ?? cancelIfAborted(await p.text({ message: 'User email' }))
    const password =
      args.password ??
      cancelIfAborted(await p.password({ message: 'New password' }))
    if (password.length < 12) throw new Error('Password must be 12+ chars')
    const { db } = await import('../../src/db/index.ts')
    const { user } = await import('../../src/db/schema.ts')
    const { setCredentialPassword } =
      await import('../../src/lib/create-user.ts')
    const [row] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email.trim().toLowerCase()))
      .limit(1)
    if (!row) throw new Error(`No user with email ${email}`)
    await setCredentialPassword(row.id, password)
    console.log('Password updated.')
  },
})
