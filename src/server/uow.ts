import { db, type Tx } from './db'
import { appendEvent, type EventInput } from './events'

/**
 * A unit of work: one database transaction plus the audit events it produces. Events are appended after the work,
 * at the end of the transaction, so they commit (or roll back) together with what they describe.
 */
export interface Uow {
  tx: Tx
  worldId: string
  emit(event: EventInput): void
}

export async function inWorld<T>(worldId: string, work: (u: Uow) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const pending: EventInput[] = []
    const result = await work({ tx, worldId, emit: (e) => pending.push(e) })
    for (const event of pending) await appendEvent(tx, worldId, event)
    return result
  })
}
