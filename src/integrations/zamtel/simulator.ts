import { createHash, randomBytes } from 'node:crypto'
import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { canonicalJson } from '@/domain/chain'
import { normalizeMsisdn } from '@/domain/ids'
import { formatKwacha, parseKwacha, toDecimalString } from '@/domain/money'
import { config } from '@/server/config'
import { db, rows, type Tx } from '@/server/db'
import { enqueue } from '@/server/jobs'
import { buyers, simPrompts, simTransactions, simWallets } from '@/server/schema'
import { getWorld, TRUST_MSISDN, ZRA_MSISDN } from '@/server/world'

/**
 * A stand-in for Zamtel Money's merchant API. It behaves like a real mobile-money provider: requests are
 * asynchronous, customers approve collections with a PIN on their phone, results arrive by signed callback, and
 * every request is idempotent by key. The world's chaos settings make it slow, flaky, duplicated and forgetful.
 */
export interface SimRequest {
  worldId: string
  method: string
  path: string
  query: URLSearchParams
  headers: Record<string, string | undefined>
  body: unknown
}

export interface SimResponse {
  status: number
  body: unknown
  delayMs: number
}

export type SimTxn = typeof simTransactions.$inferSelect
type Rng = () => number

const respond = (status: number, body: unknown, delayMs = 0): SimResponse => ({ status, body, delayMs })

const amountField = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, 'amount must be a decimal string such as "1250.00"')
const party = z.object({ msisdn: z.string().min(3).max(32) })
const requestBody = z.object({
  amount: amountField,
  currency: z.literal('ZMW'),
  reference: z.string().min(1).max(100),
  description: z.string().max(140).default(''),
  callbackUrl: z.url(),
})
const collectionBody = requestBody.extend({ payer: party })
const disbursementBody = requestBody.extend({ payee: party })

export function publicTxn(t: SimTxn) {
  return {
    transactionId: t.id,
    type: t.type,
    status: t.status,
    amount: toDecimalString(t.amountNgwee),
    currency: 'ZMW',
    reference: t.reference,
    failureReason: t.failureReason,
    createdAt: t.createdAt.toISOString(),
    completedAt: t.completedAt?.toISOString() ?? null,
  }
}

function newTxnId(): string {
  return `ZMT${randomBytes(6).toString('hex').toUpperCase()}`
}

function account(msisdn: string): string | null {
  if (msisdn === TRUST_MSISDN || msisdn === ZRA_MSISDN) return msisdn
  return normalizeMsisdn(msisdn)
}

/** New wallets: buyers' merchant wallets start funded; everyone else starts with pocket money. */
async function ensureWallet(tx: Tx, worldId: string, msisdn: string) {
  const [buyer] = await tx.select({ name: buyers.name }).from(buyers).where(eq(buyers.phone, msisdn)).limit(1)
  await tx
    .insert(simWallets)
    .values({ worldId, msisdn, name: buyer?.name ?? msisdn, kind: buyer ? 'MERCHANT' : 'CUSTOMER', balanceNgwee: buyer ? 500_000_000 : 15_000 })
    .onConflictDoNothing()
}

