# 2. "Unknown" is a first-class payment outcome

## Context

Mobile-money APIs are asynchronous and the network between Agri-OS and the provider is not reliable. A request can
fail before it arrives, succeed but answer too late, or succeed with its confirmation lost or delivered twice or out
of order. Treating a timeout as a failure and retrying with a fresh request is how double payments happen.

## Decision

Every provider call returns one of three outcomes (`src/integrations/zamtel/client.ts`):

- **accepted**: the provider has it (it may still be processing);
- **rejected**: the provider refused it (4xx); no money moved, so it is safe to treat as failed;
- **unknown**: timeout, 5xx or network error; money may or may not move.

The payout state machine (`src/server/payouts.ts`) follows from that:

1. Before calling the provider, the amount moves from "owed" to "in flight" in the ledger (status `SENT`).
2. `unknown` becomes status `UNKNOWN`, never `FAILED`. Agri-OS asks the provider by reference, or re-sends with the
   **same** idempotency key, which the provider de-duplicates.
3. Only a definite failure moves the money back to "owed" and starts a new attempt with a **new** key
   (`payout:{id}:{attempt}`), up to three attempts; after that a person decides.
4. Callbacks are matched to the attempt by reference. Anything for an older attempt, a duplicate, or a stale
   "processing" after the result is ignored.
5. While a payout is in flight there is always a status check scheduled, so a lost callback can't strand it.
   (The storm tests found a version of this rule missing; see the commit history.)

## Consequences

The storm tests (`tests/integration/harvest.test.ts`, `npm run e2e -- --storm`) throw refusals, timeouts, failures and
lost, duplicated and reordered callbacks at a harvest and assert that no payout reached the provider twice and the
books reconcile with the provider's statement.
