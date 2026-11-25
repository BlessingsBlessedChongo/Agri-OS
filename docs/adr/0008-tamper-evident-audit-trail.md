# 8. A tamper-evident audit trail

## Context

A tax authority will only trust a record it can check. An ordinary audit table can be edited by anyone with database
access, and nobody would know.

## Decision

- Every domain event is appended to a per-world hash chain (`src/server/events.ts`, `src/domain/chain.ts`): its hash
  covers the world, sequence number, type, entity, actor, time, a canonical JSON of the payload (keys sorted, because
  Postgres `jsonb` reorders them) and the previous hash.
- Events are appended at the end of the same transaction as the change they describe (`src/server/uow.ts`), so they
  commit or roll back together, and the chain-head lock is always taken last, which keeps lock order consistent.
- A trigger makes the events table append-only. Verification recomputes the chain and names the first event that is
  missing, re-linked or changed. Signed checkpoints (Ed25519) let an outsider pin the history.

## Consequences

The "Change a payment in the database" button on the audit page switches off the append-only guard for one
transaction, as an insider could, and verification still catches the change. The trail proves integrity, not
completeness of what was never recorded; that is what reconciliation with the provider is for.
