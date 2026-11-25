import { sql } from 'drizzle-orm'
import { rows, type DbOrTx } from './db'
import { jobs } from './schema'

/**
 * A small Postgres job queue (the transactional outbox). Work that talks to the outside world — sending a payout,
 * submitting an invoice, delivering a webhook — is written as a job in the same transaction as the change that
 * needs it, so it can never be lost or happen without that change. Workers claim jobs with FOR UPDATE SKIP LOCKED.
 */
export interface JobRow {
  id: number
  worldId: string
  kind: string
  payload: Record<string, unknown>
  attempts: number
  maxAttempts: number
}

export interface EnqueueOptions {
  delayMs?: number
  dedupeKey?: string
  maxAttempts?: number
}

export async function enqueue(runner: DbOrTx, worldId: string, kind: string, payload: Record<string, unknown>, options: EnqueueOptions = {}) {
  const delay = Math.max(0, Math.round(options.delayMs ?? 0))
  await runner
    .insert(jobs)
    .values({
      worldId,
      kind,
      payload,
      runAt: sql`now() + make_interval(secs => ${delay / 1000})`,
      maxAttempts: options.maxAttempts ?? 8,
      dedupeKey: options.dedupeKey,
    })
    .onConflictDoNothing({ target: [jobs.worldId, jobs.dedupeKey] })
}

/** Jobs that stand for real-world deadlines (a payment prompt lapsing). Never fast-forwarded, even in tests. */
export const TIMER_KINDS = ['sim.expire_prompt']

/** Claims up to `limit` due jobs; a claim lasts 30 s, after which a crashed worker's job is picked up again. */
export async function claimJobs(runner: DbOrTx, options: { worldId?: string; limit: number; ignoreSchedule?: boolean }): Promise<JobRow[]> {
  const worldFilter = options.worldId ? sql`and world_id = ${options.worldId}` : sql``
  const timers = sql.join(
    TIMER_KINDS.map((k) => sql`${k}`),
    sql`, `,
  )
  const due = options.ignoreSchedule ? sql`(run_at <= now() or kind not in (${timers}))` : sql`run_at <= now()`
  return rows<JobRow>(
    runner,
    sql`update jobs set locked_until = now() + interval '30 seconds', attempts = attempts + 1
        where id in (
          select id from jobs
          where done_at is null and failed_at is null and ${due}
            and (locked_until is null or locked_until < now()) ${worldFilter}
          order by run_at, id
          limit ${options.limit}
          for update skip locked)
        returning id, world_id as "worldId", kind, payload, attempts, max_attempts as "maxAttempts"`,
  )
}

export async function completeJob(runner: DbOrTx, id: number) {
  await runner.execute(sql`update jobs set done_at = now(), locked_until = null where id = ${id}`)
}

/** Runs the job again later without counting it as a failure (e.g. "payment still processing"). */
export async function rescheduleJob(runner: DbOrTx, id: number, delayMs: number) {
  // locked_until = run_at, so even a worker that ignores the schedule (tests) waits the real delay.
  await runner.execute(
    sql`update jobs set run_at = now() + make_interval(secs => ${delayMs / 1000}), locked_until = now() + make_interval(secs => ${delayMs / 1000}),
        attempts = greatest(attempts - 1, 0) where id = ${id}`,
  )
}

export async function failJob(runner: DbOrTx, job: JobRow, error: string) {
  if (job.attempts >= job.maxAttempts) {
    await runner.execute(sql`update jobs set failed_at = now(), locked_until = null, last_error = ${error} where id = ${job.id}`)
    return 'failed' as const
  }
  const backoffSeconds = Math.min(30, 2 ** job.attempts * 0.5) + Math.random() * 0.5
  await runner.execute(
    sql`update jobs set run_at = now() + make_interval(secs => ${backoffSeconds}), locked_until = null, last_error = ${error} where id = ${job.id}`,
  )
  return 'retry' as const
}

export async function pendingJobs(runner: DbOrTx, worldId: string): Promise<{ due: number; scheduled: number; failed: number }> {
  const [r] = await rows<{ due: number; scheduled: number; failed: number }>(
    runner,
    sql`select count(*) filter (where done_at is null and failed_at is null and run_at <= now())::int as due,
               count(*) filter (where done_at is null and failed_at is null and run_at > now())::int as scheduled,
               count(*) filter (where failed_at is not null)::int as failed
        from jobs where world_id = ${worldId}`,
  )
  return r
}
