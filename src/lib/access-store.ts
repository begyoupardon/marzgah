import { eq } from 'drizzle-orm'
import { db } from '#/db'
import { accessAssignments } from '#/db/schema'

/** Lightweight lookup shared with mirror reads; no dependency on application/recovery services. */
export async function getAssignment(vpnUserId: string) {
  const [row] = await db
    .select()
    .from(accessAssignments)
    .where(eq(accessAssignments.vpnUserId, vpnUserId))
    .limit(1)
  return row ?? null
}
