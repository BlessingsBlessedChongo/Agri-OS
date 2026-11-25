import { sql } from 'drizzle-orm'
import { formatRef } from '@/domain/ids'
import { rows, type Tx } from './db'

/** Gap-free per-world numbering (inside the caller's transaction, so a rolled-back record doesn't burn a number). */
export async function nextNumber(tx: Tx, worldId: string, name: string): Promise<number> {
  const [r] = await rows<{ value: number }>(
    tx,
    sql`insert into counters (world_id, name, value) values (${worldId}, ${name}, 1)
        on conflict (world_id, name) do update set value = counters.value + 1
        returning value`,
  )
  return r.value
}

export async function nextRef(tx: Tx, worldId: string, prefix: string, width = 4): Promise<string> {
  return formatRef(prefix, await nextNumber(tx, worldId, prefix), width)
}
