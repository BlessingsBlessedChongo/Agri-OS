import { json, readBody, worldRoute } from '@/server/http'
import { readingInput, submitReading } from '@/server/weighbridge'

/** A signed reading from a plant weighbridge. The second one (empty truck) settles the load. */
export const POST = worldRoute(async (request, { world }) => {
  const input = await readBody(request, readingInput)
  return json(await submitReading(world.id, input))
})
