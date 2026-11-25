import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { AccountRef, Posting } from '@/domain/accounts'
import { formatKwacha } from '@/domain/money'
import { db, rows, type DbOrTx, type Tx } from './db'
import { DomainError, pgCode, pgConstraint } from './errors'
import { journalEntries, ledgerAccounts, ledgerLines } from './schema'

/**
 * Double-entry ledger. A posting is a set of signed lines (debit +, credit −) that must sum to zero; the database
 * re-checks that at commit, refuses any balance with the wrong sign, and refuses edits or deletions.
 * Every entry has an idempotency key, so posting the same thing twice is a no-op, not a double payment.
 */
export interface Entry {
  kind: string
  memo: string
  idempotencyKey: string
  refType?: string
  refId?: string
  postings: Posting[]
}

export interface PostResult {
  entryId: string
  duplicate: boolean
}

export class InsufficientFundsError extends DomainError {
  constructor(message: string) {
    super('INSUFFICIENT_FUNDS', message, 409)
  }
}

export async function ensureAccounts(tx: Tx, worldId: string, refs: AccountRef[]): Promise<Map<string, string>> {
  const unique = [...new Map(refs.map((r) => [r.code, r])).values()]
  if (unique.length === 0) return new Map()
  await tx
    .insert(ledgerAccounts)
    .values(unique.map((r) => ({ worldId, code: r.code, name: r.name, type: r.type })))
    .onConflictDoNothing({ target: [ledgerAccounts.worldId, ledgerAccounts.code] })
  const found = await tx
    .select({ id: ledgerAccounts.id, code: ledgerAccounts.code })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.worldId, worldId), inArray(ledgerAccounts.code, unique.map((r) => r.code))))
  return new Map(found.map((a) => [a.code, a.id]))
}

export async function post(tx: Tx, worldId: string, entry: Entry): Promise<PostResult> {
  const postings = entry.postings.filter((p) => p.amount !== 0)
  if (postings.length < 2) throw new Error(`Entry ${entry.idempotencyKey} needs at least two non-zero lines`)
  for (const p of postings) {
    if (!Number.isSafeInteger(p.amount)) throw new RangeError(`Line for ${p.account.code} is not a whole number of ngwee`)
  }
  const total = postings.reduce((a, p) => a + p.amount, 0)
  if (total !== 0) throw new Error(`Entry ${entry.idempotencyKey} does not balance (off by ${total} ngwee)`)

  const inserted = await tx
    .insert(journalEntries)
    .values({ worldId, kind: entry.kind, memo: entry.memo, idempotencyKey: entry.idempotencyKey, refType: entry.refType, refId: entry.refId })
    .onConflictDoNothing({ target: [journalEntries.worldId, journalEntries.idempotencyKey] })
    .returning({ id: journalEntries.id })
  if (inserted.length === 0) {
    const [existing] = await tx
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(and(eq(journalEntries.worldId, worldId), eq(journalEntries.idempotencyKey, entry.idempotencyKey)))
    return { entryId: existing.id, duplicate: true }
  }
  const entryId = inserted[0].id

  const accountIds = await ensureAccounts(tx, worldId, postings.map((p) => p.account))
  await tx.insert(ledgerLines).values(postings.map((p) => ({ worldId, entryId, accountId: accountIds.get(p.account.code)!, amountNgwee: p.amount })))

  // Update cached balances in a fixed order (by account code) so concurrent postings can't deadlock.
  const deltas = new Map<string, number>()
  for (const p of postings) deltas.set(p.account.code, (deltas.get(p.account.code) ?? 0) + p.amount)
  for (const code of [...deltas.keys()].sort()) {
    const delta = deltas.get(code)!
    if (delta === 0) continue
    try {
      await tx
        .update(ledgerAccounts)
        .set({ balanceNgwee: sql`${ledgerAccounts.balanceNgwee} + ${delta}` })
        .where(eq(ledgerAccounts.id, accountIds.get(code)!))
    } catch (error) {
      // The sign check failed: the whole transaction rolls back, so nothing in this entry is kept.
      if (pgCode(error) === '23514' && pgConstraint(error) === 'ledger_accounts_sign_ck') {
        const name = postings.find((p) => p.account.code === code)!.account.name
        throw new InsufficientFundsError(`${name} cannot cover ${formatKwacha(Math.abs(delta))}`)
      }
      throw error
    }
  }
  return { entryId, duplicate: false }
}

export async function balanceOf(runner: DbOrTx, worldId: string, code: string): Promise<number> {
  const [account] = await runner
    .select({ balance: ledgerAccounts.balanceNgwee })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.worldId, worldId), eq(ledgerAccounts.code, code)))
  return account?.balance ?? 0
}

export async function accounts(worldId: string) {
  return db.select().from(ledgerAccounts).where(eq(ledgerAccounts.worldId, worldId)).orderBy(ledgerAccounts.code)
}

export async function recentEntries(worldId: string, limit = 25) {
  const entries = await db.select().from(journalEntries).where(eq(journalEntries.worldId, worldId)).orderBy(desc(journalEntries.createdAt)).limit(limit)
  if (entries.length === 0) return []
  const lines = await db
    .select({ entryId: ledgerLines.entryId, amount: ledgerLines.amountNgwee, code: ledgerAccounts.code, name: ledgerAccounts.name })
    .from(ledgerLines)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerLines.accountId))
    .where(inArray(ledgerLines.entryId, entries.map((e) => e.id)))
  return entries.map((e) => ({ ...e, lines: lines.filter((l) => l.entryId === e.id) }))
}

/** The three properties that must always hold. Returned as a report rather than thrown, for the resilience page. */
export async function ledgerHealth(worldId: string) {
  const [totals] = await rows<{ accounts: number; total: number; lines: number; entries: number }>(
    db,
    sql`select (select count(*) from ledger_accounts where world_id = ${worldId})::int as accounts,
               (select coalesce(sum(balance_ngwee), 0) from ledger_accounts where world_id = ${worldId})::bigint as total,
               (select count(*) from ledger_lines where world_id = ${worldId})::int as lines,
               (select count(*) from journal_entries where world_id = ${worldId})::int as entries`,
  )
  const drift = await rows<{ code: string; cached: number; actual: number }>(
    db,
    sql`select a.code, a.balance_ngwee as cached, coalesce(sum(l.amount_ngwee), 0)::bigint as actual
        from ledger_accounts a left join ledger_lines l on l.account_id = a.id
        where a.world_id = ${worldId}
        group by a.id having a.balance_ngwee <> coalesce(sum(l.amount_ngwee), 0)`,
  )
  const unbalanced = await rows<{ entry_id: string; off: number }>(
    db,
    sql`select entry_id, sum(amount_ngwee)::bigint as off from ledger_lines where world_id = ${worldId} group by entry_id having sum(amount_ngwee) <> 0`,
  )
  return {
    accounts: totals.accounts,
    entries: totals.entries,
    lines: totals.lines,
    sumOfBalances: Number(totals.total),
    balancesMatchLines: drift.length === 0,
    drift,
    unbalancedEntries: unbalanced.length,
    ok: Number(totals.total) === 0 && drift.length === 0 && unbalanced.length === 0,
  }
}
