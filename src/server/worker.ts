import { deliverCallback, type ProviderStatus } from '@/integrations/zamtel/client'
import { expirePrompt, processDisbursement } from '@/integrations/zamtel/simulator'
import '@/integrations/loopback'
import { db } from './db'
import { submitInvoice } from './invoices'
import { claimJobs, completeJob, failJob, pendingJobs, rescheduleJob, type JobRow } from './jobs'
import { checkCollection } from './orders'
import { checkPayout, dispatchPayout } from './payouts'
import { random } from './random'
import { sendSms } from './sms'

type Handler = (job: JobRow) => Promise<void | { again: number }>

const str = (v: unknown) => String(v)

const handlers: Record<string, Handler> = {
  'payout.dispatch': (j) => dispatchPayout(j.worldId, str(j.payload.payoutId)),
  'payout.check': (j) => checkPayout(j.worldId, str(j.payload.payoutId), Number(j.payload.attempt)),
  'collection.check': (j) => checkCollection(j.worldId, str(j.payload.collectionId)),
  'invoice.submit': (j) => submitInvoice(j.worldId, str(j.payload.invoiceId)),
  'sms.send': (j) => sendSms(j.worldId, str(j.payload.smsId), Boolean(j.payload.external)),
  // The simulated providers' own background work runs on the same queue.
  'sim.process': (j) => processDisbursement(j.worldId, str(j.payload.transactionId), random),
  'sim.callback': (j) => deliverCallback(j.worldId, { transactionId: str(j.payload.transactionId), eventId: str(j.payload.eventId), status: j.payload.status as ProviderStatus }),
  'sim.expire_prompt': (j) => expirePrompt(j.worldId, str(j.payload.transactionId), random),
}

export interface DrainResult {
  ran: number
  failed: number
}

/**
 * Runs due jobs until the time budget is spent. Called after API requests (Next's `after`), by the UI's tick while
 * a page is open, and by cron. Safe to run many at once: jobs are claimed with SKIP LOCKED and handlers are
 * idempotent. No handler holds a database transaction while it waits on the network.
 */
export async function drain(options: { worldId?: string; budgetMs?: number; concurrency?: number; ignoreSchedule?: boolean } = {}): Promise<DrainResult> {
  const deadline = Date.now() + (options.budgetMs ?? 1500)
  let ran = 0
  let failed = 0
  while (Date.now() < deadline) {
    const batch = await claimJobs(db, { worldId: options.worldId, limit: options.concurrency ?? 6, ignoreSchedule: options.ignoreSchedule })
    if (batch.length === 0) break
    await Promise.all(
      batch.map(async (job) => {
        try {
          const handler = handlers[job.kind]
          if (!handler) throw new Error(`No handler for job kind ${job.kind}`)
          const result = await handler(job)
          if (result && 'again' in result) await rescheduleJob(db, job.id, result.again)
          else await completeJob(db, job.id)
          ran++
        } catch (error) {
          failed++
          const message = error instanceof Error ? error.message : String(error)
          const outcome = await failJob(db, job, message)
          if (outcome === 'failed') console.error(`[jobs] ${job.kind} #${job.id} gave up after ${job.attempts} attempts: ${message}`)
        }
      }),
    )
  }
  return { ran, failed }
}

/**
 * Tests and scripts: keep working until the world's queue is empty (delays are skipped, but a job that asked to
 * be retried later still waits for real), or until the timeout.
 */
export async function settleWorld(worldId: string, options: { timeoutMs?: number } = {}) {
  const deadline = Date.now() + (options.timeoutMs ?? 60_000)
  let total = 0
  while (Date.now() < deadline) {
    const { ran, failed } = await drain({ worldId, budgetMs: 10_000, concurrency: 4, ignoreSchedule: true })
    total += ran
    if (ran === 0 && failed === 0) {
      const pending = await pendingJobs(db, worldId)
      if (pending.due + pending.scheduled === 0) return { ran: total, quiet: true }
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }
  return { ran: total, quiet: false }
}
