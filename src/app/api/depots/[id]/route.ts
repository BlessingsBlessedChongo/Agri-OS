import { depotBoard } from '@/server/deliveries'
import { notFound } from '@/server/errors'
import { json, worldRoute } from '@/server/http'

/** The depot screen: open orders, who pledged to deliver here, and what has been received. */
export const GET = worldRoute<{ id: string }>(async (_request, { params, world }) => {
  const board = await depotBoard(world.id, params.id)
  if (!board) throw notFound('Depot')
  return json(board)
})
