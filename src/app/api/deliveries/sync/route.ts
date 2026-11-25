import { z } from 'zod'
import { deliveryInput, syncDeliveries } from '@/server/deliveries'
import { json, readBody, worldRoute } from '@/server/http'

const syncInput = z.object({ deliveries: z.array(deliveryInput).min(1).max(200) })

/**
 * The depot device's outbox. Every delivery carries an id made on the device, so a record sent twice (after a
 * dropped connection) is recognised, not duplicated. Each record succeeds or is refused on its own.
 */
export const POST = worldRoute(async (request, { world }) => {
  const { deliveries } = await readBody(request, syncInput)
  return json({ results: await syncDeliveries(world.id, deliveries) })
})
