import { and, desc, eq, sql } from 'drizzle-orm'
import { ACCOUNTS, type AccountRef } from '@/domain/accounts'
import { formatKwacha } from '@/domain/money'
import { payoutStuck } from '@/domain/risk'
import { zamtel, type ProviderStatus } from '@/integrations/zamtel/client'
import { db, rows } from './db'
import { enqueue } from './jobs'
import { post } from './ledger'
import { getFarmer } from './reference'
import { raiseFlag } from './risk'
import { invoices, payouts, type PayoutKind } from './schema'
import { smsFarmer } from './sms'
import { inWorld, type Uow } from './uow'

/**
 * Payout state machine. The rules that keep money from being lost or sent twice:
 *  1. Before calling the provider, the amount moves from "owed" to "in flight" in the ledger (status SENT).
 *  2. A timeout or 5xx is UNKNOWN, never FAILED: we retry with the SAME idempotency key or ask the provider.
 *  3. Only a definitive failure moves the money back to "owed" and starts a new attempt with a NEW key.
 *  4. Callbacks are matched to the attempt; anything for an older attempt, or after the end, is ignored.
 */
export const MAX_ATTEMPTS = 3
type Payout = typeof payouts.$inferSelect

function payableAccount(p: Payout): AccountRef {
  const type = p.kind === 'TAX' ? ACCOUNTS.zra : { code: p.accountCode, type: 'LIABILITY' as const, name: `Owed to ${p.partyName}` }
  return type
}

const keyFor = (p: Pick<Payout, 'id' | 'attempt'>) => `payout:${p.id}:${p.attempt}`
const referenceFor = (p: Pick<Payout, 'id' | 'attempt'>) => `${p.id}:${p.attempt}`

export function parseReference(reference: string): { payoutId: string; attempt: number } | null {
  const m = /^([0-9a-f-]{36}):(\d+)$/.exec(reference)
  return m ? { payoutId: m[1], attempt: Number(m[2]) } : null
}

async function lockPayout(u: Uow, payoutId: string): Promise<Payout | null> {
  const [locked] = await rows<{ id: string }>(u.tx, sql`select id from payouts where id = ${payoutId} and world_id = ${u.worldId} for update`)
  if (!locked) return null
  const [p] = await u.tx.select().from(payouts).where(eq(payouts.id, payoutId))
  return p
}

function description(kind: PayoutKind) {
  return kind === 'FARMER' ? 'Agri-OS produce payment' : kind === 'TRANSPORTER' ? 'Agri-OS haulage payment' : kind === 'TAX' ? 'Agri-OS tax remittance' : 'Agri-OS escrow refund'
}

/** Job: send (or re-send) a payout to the provider. */
export async function dispatchPayout(worldId: string, payoutId: string): Promise<void> {
  const claimed = await inWorld(worldId, async (u) => {
    const p = await lockPayout(u, payoutId)
    if (!p) return null
    if (p.status === 'UNKNOWN') return p // re-send with the same key: the provider de-duplicates it
    if (p.status !== 'QUEUED' && p.status !== 'RETRY_WAIT') return null
    await post(u.tx, worldId, {
      kind: 'payout.sent',
      memo: `${formatKwacha(p.amountNgwee)} to ${p.partyName} sent to Zamtel Money (attempt ${p.attempt})`,
      idempotencyKey: `${keyFor(p)}:sent`,
      refType: 'payout',
      refId: p.id,
      postings: [
        { account: payableAccount(p), amount: p.amountNgwee },
        { account: ACCOUNTS.clearing, amount: -p.amountNgwee },
      ],
    })
    await u.tx.update(payouts).set({ status: 'SENT', updatedAt: new Date() }).where(eq(payouts.id, p.id))
    await enqueue(u.tx, worldId, 'payout.check', { payoutId: p.id, attempt: p.attempt }, { delayMs: 15_000, dedupeKey: `payout-check:${p.id}:${p.attempt}`, maxAttempts: 40 })
    u.emit({ type: 'payout.sent', entityType: 'payout', entityId: p.id, actor: 'system', payload: { kind: p.kind, party: p.partyName, amountNgwee: p.amountNgwee, attempt: p.attempt } })
    return { ...p, status: 'SENT' as const }
  })
  if (!claimed) return

  const outcome = await zamtel(worldId).disburse({
    amountNgwee: claimed.amountNgwee,
    msisdn: claimed.msisdn,
    reference: referenceFor(claimed),
    description: description(claimed.kind),
    idempotencyKey: keyFor(claimed),
  })
  if (outcome.kind === 'accepted') {
    await db
      .update(payouts)
      .set({ providerTxnId: outcome.txn.transactionId, updatedAt: new Date() })
      .where(and(eq(payouts.id, claimed.id), eq(payouts.attempt, claimed.attempt)))
    if (outcome.txn.status === 'SUCCEEDED' || outcome.txn.status === 'FAILED' || outcome.txn.status === 'PROCESSING') {
      await applyPayoutStatus(worldId, { payoutId: claimed.id, attempt: claimed.attempt }, outcome.txn.status, { providerTxnId: outcome.txn.transactionId, failureReason: outcome.txn.failureReason, source: 'response' })
    }
    return
  }
  if (outcome.kind === 'rejected') {
    await applyPayoutStatus(worldId, { payoutId: claimed.id, attempt: claimed.attempt }, 'FAILED', { failureReason: outcome.message, source: 'response' })
    return
  }
  await inWorld(worldId, async (u) => {
    const p = await lockPayout(u, claimed.id)
    if (!p || p.attempt !== claimed.attempt || (p.status !== 'SENT' && p.status !== 'UNKNOWN')) return
    await u.tx.update(payouts).set({ status: 'UNKNOWN', lastError: outcome.reason, updatedAt: new Date() }).where(eq(payouts.id, p.id))
    await enqueue(u.tx, worldId, 'payout.check', { payoutId: p.id, attempt: p.attempt }, { delayMs: 2500, maxAttempts: 40 })
    u.emit({ type: 'payout.unknown', entityType: 'payout', entityId: p.id, actor: 'system', payload: { party: p.partyName, amountNgwee: p.amountNgwee, attempt: p.attempt, reason: outcome.reason } })
  })
}

