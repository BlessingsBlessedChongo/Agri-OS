# 1. Integer ngwee in a double-entry ledger, guarded by the database

## Context

Agri-OS holds buyers' money in escrow and pays farmers, hauliers and ZRA out of it. Rounding drift, a lost update or a
half-written settlement would mean someone is underpaid or money appears from nowhere.

## Decision

- Every amount is a whole number of ngwee (K1 = 100 ngwee). Multiplication and rounding happen in BigInt
  (`src/domain/money.ts`); results are checked to be safe integers. Floats never touch money.
- Every movement is a journal entry of signed lines (debit positive, credit negative) that must sum to zero
  (`src/server/ledger.ts`). Accounts: the Zamtel Money trust wallet (asset), escrow per order, amounts owed to each
  farmer, haulier and buyer, payouts in flight, tax owed to ZRA (liabilities) and fee revenue.
- The database enforces the invariants itself (`drizzle/0001_ledger_guards.sql`):
  - a deferred constraint trigger re-checks at COMMIT that each entry balances;
  - a CHECK constraint refuses an asset below zero or a liability/revenue above zero, so escrow can never be
    overdrawn, even by a race;
  - triggers make ledger lines and journal entries append-only.
- Each entry has an idempotency key unique per sandbox, so posting the same thing twice is a no-op.
- Cached balances are updated in the same transaction, in a fixed account order to avoid deadlocks; a health check
  confirms they equal the sum of their lines.

## Consequences

The settlement maths can be property-tested in isolation (`tests/unit/settlement.test.ts`), and no code path, now or
later, can break the books without the database refusing the transaction. The cost is a little more SQL ceremony
for each posting.
