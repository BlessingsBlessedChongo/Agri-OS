import { after, NextResponse, type NextRequest } from 'next/server'
import { receiveZamtelWebhook } from '@/server/webhooks'
import { drain } from '@/server/worker'

/** Zamtel Money's callbacks. Signed with HMAC-SHA256 (X-Zamtel-Signature: t=…,v1=…) and de-duplicated by event id. */
export async function POST(request: NextRequest, context: { params: Promise<{ worldId: string }> }) {
  const { worldId } = await context.params
  const raw = await request.text()
  try {
    const result = await receiveZamtelWebhook(worldId, raw, request.headers.get('x-zamtel-signature'))
    if (result.status === 200) after(() => drain({ worldId, budgetMs: 1500 }).catch(() => undefined))
    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    console.error('[webhook:zamtel]', error)
    // A 5xx makes the provider retry later; the receipt was not recorded, so nothing is lost.
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}
