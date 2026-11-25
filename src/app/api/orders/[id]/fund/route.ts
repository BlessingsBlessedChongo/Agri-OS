import { json, worldRoute } from '@/server/http'
import { requestFunding } from '@/server/orders'

/** Asks the buyer's Zamtel Money wallet for the escrow the order still needs (a PIN prompt on their phone). */
export const POST = worldRoute<{ id: string }>(async (_request, { params, world }) => json({ collection: await requestFunding(world.id, params.id) }, { status: 202 }))
