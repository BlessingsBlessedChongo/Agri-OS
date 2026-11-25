import { z } from 'zod'
import { simulateCrowd } from '@/server/demo'
import { json, readBody, worldRoute } from '@/server/http'

const input = z.object({ orderId: z.uuid(), depotId: z.uuid(), count: z.number().int().min(1).max(40), exclude: z.array(z.string()).max(20).default([]) })

/** Other farmers at the depot pledging through the USSD engine, so the demo truck has a real load. */
export const POST = worldRoute(async (request, { world }) => {
  const body = await readBody(request, input)
  return json({ pledged: await simulateCrowd(world.id, body) })
})
