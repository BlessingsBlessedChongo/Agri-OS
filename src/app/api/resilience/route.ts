import { json, worldRoute } from '@/server/http'
import { reconcile, resilienceReport } from '@/server/reconciliation'

/** Reconciliation against the provider's statement, plus what went wrong outside and how it was handled. */
export const GET = worldRoute(async (_request, { world }) => {
  const [reconciliation, report] = await Promise.all([reconcile(world.id), resilienceReport(world.id)])
  return json({ reconciliation, report, chaos: world.chaos })
})
