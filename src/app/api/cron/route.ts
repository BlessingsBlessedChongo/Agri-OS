import { config } from '@/server/config'
import { HttpError } from '@/server/errors'
import { json, route } from '@/server/http'
import { drain } from '@/server/worker'
import { purgeExpired } from '@/server/world'

/** Housekeeping for Vercel Cron or any scheduler: delete expired sandboxes and run overdue background work. */
export const GET = route(async (request) => {
  const secret = config.cronSecret()
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) throw new HttpError(401, 'UNAUTHORIZED', 'Wrong cron secret')
  const purged = await purgeExpired(25)
  const work = await drain({ budgetMs: 8000 })
  return json({ purged, ...work })
})
