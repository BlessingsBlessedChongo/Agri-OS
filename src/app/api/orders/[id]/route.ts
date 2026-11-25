import { notFound } from '@/server/errors'
import { json, worldRoute } from '@/server/http'
import { orderDetail } from '@/server/orders'

export const GET = worldRoute<{ id: string }>(async (_request, { params, world }) => {
  const detail = await orderDetail(world.id, params.id)
  if (!detail) throw notFound('Order')
  return json(detail)
})
