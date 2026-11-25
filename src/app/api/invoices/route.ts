import { json, worldRoute } from '@/server/http'
import { listInvoices } from '@/server/invoices'

const KINDS = ['PRODUCE', 'TRANSPORT', 'SERVICE'] as const

export const GET = worldRoute(async (request, { world }) => {
  const params = new URL(request.url).searchParams
  const kind = KINDS.find((k) => k === params.get('kind'))
  const limit = Math.min(200, Number(params.get('limit') ?? 50) || 50)
  return json({ invoices: await listInvoices(world.id, { kind, limit, liveOnly: params.get('live') === '1' }) })
})
