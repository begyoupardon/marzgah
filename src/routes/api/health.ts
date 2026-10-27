import { createFileRoute } from '@tanstack/react-router'
import { sql } from 'drizzle-orm'

import { db } from '#/db'

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async () => {
        try {
          await db.run(sql`select 1`)
          return Response.json({ ok: true })
        } catch {
          return Response.json({ ok: false }, { status: 503 })
        }
      },
    },
  },
})
