import { isCropCode } from '@/domain/produce'
import { badRequest } from '@/server/errors'
import { json, worldRoute } from '@/server/http'
import { priceIndex } from '@/server/zra'

/** Weekly median price per kg for one crop, from accepted invoices. */
export const GET = worldRoute(async (request, { world }) => {
  const crop = new URL(request.url).searchParams.get('crop') ?? 'MAIZE'
  if (!isCropCode(crop)) throw badRequest('crop must be MAIZE, SOYA, GROUNDNUTS or SUNFLOWER')
  return json({ crop, weeks: await priceIndex(world.id, crop) })
})
