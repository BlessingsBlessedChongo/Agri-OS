# 7. A sandbox per visitor over shared reference data

## Context

A public demo that everyone shares gets broken by the last visitor, and two people running the guided harvest at once
would trip over each other's orders.

## Decision

- Every visitor gets a world (`src/server/world.ts`), identified by an HTTP-only cookie. Creating one is a single
  insert plus a chain head and two simulator wallets.
- Reference data (districts, depots, buyers, transporters, 48 farmers and six months of signed history) is shared and
  read-only (`world_id IS NULL`). Everything a visitor creates lives in their world and is deleted with it
  (`ON DELETE CASCADE`, run as a maintenance transaction because the ledger is append-only).
- Worlds expire 24 hours after last use; creation is rate-limited per network and capped overall.
- Real USSD traffic (no cookie) lands in a permanent "live" world.

## Consequences

Every query on mutable data filters by world; reference queries include the shared rows. Row-level security in
Postgres would add defence in depth and is the next step for a multi-tenant production deployment.
