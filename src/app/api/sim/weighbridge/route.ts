import { z } from 'zod'
import { simulateReading } from '@/integrations/weighbridge/device'
import { notFound } from '@/server/errors'
import { json, readBody, route } from '@/server/http'
import { random } from '@/server/random'
import { requireWorld } from '@/server/world'

const input = z.object({ consignmentId: z.uuid(), kind: z.enum(['GROSS', 'TARE']) })

/** The simulated weighbridge device: weighs the truck and signs the reading with its own key. */
export const POST = route(async (request) => {
  const world = await requireWorld(request)
  const { consignmentId, kind } = await readBody(request, input)
  const signed = await simulateReading(world.id, consignmentId, kind, random)
  if (!signed) throw notFound('Truck')
  return json(signed)
})
