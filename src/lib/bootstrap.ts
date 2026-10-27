import { createServerFn } from '@tanstack/react-start'
import { getEnv } from '#/lib/env'
import * as z from 'zod'

import { countUsers, createCredentialUser } from '#/lib/create-user'

export const getNeedsBootstrap = createServerFn({ method: 'GET' }).handler(
  async () => {
    const total = await countUsers()
    return {
      needsBootstrap: total === 0,
      bootstrapEmail: getEnv().BOOTSTRAP_ADMIN_EMAIL ?? null,
    }
  },
)

export const bootstrapAdmin = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      email: z.email(),
      name: z.string().min(1),
      password: z.string().min(8),
    }),
  )
  .handler(async ({ data }) => {
    const total = await countUsers()
    if (total > 0) {
      throw new Error('Admin already bootstrapped')
    }

    const expected = getEnv().BOOTSTRAP_ADMIN_EMAIL?.toLowerCase()
    if (!expected) {
      throw new Error('BOOTSTRAP_ADMIN_EMAIL is not configured')
    }
    if (data.email.toLowerCase() !== expected) {
      throw new Error('Email must match BOOTSTRAP_ADMIN_EMAIL')
    }

    await createCredentialUser({
      email: data.email,
      name: data.name,
      password: data.password,
      role: 'admin',
    })

    return { ok: true }
  })