export async function handleZamtelRequest(request: SimRequest, rng: Rng = Math.random): Promise<SimResponse> {
  const world = await getWorld(request.worldId)
  if (!world) return respond(404, { error: 'unknown_merchant', message: 'No such merchant account' })
  const chaos = world.chaos
  const latency = Math.round(chaos.latencyMs * (0.5 + rng()))
  const segments = request.path.split('/').filter(Boolean)

  // The customer's phone (approving a PIN prompt) is not part of the merchant API and is never flaky.
  if (segments[0] === 'customer') return handleCustomer(request, segments, rng)

  if (request.headers.authorization !== `Bearer ${config.zamtelApiKey()}`) {
    return respond(401, { error: 'unauthorized', message: 'Missing or wrong API key' }, latency)
  }

  if (request.method === 'POST') {
    if (rng() < chaos.errorRate) return respond(503, { error: 'service_unavailable', message: 'Temporarily unavailable; retry with the same Idempotency-Key' }, latency)
    const key = request.headers['idempotency-key']
    if (!key) return respond(400, { error: 'idempotency_key_required', message: 'Send an Idempotency-Key header' }, latency)
    const type = segments[0] === 'collections' ? 'COLLECTION' : segments[0] === 'disbursements' ? 'DISBURSEMENT' : null
    if (!type || segments.length !== 1) return respond(404, { error: 'not_found' }, latency)
    const result = await createTransaction(request.worldId, type, request.body, key, rng)
    // Processed, but the answer arrives after the caller has given up: the caller can't know whether it worked.
    const late = result.status < 300 && rng() < chaos.timeoutRate
    return { ...result, delayMs: late ? config.providerTimeoutMs() + 800 : latency }
  }

  if (request.method === 'GET') {
    if (segments[0] === 'transactions' && segments[1]) {
      const [txn] = await db.select().from(simTransactions).where(and(eq(simTransactions.worldId, request.worldId), eq(simTransactions.id, segments[1])))
      return txn ? respond(200, publicTxn(txn), latency) : respond(404, { error: 'not_found' }, latency)
    }
    if (segments[0] === 'transactions') {
      const reference = request.query.get('reference')
      if (!reference) return respond(400, { error: 'reference_required' }, latency)
      const found = await db
        .select()
        .from(simTransactions)
        .where(and(eq(simTransactions.worldId, request.worldId), eq(simTransactions.reference, reference)))
        .orderBy(desc(simTransactions.createdAt))
      return respond(200, { data: found.map(publicTxn) }, latency)
    }
    if (segments[0] === 'statement') {
      const [wallet] = await db.select().from(simWallets).where(and(eq(simWallets.worldId, request.worldId), eq(simWallets.msisdn, TRUST_MSISDN)))
      const txns = await db.select().from(simTransactions).where(eq(simTransactions.worldId, request.worldId)).orderBy(desc(simTransactions.createdAt))
      return respond(200, { balance: toDecimalString(wallet?.balanceNgwee ?? 0), currency: 'ZMW', transactions: txns.map(publicTxn) }, latency)
    }
  }
  return respond(404, { error: 'not_found' }, latency)
}

async function createTransaction(worldId: string, type: 'COLLECTION' | 'DISBURSEMENT', raw: unknown, clientKey: string, rng: Rng): Promise<SimResponse> {
  const parsed = (type === 'COLLECTION' ? collectionBody : disbursementBody).safeParse(raw)
  if (!parsed.success) return respond(422, { error: 'invalid_request', message: parsed.error.issues[0]?.message ?? 'Invalid request' })
  const body = parsed.data
  const counterparty = account('payer' in body ? (body as z.infer<typeof collectionBody>).payer.msisdn : (body as z.infer<typeof disbursementBody>).payee.msisdn)
  if (!counterparty) return respond(422, { error: 'invalid_msisdn', message: 'Not a valid Zambian mobile number' })
  const amount = parseKwacha(body.amount)
  if (amount <= 0) return respond(422, { error: 'invalid_amount', message: 'Amount must be positive' })
  const requestHash = createHash('sha256').update(canonicalJson({ type, amount, counterparty, reference: body.reference })).digest('hex')

  const replay = async (): Promise<SimResponse | null> => {
    const [existing] = await db.select().from(simTransactions).where(and(eq(simTransactions.worldId, worldId), eq(simTransactions.clientKey, clientKey)))
    if (!existing) return null
    if (existing.requestHash !== requestHash) return respond(422, { error: 'idempotency_key_reused', message: 'This Idempotency-Key was used for a different request' })
    return respond(200, { ...publicTxn(existing), idempotentReplay: true })
  }
  const earlier = await replay()
  if (earlier) return earlier

  try {
    const txn = await db.transaction(async (tx) => {
      const id = newTxnId()
      const [created] = await tx
        .insert(simTransactions)
        .values({
          id,
          worldId,
          type,
          amountNgwee: amount,
          fromMsisdn: type === 'COLLECTION' ? counterparty : TRUST_MSISDN,
          toMsisdn: type === 'COLLECTION' ? TRUST_MSISDN : counterparty,
          reference: body.reference,
          description: body.description,
          clientKey,
          requestHash,
          status: type === 'COLLECTION' ? 'PENDING_APPROVAL' : 'PROCESSING',
          callbackUrl: body.callbackUrl,
        })
        .returning()
      if (type === 'COLLECTION') {
        await ensureWallet(tx, worldId, counterparty)
        await tx.insert(simPrompts).values({
          worldId,
          transactionId: id,
          msisdn: counterparty,
          message: `Pay ${formatKwacha(amount)} to Agri-OS Escrow${body.description ? ` for ${body.description}` : ''}?`,
        })
        await enqueue(tx, worldId, 'sim.expire_prompt', { transactionId: id }, { delayMs: 180_000, dedupeKey: `expire:${id}` })
      } else {
        await enqueue(tx, worldId, 'sim.process', { transactionId: id }, { delayMs: 300 + Math.round(rng() * 700) })
      }
      return created
    })
    return respond(202, publicTxn(txn))
  } catch (error) {
    // Two identical requests raced; the other one won. Answer exactly as if this were the replay.
    const again = await replay()
    if (again) return again
    throw error
  }
}

