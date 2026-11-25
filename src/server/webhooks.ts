import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { rows } from './db'
import { applyCollectionStatusTx } from './orders'
import { applyPayoutStatusTx, parseReference } from './payouts'
import { webhookReceipts } from './schema'
import { hmacHex, safeEqual, webhookSecret } from './signing'
import { inWorld } from './uow'
import { getWorld } from './world'

const event = z.object({
  eventId: z.string().min(1).max(120),
  type: z.literal('transaction.updated'),
  occurredAt: z.string(),
  data: z.object({
    transactionId: z.string(),
    type: z.enum(['COLLECTION', 'DISBURSEMENT']),
    status: z.enum(['PENDING_APPROVAL', 'PROCESSING', 'SUCCEEDED', 'FAILED']),
    amount: z.string(),
    reference: z.string(),
    failureReason: z.string().nullable(),
  }),
})

const TOLERANCE_SECONDS = 300

export function verifyWebhookSignature(rawBody: string, header: string | null, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header ?? '')
  if (!m) return false
  const t = Number(m[1])
  if (Math.abs(nowSeconds - t) > TOLERANCE_SECONDS) return false
  return safeEqual(hmacHex(webhookSecret(), `${t}.${rawBody}`), m[2])
}

/**
 * Receives a Zamtel Money callback. Signed, de-duplicated by event id, and applied in the same transaction that
 * records the receipt, so an event is either fully applied once or not at all (and then retried by the provider).
 */
export async function receiveZamtelWebhook(worldId: string, rawBody: string, signatureHeader: string | null): Promise<{ status: number; body: unknown }> {
  if (!verifyWebhookSignature(rawBody, signatureHeader)) return { status: 401, body: { error: 'bad_signature' } }
  let parsed: z.infer<typeof event>
  try {
    parsed = event.parse(JSON.parse(rawBody))
  } catch {
    return { status: 400, body: { error: 'bad_payload' } }
  }
  if (!(await getWorld(worldId))) return { status: 404, body: { error: 'unknown_world' } }

  return inWorld(worldId, async (u) => {
    const inserted = await u.tx
      .insert(webhookReceipts)
      .values({ worldId, provider: 'zamtel', eventId: parsed.eventId, outcome: 'received' })
      .onConflictDoNothing()
      .returning({ eventId: webhookReceipts.eventId })
    if (inserted.length === 0) {
      await rows(u.tx, sql`update webhook_receipts set duplicates = duplicates + 1 where world_id = ${worldId} and provider = 'zamtel' and event_id = ${parsed.eventId}`)
      return { status: 200, body: { ok: true, duplicate: true } }
    }
    const d = parsed.data
    let outcome: string
    if (d.type === 'DISBURSEMENT') {
      const ref = parseReference(d.reference)
      outcome = ref ? await applyPayoutStatusTx(u, ref, d.status, { providerTxnId: d.transactionId, failureReason: d.failureReason, source: 'callback' }) : 'unknown_reference'
    } else {
      outcome = /^[0-9a-f-]{36}$/.test(d.reference)
        ? await applyCollectionStatusTx(u, d.reference, d.status, { providerTxnId: d.transactionId, failureReason: d.failureReason, source: 'callback' })
        : 'unknown_reference'
    }
    await rows(u.tx, sql`update webhook_receipts set outcome = ${outcome} where world_id = ${worldId} and provider = 'zamtel' and event_id = ${parsed.eventId}`)
    return { status: 200, body: { ok: true, outcome } }
  })
}
