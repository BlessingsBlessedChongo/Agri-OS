import { json, worldRoute } from '@/server/http'
import { closeOrder } from '@/server/orders'

/** Stops new pledges; once every truck is settled, unused escrow goes back to the buyer. */
export const POST = worldRoute<{ id: string }>(async (_request, { params, world }) => {
  await closeOrder(world.id, params.id)
  return json({ ok: true })
})
