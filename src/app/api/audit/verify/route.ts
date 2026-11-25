import { verifyWorldChain } from '@/server/events'
import { json, worldRoute } from '@/server/http'

/** Recomputes every hash in this sandbox's audit trail and reports the first event that doesn't match. */
export const GET = worldRoute(async (_request, { world }) => {
  const started = Date.now()
  const result = await verifyWorldChain(world.id)
  return json({ ...result, tookMs: Date.now() - started })
})
