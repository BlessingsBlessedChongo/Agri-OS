import { createHash } from 'node:crypto'

/**
 * The audit trail is a hash chain: every event's hash covers its contents and the previous event's hash.
 * Change any recorded amount — even directly in the database — and verification points at the exact event.
 */
export const GENESIS_HASH = '0'.repeat(64)

/** JSON with keys sorted at every level, so the same data always hashes the same (Postgres jsonb reorders keys). */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  switch (typeof value) {
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('canonicalJson: numbers must be finite')
      return JSON.stringify(value)
    case 'string':
    case 'boolean':
      return JSON.stringify(value)
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
    }
    default:
      throw new TypeError(`canonicalJson: cannot encode ${typeof value}`)
  }
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export interface ChainEvent {
  worldId: string
  seq: number
  type: string
  entityType: string
  entityId: string
  actor: string
  payload: unknown
  occurredAt: Date
  prevHash: string
}

export function eventHash(e: ChainEvent): string {
  return sha256Hex(
    [
      'agri-os/event/v1',
      e.worldId,
      String(e.seq),
      e.type,
      e.entityType,
      e.entityId,
      e.actor,
      e.occurredAt.toISOString(),
      canonicalJson(e.payload),
      e.prevHash,
    ].join('\n'),
  )
}

export type ChainProblemKind = 'CONTENT_CHANGED' | 'LINK_BROKEN' | 'SEQUENCE_GAP'

export interface ChainProblem {
  seq: number
  kind: ChainProblemKind
  message: string
}

export interface ChainCheck {
  ok: boolean
  checked: number
  headSeq: number
  headHash: string
  problem: ChainProblem | null
}

/** Walks events in order. `from` lets a long chain be verified in pages. */
export function verifyChain(
  events: ReadonlyArray<ChainEvent & { hash: string }>,
  from: { seq: number; hash: string } = { seq: 0, hash: GENESIS_HASH },
): ChainCheck {
  let expectedSeq = from.seq + 1
  let prev = from.hash
  let checked = 0
  for (const e of events) {
    if (e.seq !== expectedSeq) {
      return { ok: false, checked, headSeq: expectedSeq - 1, headHash: prev, problem: { seq: expectedSeq, kind: 'SEQUENCE_GAP', message: `Event #${expectedSeq} is missing: the next event is #${e.seq}.` } }
    }
    if (e.prevHash !== prev) {
      return { ok: false, checked, headSeq: e.seq - 1, headHash: prev, problem: { seq: e.seq, kind: 'LINK_BROKEN', message: `Event #${e.seq} does not point at event #${e.seq - 1}: an event before it was replaced or removed.` } }
    }
    if (eventHash(e) !== e.hash) {
      return { ok: false, checked, headSeq: e.seq - 1, headHash: prev, problem: { seq: e.seq, kind: 'CONTENT_CHANGED', message: `Event #${e.seq} (${e.type}) was changed after it was recorded: its contents no longer match its hash.` } }
    }
    prev = e.hash
    expectedSeq++
    checked++
  }
  return { ok: true, checked, headSeq: expectedSeq - 1, headHash: prev, problem: null }
}
