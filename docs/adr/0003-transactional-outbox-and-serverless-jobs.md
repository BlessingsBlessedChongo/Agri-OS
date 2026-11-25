# 3. A transactional outbox, run without a worker process

## Context

Settling a truck means paying a dozen parties and issuing a dozen invoices. Calling the providers inside the
settlement transaction would hold locks while waiting on the network, and a crash halfway would leave some people
paid and no record of the rest. The app also has to run on serverless hosting, where there is no long-running worker.

## Decision

- Settlement writes the ledger entry, every payout row, every invoice row **and a job for each** in one transaction
  (`src/server/settlement.ts`). Either all of it exists or none of it does.
- Jobs live in a Postgres table (`src/server/jobs.ts`) and are claimed with `FOR UPDATE SKIP LOCKED`; a claim expires
  after 30 seconds, so a crashed worker's job is picked up again. Failures back off; a handler can ask to run again
  later without counting as a failure.
- No handler holds a database transaction while it waits on the network: read, call, then write in a new transaction.
- Jobs run after each API response (Next.js `after()`), on a tick from any open page, and from a cron route. Handlers
  are idempotent and safe to run concurrently, so it doesn't matter which of those runs them.
- Jobs that stand for real deadlines (a payment prompt lapsing) are never fast-forwarded, even in tests.

## Consequences

No separate worker to deploy, and the same code runs locally, in tests (loopback transport, `settleWorld`) and on
Vercel. Throughput is bounded by how often requests arrive, which suits this workload; a real deployment with heavy
traffic would add a dedicated worker calling the same `drain()`.
