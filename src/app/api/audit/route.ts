import { eq } from 'drizzle-orm'
import { db } from '@/server/db'
import { chainHead, eventsPage } from '@/server/events'
import { json, worldRoute } from '@/server/http'
import { worlds } from '@/server/schema'

/** A page of the audit trail, newest first, with each event's hash and link to the one before. */
export const GET = worldRoute(async (request, { world }) => {
  const before = Number(new URL(request.url).searchParams.get('before') ?? 0) || null
  const [page, head, [row]] = await Promise.all([eventsPage(world.id, before, 60), chainHead(db, world.id), db.select({ tamper: worlds.tamper }).from(worlds).where(eq(worlds.id, world.id))])
  return json({ events: page, head, tampered: row?.tamper ? { seq: row.tamper.seq, field: row.tamper.field } : null })
})
