import { db } from '@/server/db'
import { chainHead } from '@/server/events'
import { json, route } from '@/server/http'
import { pendingJobs } from '@/server/jobs'
import { drain } from '@/server/worker'
import { requireWorld } from '@/server/world'

/**
 * Open pages call this about once a second. It runs the world's due background work (payouts, callbacks, invoices,
 * SMS) and says how far the audit trail has got, so the page knows when to refresh.
 */
export const POST = route(async (request) => {
  const world = await requireWorld(request)
  const result = await drain({ worldId: world.id, budgetMs: 2000 })
  const [pending, head] = await Promise.all([pendingJobs(db, world.id), chainHead(db, world.id)])
  return json({ ...result, pending, seq: head?.seq ?? 0 })
})
