import { NextResponse, type NextRequest } from 'next/server'
import { handleVsdcRequest } from '@/integrations/vsdc/simulator'
import { sleep } from '@/integrations/transport'
import { random } from '@/server/random'

/** The simulated VSDC: receives an invoice, returns a receipt number and signature (or a 503 under chaos). */
export async function POST(request: NextRequest, context: { params: Promise<{ worldId: string; path: string[] }> }) {
  const { worldId, path } = await context.params
  const body = await request.json().catch(() => undefined)
  try {
    const response = await handleVsdcRequest({ worldId, method: 'POST', path: `/${path.join('/')}`, query: new URL(request.url).searchParams, headers: Object.fromEntries(request.headers), body }, random)
    if (response.delayMs > 0) await sleep(response.delayMs)
    return NextResponse.json(response.body, { status: response.status, headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    console.error('[sim:vsdc]', error)
    return NextResponse.json({ resultCd: '999', resultMsg: 'Internal error' }, { status: 500 })
  }
}