/** Runs a queued disbursement: moves the money (or fails) and schedules the callbacks. */
export async function processDisbursement(worldId: string, transactionId: string, rng: Rng = Math.random): Promise<void> {
  const world = await getWorld(worldId)
  if (!world) return
  await db.transaction(async (tx) => {
    const [txn] = await rows<SimTxn>(tx, sql`select id, status, amount_ngwee as "amountNgwee", to_msisdn as "toMsisdn" from sim_transactions where id = ${transactionId} and world_id = ${worldId} for update`)
    if (!txn || txn.status !== 'PROCESSING') return
    let failure: string | null = null
    if (rng() < world.chaos.failureRate) {
      failure = ['Recipient wallet limit reached', 'Mobile network switch timed out', 'Recipient account temporarily locked'][Math.floor(rng() * 3)]
    } else {
      const debited = await rows<{ msisdn: string }>(
        tx,
        sql`update sim_wallets set balance_ngwee = balance_ngwee - ${txn.amountNgwee}
            where world_id = ${worldId} and msisdn = ${TRUST_MSISDN} and balance_ngwee >= ${txn.amountNgwee} returning msisdn`,
      )
      if (debited.length === 0) {
        failure = 'Insufficient funds in the merchant wallet'
      } else {
        await ensureWallet(tx, worldId, txn.toMsisdn)
        await tx.execute(sql`update sim_wallets set balance_ngwee = balance_ngwee + ${txn.amountNgwee} where world_id = ${worldId} and msisdn = ${txn.toMsisdn}`)
      }
    }
    await tx
      .update(simTransactions)
      .set({ status: failure ? 'FAILED' : 'SUCCEEDED', failureReason: failure, completedAt: new Date() })
      .where(eq(simTransactions.id, transactionId))
    await scheduleCallbacks(tx, worldId, transactionId, failure ? 'FAILED' : 'SUCCEEDED', world.chaos, rng)
  })
}

