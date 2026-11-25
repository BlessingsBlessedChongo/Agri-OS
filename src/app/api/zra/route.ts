import { json, worldRoute } from '@/server/http'
import { listInvoices } from '@/server/invoices'
import { listFlags } from '@/server/risk'
import { zraOverview } from '@/server/zra'

/** The tax authority's view: national trade made visible, tax collected, live invoices and explained risk flags. */
export const GET = worldRoute(async (_request, { world }) => {
  const [overview, flags, recent] = await Promise.all([zraOverview(world.id), listFlags(world.id, 30), listInvoices(world.id, { limit: 14 })])
  return json({ overview, flags, recent })
})
