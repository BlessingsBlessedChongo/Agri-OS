import { DomainError } from '@/server/errors'
import { json, worldRoute } from '@/server/http'
import { retryFailedPayout } from '@/server/payouts'

/** Operations: try a payout again after it ran out of automatic attempts. The money is still owed and safe. */
export const POST = worldRoute<{ id: string }>(async (_request, { params, world }) => {
  if (!(await retryFailedPayout(world.id, params.id))) throw new DomainError('NOT_FAILED', 'Only a payout that has given up can be retried by hand')
  return json({ ok: true })
})
