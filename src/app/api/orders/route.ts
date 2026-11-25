import { json, readBody, worldRoute } from '@/server/http'
import { createOrder, createOrderInput, listOrders } from '@/server/orders'

export const GET = worldRoute(async (_request, { world }) => json({ orders: await listOrders(world.id) }))

/** A buyer posts demand: crop, grade, quantity, price, collection depots and a delivery date. */
export const POST = worldRoute(async (request, { world }) => {
  const input = await readBody(request, createOrderInput)
  return json({ order: await createOrder(world.id, input) }, { status: 201 })
})