/** Job: ask the provider what happened when no confirmation has arrived. */
export async function checkPayout(worldId: string, payoutId: string, attempt: number): Promise<void | { again: number }> {
  const [p] = await db.select().from(payouts).where(and(eq(payouts.id, payoutId), eq(payouts.worldId, worldId)))
  if (!p || p.attempt !== attempt || (p.status !== 'SENT' && p.status !== 'UNKNOWN')) return
  const txn = await zamtel(worldId).byReference(referenceFor(p))
  if (!txn) {
    if (p.status === 'SENT' && Date.now() - p.updatedAt.getTime() < 10_000) return { again: 4000 }
    // The request never reached the provider. Re-sending with the same key is safe. Keep checking until it settles:
    // while a payout is in flight there must always be a check scheduled, or a lost callback would strand it.
    await db.update(payouts).set({ status: 'UNKNOWN', updatedAt: new Date() }).where(and(eq(payouts.id, p.id), eq(payouts.attempt, attempt)))
    await dispatchPayout(worldId, p.id)
    return { again: 3000 }
  }
  if (txn.status === 'SUCCEEDED' || txn.status === 'FAILED') {
    await applyPayoutStatus(worldId, { payoutId, attempt }, txn.status, { providerTxnId: txn.transactionId, failureReason: txn.failureReason, source: 'poll' })
    return
  }
  return { again: 3000 }
}

export async function applyPayoutStatus(
  worldId: string,
  ref: { payoutId: string; attempt: number },
  status: ProviderStatus,
  info: { providerTxnId?: string; failureReason?: string | null; source: 'callback' | 'poll' | 'response' },
) {
  return inWorld(worldId, (u) => applyPayoutStatusTx(u, ref, status, info))
}

