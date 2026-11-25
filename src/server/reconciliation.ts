import { eq, sql } from 'drizzle-orm'
import { zamtel, ProviderUnavailableError } from '@/integrations/zamtel/client'
import { db, rows } from './db'
import { balanceOf, ledgerHealth } from './ledger'
import { pendingJobs } from './jobs'
import { collections, payouts } from './schema'

/**
 * Reconciliation: compares Agri-OS's books with the provider's statement, transaction by transaction.
 * BALANCED — every kwacha matches. SETTLING — the only differences are confirmations still on their way.
 * MISMATCH — something the system cannot explain (this should never happen; the tests try hard to cause it).
 */
export async function reconcile(worldId: string) {
  let statement: Awaited<ReturnType<ReturnType<typeof zamtel>['statement']>>
  try {
    statement = await zamtel(worldId).statement()
  } catch (error) {
    if (error instanceof ProviderUnavailableError) return { status: 'UNAVAILABLE' as const, message: error.message }
    throw error
  }
  const ledgerTrust = await balanceOf(db, worldId, 'bank:zamtel-trust')
  const ours = [
    ...(await db.select({ id: collections.id, providerTxnId: collections.providerTxnId, status: collections.status, amount: collections.amountNgwee }).from(collections).where(eq(collections.worldId, worldId))).map((c) => ({ ...c, kind: 'COLLECTION' as const })),
    ...(await db.select({ id: payouts.id, providerTxnId: payouts.providerTxnId, status: payouts.status, amount: payouts.amountNgwee, party: payouts.partyName }).from(payouts).where(eq(payouts.worldId, worldId))).map((p) => ({ ...p, kind: 'DISBURSEMENT' as const })),
  ]
  const byTxn = new Map(ours.filter((o) => o.providerTxnId).map((o) => [o.providerTxnId!, o]))
  const settledAtProvider = statement.transactions.filter((t) => t.status === 'SUCCEEDED')

  let matched = 0
  let inFlight = 0
  const awaiting: Array<{ transactionId: string; type: string; amountNgwee: number; reference: string }> = []
  const mismatches: Array<{ transactionId: string; problem: string }> = []
  for (const t of settledAtProvider) {
    const mine = byTxn.get(t.transactionId) ?? ours.find((o) => t.reference === o.id || t.reference.startsWith(`${o.id}:`))
    if (!mine) {
      mismatches.push({ transactionId: t.transactionId, problem: 'The provider moved money Agri-OS has no record of' })
      continue
    }
    if (mine.amount !== t.amountNgwee) {
      mismatches.push({ transactionId: t.transactionId, problem: `Amounts differ: provider ${t.amountNgwee}, Agri-OS ${mine.amount}` })
      continue
    }
    if (mine.status === 'SUCCEEDED') matched++
    else {
      awaiting.push({ transactionId: t.transactionId, type: t.type, amountNgwee: t.amountNgwee, reference: t.reference })
      inFlight += t.type === 'COLLECTION' ? t.amountNgwee : -t.amountNgwee
    }
  }
  const providerIds = new Set(settledAtProvider.map((t) => t.transactionId))
  for (const o of ours) {
    if (o.status === 'SUCCEEDED' && o.providerTxnId && !providerIds.has(o.providerTxnId)) {
      mismatches.push({ transactionId: o.providerTxnId, problem: 'Agri-OS recorded a success the provider does not show' })
    }
  }
  const difference = statement.balanceNgwee - ledgerTrust
  const status = mismatches.length > 0 ? 'MISMATCH' : difference === 0 ? 'BALANCED' : difference === inFlight ? 'SETTLING' : 'MISMATCH'
  return {
    status,
    providerBalanceNgwee: statement.balanceNgwee,
    ledgerBalanceNgwee: ledgerTrust,
    differenceNgwee: difference,
    explainedByInFlightNgwee: inFlight,
    matched,
    awaiting,
    mismatches,
    checkedAt: new Date().toISOString(),
  }
}

/** How the system coped with a bad network: what went wrong outside, and what it did about it. */
export async function resilienceReport(worldId: string) {
  const [webhooks] = await rows<{ received: number; duplicates: number; stale: number; ignored: number }>(
    db,
    sql`select count(*)::int as received, coalesce(sum(duplicates), 0)::int as duplicates,
               count(*) filter (where outcome = 'stale')::int as stale, count(*) filter (where outcome = 'ignored')::int as ignored
        from webhook_receipts where world_id = ${worldId}`,
  )
  const [events] = await rows<{ unknown: number; retried: number; polled: number; failed: number; succeeded: number }>(
    db,
    sql`select count(*) filter (where type = 'payout.unknown')::int as unknown,
               count(*) filter (where type = 'payout.retrying')::int as retried,
               count(*) filter (where type = 'payout.succeeded' and payload->>'source' = 'poll')::int as polled,
               count(*) filter (where type = 'payout.failed')::int as failed,
               count(*) filter (where type = 'payout.succeeded')::int as succeeded
        from events where world_id = ${worldId}`,
  )
  const [invoices] = await rows<{ accepted: number; pending: number; retries: number }>(
    db,
    sql`select count(*) filter (where vsdc_status = 'ACCEPTED')::int as accepted, count(*) filter (where vsdc_status = 'PENDING')::int as pending,
               coalesce(sum(greatest(vsdc_attempts - 1, 0)), 0)::int as retries
        from invoices where world_id = ${worldId}`,
  )
  const [doubles] = await rows<{ n: number }>(
    db,
    sql`select count(*)::int as n from (
          select split_part(reference, ':', 1) from sim_transactions
          where world_id = ${worldId} and type = 'DISBURSEMENT' and status = 'SUCCEEDED'
          group by split_part(reference, ':', 1) having count(*) > 1) x`,
  )
  return {
    callbacks: { received: webhooks.received, duplicatesIgnored: webhooks.duplicates, staleIgnored: webhooks.stale + webhooks.ignored },
    payouts: { succeeded: events.succeeded, timeoutsResolved: events.unknown, retriedAfterFailure: events.retried, recoveredByPolling: events.polled, gaveUp: events.failed },
    invoices: { accepted: invoices.accepted, pending: invoices.pending, retries: invoices.retries },
    doublePayments: doubles.n,
    jobs: await pendingJobs(db, worldId),
    ledger: await ledgerHealth(worldId),
  }
}
