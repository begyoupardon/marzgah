import { eq } from 'drizzle-orm'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'

import { db } from '#/db'
import { user } from '#/db/schema'
import { auth } from '#/lib/auth'

export const getAppSession = createServerFn({ method: 'GET' }).handler(
  async () => {
    const session = await auth.api.getSession({
      headers: getRequestHeaders(),
    })
    if (!session?.user) return null

    // Prefer DB role — Better Auth session payload can omit additionalFields.
    const [row] = await db
      .select({ role: user.role })
      .from(user)
      .where(eq(user.id, session.user.id))
      .limit(1)

    const role = row?.role === 'admin' ? 'admin' : 'reseller'

    return {
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        role: role,
      },
    }
  },
)