export async function applyPayoutStatusTx(
  u: Uow,
  ref: { payoutId: string; attempt: number },
  status: ProviderStatus,
  info: { providerTxnId?: string; failureReason?: string | null; source: 'callback' | 'poll' | 'response' },
): Promise<'applied' | 'ignored' | 'stale'> {
  const p = await lockPayout(u, ref.payoutId)
  if (!p) return 'ignored'
  if (ref.attempt !== p.attempt) return 'stale'
  const now = new Date()

  if (status === 'PROCESSING' || status === 'PENDING_APPROVAL') {
    if (p.status !== 'UNKNOWN') return 'ignored'
    await u.tx.update(payouts).set({ status: 'SENT', providerTxnId: info.providerTxnId ?? p.providerTxnId, updatedAt: now }).where(eq(payouts.id, p.id))
    return 'applied'
  }
  if (p.status === 'SUCCEEDED' || p.status === 'FAILED' || p.status === 'RETRY_WAIT') return 'ignored'
  if (p.status !== 'SENT' && p.status !== 'UNKNOWN') return 'ignored'

  if (status === 'SUCCEEDED') {
    await post(u.tx, u.worldId, {
      kind: 'payout.succeeded',
      memo: `${formatKwacha(p.amountNgwee)} reached ${p.partyName}`,
      idempotencyKey: `${keyFor(p)}:succeeded`,
      refType: 'payout',
      refId: p.id,
      postings: [
        { account: ACCOUNTS.clearing, amount: p.amountNgwee },
        { account: ACCOUNTS.trust, amount: -p.amountNgwee },
      ],
    })
    await u.tx.update(payouts).set({ status: 'SUCCEEDED', providerTxnId: info.providerTxnId ?? p.providerTxnId, succeededAt: now, updatedAt: now, lastError: null }).where(eq(payouts.id, p.id))
    if (p.kind === 'FARMER') {
      const farmer = await getFarmer(u.tx, u.worldId, p.partyId)
      const [inv] = await u.tx
        .select({ number: invoices.number })
        .from(invoices)
        .where(and(eq(invoices.settlementId, p.settlementId!), eq(invoices.sellerId, p.partyId)))
        .orderBy(desc(invoices.number))
        .limit(1)
      if (farmer) await smsFarmer(u, farmer, 'payout.paid', (w) => w.sms.paid(formatKwacha(p.amountNgwee), info.providerTxnId ?? p.providerTxnId ?? '', inv?.number ?? ''))
    }
    u.emit({ type: 'payout.succeeded', entityType: 'payout', entityId: p.id, actor: 'zamtel', payload: { kind: p.kind, party: p.partyName, amountNgwee: p.amountNgwee, attempt: p.attempt, source: info.source, providerTxnId: info.providerTxnId ?? p.providerTxnId } })
    return 'applied'
  }

  // FAILED: the money never left. Put it back to "owed" and decide whether to try again with a new key.
  await post(u.tx, u.worldId, {
    kind: 'payout.failed',
    memo: `${formatKwacha(p.amountNgwee)} to ${p.partyName} failed (attempt ${p.attempt}): ${info.failureReason ?? 'unknown reason'}`,
    idempotencyKey: `${keyFor(p)}:failed`,
    refType: 'payout',
    refId: p.id,
    postings: [
      { account: ACCOUNTS.clearing, amount: p.amountNgwee },
      { account: payableAccount(p), amount: -p.amountNgwee },
    ],
  })
  if (p.attempt < MAX_ATTEMPTS) {
    await u.tx.update(payouts).set({ status: 'RETRY_WAIT', attempt: p.attempt + 1, lastError: info.failureReason ?? 'Failed', providerTxnId: null, updatedAt: now }).where(eq(payouts.id, p.id))
    await enqueue(u.tx, u.worldId, 'payout.dispatch', { payoutId: p.id }, { delayMs: 1500 * p.attempt })
    u.emit({ type: 'payout.retrying', entityType: 'payout', entityId: p.id, actor: 'system', payload: { party: p.partyName, amountNgwee: p.amountNgwee, failedAttempt: p.attempt, reason: info.failureReason ?? 'Failed', source: info.source } })
  } else {
    await u.tx.update(payouts).set({ status: 'FAILED', lastError: info.failureReason ?? 'Failed', updatedAt: now }).where(eq(payouts.id, p.id))
    await raiseFlag(u, payoutStuck({ payoutId: p.id, partyName: p.partyName, amount: p.amountNgwee, attempts: p.attempt, lastError: info.failureReason ?? null }))
    u.emit({ type: 'payout.failed', entityType: 'payout', entityId: p.id, actor: 'system', payload: { party: p.partyName, amountNgwee: p.amountNgwee, attempts: p.attempt, reason: info.failureReason ?? 'Failed' } })
  }
  return 'applied'
}

/** Manual retry for a payout that ran out of attempts (operations button). The money is still owed, so start again. */
export async function retryFailedPayout(worldId: string, payoutId: string) {
  return inWorld(worldId, async (u) => {
    const p = await lockPayout(u, payoutId)
    if (!p || p.status !== 'FAILED') return false
    await u.tx.update(payouts).set({ status: 'RETRY_WAIT', attempt: p.attempt + 1, updatedAt: new Date() }).where(eq(payouts.id, p.id))
    await enqueue(u.tx, worldId, 'payout.dispatch', { payoutId: p.id })
    u.emit({ type: 'payout.retrying', entityType: 'payout', entityId: p.id, actor: 'operator', payload: { party: p.partyName, amountNgwee: p.amountNgwee, manual: true } })
    return true
  })
}

export async function payoutsOfParty(worldId: string, partyId: string) {
  return db.select().from(payouts).where(and(eq(payouts.worldId, worldId), eq(payouts.partyId, partyId))).orderBy(desc(payouts.createdAt)).limit(10)
}
