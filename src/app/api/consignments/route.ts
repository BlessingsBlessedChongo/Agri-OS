import { dispatchConsignment, dispatchInput, weighbridgeQueue } from '@/server/consignments'
import { json, readBody, worldRoute } from '@/server/http'

/** Trucks on their way to (or at) a buyer's weighbridge. */
export const GET = worldRoute(async (request, { world }) => {
  const buyerId = new URL(request.url).searchParams.get('buyerId') ?? undefined
  return json({ consignments: await weighbridgeQueue(world.id, buyerId) })
})

/** Loads what a depot has received onto a truck. */
export const POST = worldRoute(async (request, { world }) => {
  const input = await readBody(request, dispatchInput)
  return json({ consignment: await dispatchConsignment(world.id, input) }, { status: 201 })
})
