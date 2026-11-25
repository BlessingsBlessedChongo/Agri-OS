import { normalizeMsisdn } from '@/domain/ids'
import { parseKwacha, toDecimalString, type Ngwee } from '@/domain/money'
import { config } from '@/server/config'
import { hmacHex, webhookSecret } from '@/server/signing'
import { ProviderNetworkError, ProviderTimeoutError, parseJson, send } from '../transport'
import { getSimTxn, publicTxn } from './simulator'

/**
 * Agri-OS's side of the Zamtel Money integration. Every call returns one of three outcomes, because with payments
 * "it failed" and "we don't know" must never be confused:
 *   accepted — the provider has the request (it may still be processing)
 *   rejected — the provider refused it; no money moved; safe to treat as failed
 *   unknown  — timeout, 5xx or network error; money MAY move. Retry only with the same idempotency key, or ask.
 */
export type ProviderStatus = 'PENDING_APPROVAL' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED'

export interface ProviderTxn {
  transactionId: string
  type: 'COLLECTION' | 'DISBURSEMENT'
  status: ProviderStatus
  amountNgwee: Ngwee
  reference: string
  failureReason: string | null
}

export type SendOutcome = { kind: 'accepted'; txn: ProviderTxn } | { kind: 'rejected'; httpStatus: number; message: string } | { kind: 'unknown'; reason: string }

export class ProviderUnavailableError extends Error {}

function base(worldId: string) {
  return `${config.appUrl()}/api/sim/zamtel/${worldId}/v1`
}

export function callbackUrl(worldId: string) {
  return `${config.appUrl()}/api/webhooks/zamtel/${worldId}`
}

function toTxn(body: unknown): ProviderTxn {
  const b = body as Record<string, unknown>
  return {
    transactionId: String(b.transactionId),
    type: b.type as ProviderTxn['type'],
    status: b.status as ProviderStatus,
    amountNgwee: parseKwacha(String(b.amount)),
    reference: String(b.reference),
    failureReason: (b.failureReason as string | null) ?? null,
  }
}

const headers = (extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${config.zamtelApiKey()}`,
  'content-type': 'application/json',
  accept: 'application/json',
  ...extra,
})

async function submit(worldId: string, path: '/collections' | '/disbursements', body: Record<string, unknown>, idempotencyKey: string): Promise<SendOutcome> {
  try {
    const response = await send({ method: 'POST', url: `${base(worldId)}${path}`, headers: headers({ 'idempotency-key': idempotencyKey }), body: JSON.stringify(body) })
    const json = parseJson(response.text) as Record<string, unknown> | null
    if (response.status >= 200 && response.status < 300 && json) return { kind: 'accepted', txn: toTxn(json) }
    if (response.status >= 500 || response.status === 429) return { kind: 'unknown', reason: `Provider answered ${response.status}` }
    return { kind: 'rejected', httpStatus: response.status, message: String(json?.message ?? json?.error ?? `HTTP ${response.status}`) }
  } catch (error) {
    if (error instanceof ProviderTimeoutError || error instanceof ProviderNetworkError) return { kind: 'unknown', reason: error.message }
    throw error
  }
}

async function get(worldId: string, path: string): Promise<{ status: number; json: unknown }> {
  try {
    const response = await send({ method: 'GET', url: `${base(worldId)}${path}`, headers: headers() })
    if (response.status >= 500) throw new ProviderUnavailableError(`Provider answered ${response.status}`)
    return { status: response.status, json: parseJson(response.text) }
  } catch (error) {
    if (error instanceof ProviderTimeoutError || error instanceof ProviderNetworkError) throw new ProviderUnavailableError(error.message)
    throw error
  }
}

export function zamtel(worldId: string) {
  return {
    collect(input: { amountNgwee: Ngwee; msisdn: string; reference: string; description: string; idempotencyKey: string }) {
      return submit(
        worldId,
        '/collections',
        { amount: toDecimalString(input.amountNgwee), currency: 'ZMW', payer: { msisdn: input.msisdn }, reference: input.reference, description: input.description, callbackUrl: callbackUrl(worldId) },
        input.idempotencyKey,
      )
    },
    disburse(input: { amountNgwee: Ngwee; msisdn: string; reference: string; description: string; idempotencyKey: string }) {
      return submit(
        worldId,
        '/disbursements',
        { amount: toDecimalString(input.amountNgwee), currency: 'ZMW', payee: { msisdn: input.msisdn }, reference: input.reference, description: input.description, callbackUrl: callbackUrl(worldId) },
        input.idempotencyKey,
      )
    },
    /** Latest transaction with this reference, or null if the provider never received it. */
    async byReference(reference: string): Promise<ProviderTxn | null> {
      const { status, json } = await get(worldId, `/transactions?reference=${encodeURIComponent(reference)}`)
      if (status !== 200) throw new ProviderUnavailableError(`Provider answered ${status}`)
      const data = ((json as { data?: unknown[] })?.data ?? []).map(toTxn)
      return data[0] ?? null
    },
    async statement(): Promise<{ balanceNgwee: Ngwee; transactions: ProviderTxn[] }> {
      const { status, json } = await get(worldId, '/statement')
      if (status !== 200) throw new ProviderUnavailableError(`Provider answered ${status}`)
      const body = json as { balance: string; transactions: unknown[] }
      return { balanceNgwee: parseKwacha(body.balance), transactions: body.transactions.map(toTxn) }
    },
  }
}

/** Provider side: sends one signed callback for a transaction. Throws if the receiver didn't accept it (retried). */
export async function deliverCallback(worldId: string, payload: { transactionId: string; eventId: string; status: ProviderStatus }): Promise<void> {
  const txn = await getSimTxn(worldId, payload.transactionId)
  if (!txn) return
  const data = { ...publicTxn(txn), status: payload.status, completedAt: payload.status === 'PROCESSING' ? null : (txn.completedAt?.toISOString() ?? null) }
  const body = JSON.stringify({ eventId: payload.eventId, type: 'transaction.updated', occurredAt: new Date().toISOString(), data })
  const t = Math.floor(Date.now() / 1000)
  const signature = `t=${t},v1=${hmacHex(webhookSecret(), `${t}.${body}`)}`
  const response = await send({
    method: 'POST',
    url: txn.callbackUrl,
    headers: { 'content-type': 'application/json', 'x-zamtel-signature': signature, 'user-agent': 'ZamtelMoney-Simulator/1.0' },
    body,
    timeoutMs: 8000,
  })
  if (response.status < 200 || response.status >= 300) throw new Error(`Callback was answered with ${response.status}`)
}

export function isPhone(msisdn: string) {
  return normalizeMsisdn(msisdn) !== null
}
