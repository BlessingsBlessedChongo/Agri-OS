import { normalizeMsisdn } from '@/domain/ids'
import { badRequest } from '@/server/errors'
import { json, worldRoute } from '@/server/http'
import { inbox } from '@/server/sms'

/** Text messages sent to one phone in this sandbox (the phone simulator's inbox). */
export const GET = worldRoute(async (request, { world }) => {
  const phone = normalizeMsisdn(new URL(request.url).searchParams.get('phone') ?? '')
  if (!phone) throw badRequest('phone must be a Zambian mobile number')
  return json({ messages: await inbox(world.id, phone) })
})