/** Real providers lose, repeat and reorder callbacks. So does this one, as much as the chaos settings say. */
async function scheduleCallbacks(
  tx: Tx,
  worldId: string,
  transactionId: string,
  status: 'SUCCEEDED' | 'FAILED',
  chaos: { lostCallbackRate: number; duplicateCallbackRate: number; outOfOrderRate: number; callbackDelayMs: number },
  rng: Rng,
) {
  if (rng() < chaos.lostCallbackRate) return
  const base = chaos.callbackDelayMs
  await enqueue(tx, worldId, 'sim.callback', { transactionId, eventId: `${transactionId}.${status.toLowerCase()}`, status }, { delayMs: base + rng() * 400 })
  if (rng() < chaos.duplicateCallbackRate) {
    await enqueue(tx, worldId, 'sim.callback', { transactionId, eventId: `${transactionId}.${status.toLowerCase()}`, status }, { delayMs: base + 500 + rng() * 800 })
  }
  if (rng() < chaos.outOfOrderRate) {
    await enqueue(tx, worldId, 'sim.callback', { transactionId, eventId: `${transactionId}.processing`, status: 'PROCESSING' }, { delayMs: base + 1200 + rng() * 800 })
  }
}

async function handleCustomer(request: SimRequest, segments: string[], rng: Rng): Promise<SimResponse> {
  const worldId = request.worldId
  // GET /customer/prompts?msisdn=…
  if (request.method === 'GET' && segments[1] === 'prompts') {
    const msisdn = account(request.query.get('msisdn') ?? '')
    if (!msisdn) return respond(400, { error: 'msisdn_required' })
    const prompts = await db
      .select()
      .from(simPrompts)
      .where(and(eq(simPrompts.worldId, worldId), eq(simPrompts.msisdn, msisdn), eq(simPrompts.status, 'OPEN')))
      .orderBy(desc(simPrompts.createdAt))
    const [wallet] = await db.select().from(simWallets).where(and(eq(simWallets.worldId, worldId), eq(simWallets.msisdn, msisdn)))
    return respond(200, { balance: wallet ? toDecimalString(wallet.balanceNgwee) : null, prompts: prompts.map((p) => ({ id: p.id, message: p.message, createdAt: p.createdAt.toISOString() })) })
  }
  // GET /customer/wallet?msisdn=…
  if (request.method === 'GET' && segments[1] === 'wallet') {
    const msisdn = account(request.query.get('msisdn') ?? '')
    if (!msisdn) return respond(400, { error: 'msisdn_required' })
    const [wallet] = await db.select().from(simWallets).where(and(eq(simWallets.worldId, worldId), eq(simWallets.msisdn, msisdn)))
    return respond(200, { msisdn, balance: toDecimalString(wallet?.balanceNgwee ?? 0) })
  }
  // POST /customer/prompts/:id/(approve|decline)
  if (request.method === 'POST' && segments[1] === 'prompts' && segments[2] && (segments[3] === 'approve' || segments[3] === 'decline')) {
    const pin = (request.body as { pin?: unknown })?.pin
    return answerPrompt(worldId, segments[2], segments[3], typeof pin === 'string' ? pin : '', rng)
  }
  return respond(404, { error: 'not_found' })
}

