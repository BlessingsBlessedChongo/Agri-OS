import { after, type NextRequest } from 'next/server'
import { words } from '@/ussd/i18n'
import { handleUssd, USSD_CODE } from '@/server/ussd'
import { drain } from '@/server/worker'
import { ensureLiveWorld, getWorld, worldIdFrom } from '@/server/world'

const text = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })

/**
 * USSD callback in Africa's Talking's format (form fields sessionId, serviceCode, phoneNumber, text; reply starts
 * with CON or END). The in-browser phone sends the same request with the sandbox cookie; real traffic from
 * Africa's Talking has no cookie and lands in the live world.
 */
export async function POST(request: NextRequest) {
  let worldId: string | null = null
  try {
    const form = await request.formData()
    const sessionId = String(form.get('sessionId') ?? '')
    const phoneNumber = String(form.get('phoneNumber') ?? '')
    if (!sessionId || !phoneNumber) return text('END Missing sessionId or phoneNumber.', 400)
    const cookieWorld = worldIdFrom(request)
    worldId = cookieWorld && (await getWorld(cookieWorld)) ? cookieWorld : (await ensureLiveWorld()).id
    const reply = await handleUssd(worldId, {
      sessionId,
      serviceCode: String(form.get('serviceCode') ?? USSD_CODE),
      phoneNumber,
      text: String(form.get('text') ?? ''),
    })
    const id = worldId
    after(() => drain({ worldId: id, budgetMs: 1500 }).catch(() => undefined))
    return text(reply)
  } catch (error) {
    console.error('[ussd]', error)
    return text(`END ${words('en').error}`)
  }
}
