import { ORPCError, os } from '@orpc/server'
import { eq } from 'drizzle-orm'

import { db } from '#/db'
import { user } from '#/db/schema'
import { auth } from '#/lib/auth'
import { toAppORPCError } from '#/lib/server-errors'

export type AppContext = {
  headers: Headers
}

export const base = os.$context<AppContext>().use(async ({ next }) => {
  try {
    return await next({})
  } catch (error) {
    throw toAppORPCError(error)
  }
})

export const authed = base.use(async ({ context, next }) => {
  const session = await auth.api.getSession({ headers: context.headers })
  if (!session?.user) {
    throw new ORPCError('UNAUTHORIZED', {
      message: 'نشست شما منقضی شده است. دوباره وارد شوید',
    })
  }

  const [row] = await db
    .select({ role: user.role })
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1)

  const role = row?.role === 'admin' ? 'admin' : 'reseller'

  return next({
    context: {
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        role,
      },
      session: session.session,
    },
  })
})

export const adminOnly = authed.use(async ({ context, next }) => {
  if (context.user.role !== 'admin') {
    throw new ORPCError('FORBIDDEN', {
      message: 'فقط مدیر سامانه به این بخش دسترسی دارد',
    })
  }
  return next({})
})
