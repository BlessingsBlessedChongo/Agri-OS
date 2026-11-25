import { NextResponse, type NextRequest } from 'next/server'
import { handleZamtelRequest } from '@/integrations/zamtel/simulator'
import { sleep } from '@/integrations/transport'
import { random } from '@/server/random'

/**
 * The simulated Zamtel Money API, served over real HTTP so Agri-OS integrates with it exactly as it would with the
 * provider: API key, idempotency keys, asynchronous results and signed callbacks. Chaos settings add real latency.
 */
async function handle(request: NextRequest, context: { params: Promise<{ worldId: string; path: string[] }> }) {
  const { worldId, path } = await context.params
  const segments = path[0] === 'v1' ? path.slice(1) : path
  let body: unknown
  if (request.method === 'POST') body = await request.json().catch(() => undefined)
  try {
    const response = await handleZamtelRequest(
      { worldId, method: request.method, path: `/${segments.join('/')}`, query: new URL(request.url).searchParams, headers: Object.fromEntries(request.headers), body },
      random,
    )
    if (response.delayMs > 0) await sleep(response.delayMs)
    return NextResponse.json(response.body, { status: response.status, headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    console.error('[sim:zamtel]', error)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
