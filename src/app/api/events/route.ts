import { eventsAfter } from '@/server/events'
import { json, route } from '@/server/http'
import { requireWorld } from '@/server/world'

/** Audit-trail events after a sequence number: the live feed every screen updates from. */
export const GET = route(async (request) => {
  const world = await requireWorld(request)
  const params = new URL(request.url).searchParams
  const after = Math.max(0, Number(params.get('after') ?? 0) || 0)
  const limit = Math.min(500, Math.max(1, Number(params.get('limit') ?? 200) || 200))
  return json({ events: await eventsAfter(world.id, after, limit) })
})