async function answerPrompt(worldId: string, promptId: string, action: 'approve' | 'decline', pin: string, rng: Rng): Promise<SimResponse> {
  const world = await getWorld(worldId)
  if (!world) return respond(404, { error: 'not_found' })
  return db.transaction(async (tx) => {
    const [prompt] = await rows<typeof simPrompts.$inferSelect>(
      tx,
      sql`select id, status, transaction_id as "transactionId", msisdn, wrong_pins as "wrongPins" from sim_prompts where id = ${promptId} and world_id = ${worldId} for update`,
    )
    if (!prompt) return respond(404, { error: 'not_found' })
    if (prompt.status !== 'OPEN') return respond(409, { error: 'prompt_closed', message: 'This request was already answered or has expired' })
    const [txn] = await rows<SimTxn>(tx, sql`select id, status, amount_ngwee as "amountNgwee", from_msisdn as "fromMsisdn" from sim_transactions where id = ${prompt.transactionId} for update`)
    // Once answered, the prompt can no longer lapse.
    const cancelExpiry = () => tx.execute(sql`update jobs set done_at = now() where world_id = ${worldId} and dedupe_key = ${`expire:${txn.id}`} and done_at is null`)
    const fail = async (reason: string, promptStatus: 'DECLINED' | 'EXPIRED') => {
      await cancelExpiry()
      await tx.update(simPrompts).set({ status: promptStatus, answeredAt: new Date() }).where(eq(simPrompts.id, prompt.id))
      await tx.update(simTransactions).set({ status: 'FAILED', failureReason: reason, completedAt: new Date() }).where(eq(simTransactions.id, txn.id))
      await scheduleCallbacks(tx, worldId, txn.id, 'FAILED', world.chaos, rng)
    }
    if (action === 'decline') {
      await fail('Declined by the customer', 'DECLINED')
      return respond(200, { status: 'DECLINED' })
    }
    if (!/^\d{4}$/.test(pin) || pin === '0000') {
      const wrong = prompt.wrongPins + 1
      if (wrong >= 3) {
        await fail('Too many wrong PINs', 'DECLINED')
        return respond(403, { error: 'pin_locked', message: 'Too many wrong PINs; the payment was cancelled' })
      }
      await tx.update(simPrompts).set({ wrongPins: wrong }).where(eq(simPrompts.id, prompt.id))
      return respond(403, { error: 'wrong_pin', message: `Wrong PIN. ${3 - wrong} ${3 - wrong === 1 ? 'try' : 'tries'} left.` })
    }
    const debited = await rows<{ msisdn: string }>(
      tx,
      sql`update sim_wallets set balance_ngwee = balance_ngwee - ${txn.amountNgwee}
          where world_id = ${worldId} and msisdn = ${txn.fromMsisdn} and balance_ngwee >= ${txn.amountNgwee} returning msisdn`,
    )
    if (debited.length === 0) {
      await fail('Insufficient balance', 'DECLINED')
      return respond(402, { error: 'insufficient_balance', message: 'Not enough money in the wallet' })
    }
    await tx.execute(sql`update sim_wallets set balance_ngwee = balance_ngwee + ${txn.amountNgwee} where world_id = ${worldId} and msisdn = ${TRUST_MSISDN}`)
    await tx.update(simTransactions).set({ status: 'SUCCEEDED', completedAt: new Date() }).where(eq(simTransactions.id, txn.id))
    await tx.update(simPrompts).set({ status: 'APPROVED', answeredAt: new Date() }).where(eq(simPrompts.id, prompt.id))
    await cancelExpiry()
    await scheduleCallbacks(tx, worldId, txn.id, 'SUCCEEDED', world.chaos, rng)
    return respond(200, { status: 'APPROVED' })
  })
}

/** Unanswered payment prompts lapse, like they do on a real phone. */
export async function expirePrompt(worldId: string, transactionId: string, rng: Rng = Math.random): Promise<void> {
  const world = await getWorld(worldId)
  if (!world) return
  await db.transaction(async (tx) => {
    const [prompt] = await rows<{ id: string; status: string }>(tx, sql`select id, status from sim_prompts where transaction_id = ${transactionId} and world_id = ${worldId} for update`)
    if (!prompt || prompt.status !== 'OPEN') return
    await tx.update(simPrompts).set({ status: 'EXPIRED', answeredAt: new Date() }).where(eq(simPrompts.id, prompt.id))
    await tx.update(simTransactions).set({ status: 'FAILED', failureReason: 'The customer did not answer in time', completedAt: new Date() }).where(eq(simTransactions.id, transactionId))
    await scheduleCallbacks(tx, worldId, transactionId, 'FAILED', world.chaos, rng)
  })
}

export async function getSimTxn(worldId: string, id: string): Promise<SimTxn | null> {
  const [txn] = await db.select().from(simTransactions).where(and(eq(simTransactions.worldId, worldId), eq(simTransactions.id, id)))
  return txn ?? null
}

export async function trustBalance(worldId: string): Promise<number> {
  const [wallet] = await db.select({ balance: simWallets.balanceNgwee }).from(simWallets).where(and(eq(simWallets.worldId, worldId), eq(simWallets.msisdn, TRUST_MSISDN)))
  return wallet?.balance ?? 0
}
