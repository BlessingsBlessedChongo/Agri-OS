import { and, asc, desc, eq, gt, lt, sql } from 'drizzle-orm'
import { eventHash, GENESIS_HASH, verifyChain, type ChainCheck } from '@/domain/chain'
import { db, rows, type DbOrTx, type Tx } from './db'
import { chainHeads, events } from './schema'
import { signText } from './signing'

export interface EventInput {
  type: string
  entityType: string
  entityId: string
  actor: string
  payload: Record<string, unknown>
}

/**
 * Appends to the world's hash chain. Locks the chain head, so call it last in a transaction (the unit of work in
 * uow.ts does this for you): every transaction then takes its locks in the same order and cannot deadlock on the head.
 */
export async function appendEvent(tx: Tx, worldId: string, input: EventInput): Promise<{ seq: number; hash: string }> {
  const [head] = await rows<{ seq: number; hash: string }>(tx, sql`select seq, hash from chain_heads where world_id = ${worldId} for update`)
  if (!head) throw new Error(`World ${worldId} has no chain head`)
  const seq = head.seq + 1
  const occurredAt = new Date()
  const hash = eventHash({ worldId, seq, ...input, occurredAt, prevHash: head.hash })
  await tx.insert(events).values({ worldId, seq, ...input, occurredAt, prevHash: head.hash, hash })
  await tx.update(chainHeads).set({ seq, hash, updatedAt: occurredAt }).where(eq(chainHeads.worldId, worldId))
  return { seq, hash }
}

export async function initChain(tx: Tx, worldId: string) {
  await tx.insert(chainHeads).values({ worldId, seq: 0, hash: GENESIS_HASH }).onConflictDoNothing()
}

export async function eventsAfter(worldId: string, afterSeq: number, limit = 200) {
  return db
    .select({ seq: events.seq, type: events.type, entityType: events.entityType, entityId: events.entityId, actor: events.actor, payload: events.payload, occurredAt: events.occurredAt })
    .from(events)
    .where(and(eq(events.worldId, worldId), gt(events.seq, afterSeq)))
    .orderBy(asc(events.seq))
    .limit(limit)
}

export async function eventsPage(worldId: string, beforeSeq: number | null, limit = 50) {
  return db
    .select()
    .from(events)
    .where(beforeSeq ? and(eq(events.worldId, worldId), lt(events.seq, beforeSeq)) : eq(events.worldId, worldId))
    .orderBy(desc(events.seq))
    .limit(limit)
}

export async function chainHead(runner: DbOrTx, worldId: string) {
  const [head] = await runner.select().from(chainHeads).where(eq(chainHeads.worldId, worldId))
  return head ?? null
}

/** Recomputes every hash in the world's chain, a page at a time. */
export async function verifyWorldChain(worldId: string): Promise<ChainCheck> {
  let from = { seq: 0, hash: GENESIS_HASH }
  let checked = 0
  for (;;) {
    const page = await db
      .select()
      .from(events)
      .where(and(eq(events.worldId, worldId), gt(events.seq, from.seq)))
      .orderBy(asc(events.seq))
      .limit(1000)
    if (page.length === 0) break
    const result = verifyChain(page, from)
    checked += result.checked
    if (!result.ok) return { ...result, checked }
    from = { seq: result.headSeq, hash: result.headHash }
    if (page.length < 1000) break
  }
  const head = await chainHead(db, worldId)
  if (head && head.seq !== from.seq) {
    return {
      ok: false,
      checked,
      headSeq: from.seq,
      headHash: from.hash,
      problem: { seq: from.seq + 1, kind: 'SEQUENCE_GAP', message: `The chain head says #${head.seq} but events stop at #${from.seq}: events were deleted.` },
    }
  }
  return { ok: true, checked, headSeq: from.seq, headHash: from.hash, problem: null }
}

/** A signed statement of the chain head: anyone holding it can later prove the history was not rewritten. */
export function signCheckpoint(worldId: string, seq: number, hash: string) {
  const signedAt = new Date().toISOString()
  const statement = `agri-os/checkpoint/v1\n${worldId}\n${seq}\n${hash}\n${signedAt}`
  return { worldId, seq, hash, signedAt, statement, signature: signText(statement) }
}
