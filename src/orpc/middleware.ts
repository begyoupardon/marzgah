import { ORPCError, os } from '@orpc/server'
import { eq } from 'drizzle-orm'

import { db } from '#/db'
import { user } from '#/db/schema'
import { auth } from '#/lib/auth'
import { clientIp } from '#/lib/rate-limit'
import {
  logProcedureEvent,
  markAsLogged,
  toAppORPCError,
} from '#/lib/server-errors'

export type AppContext = {
  headers: Headers
}

export type ProcedureState = {
  user?: { id: string; email: string; role: string } | null
}

export const base = os
  .$context<AppContext>()
  .use(async ({ next, path, context }) => {
    const procedure = path?.length ? path.join('.') : 'anonymous'
    const state: ProcedureState = { user: null }
    const start = performance.now()

    try {
      const result = await next({
        context: { state },
      })

      const durationMs = Math.round(performance.now() - start)
      logProcedureEvent({
        procedure,
        status: 200,
        durationMs,
        user: state.user ? `${state.user.email} (${state.user.role})` : null,
        ip: clientIp(context.headers),
      })

      return result
    } catch (rawError) {
      const durationMs = Math.round(performance.now() - start)
      const error = toAppORPCError(rawError)
      markAsLogged(error)

      logProcedureEvent({
        procedure,
        status: error.status,
        code: error.code,
        durationMs,
        user: state.user ? `${state.user.email} (${state.user.role})` : null,
        ip: clientIp(context.headers),
        message: error.message,
        error: error.cause ?? error,
      })

      throw error
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
  const currentUser = {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    role,
  }

  if ('state' in context && context.state) {
    ;(context.state as ProcedureState).user = currentUser
  }

  return next({
    context: {
      user: currentUser,
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
