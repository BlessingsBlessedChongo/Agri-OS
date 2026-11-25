import { and, asc, eq, gte, lt, sql } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { CALM, normalizeChaos, type ChaosSettings } from '@/domain/chaos'
import { config } from './config'
import { db, rows } from './db'
import { DomainError, HttpError } from './errors'
import { appendEvent, initChain } from './events'
import { simWallets, worlds } from './schema'

export const WORLD_COOKIE = 'agrios_world'
/** The world real USSD traffic (Africa's Talking) lands in; it never expires. */
export const LIVE_WORLD_ID = '00000000-0000-4000-8000-000000000001'
/** Wallets inside the simulated Zamtel Money. */
export const TRUST_MSISDN = 'AGRIOS-TRUST'
export const ZRA_MSISDN = 'ZRA-REVENUE'

const MAX_SANDBOXES = Number(process.env.MAX_SANDBOXES ?? 400)
const MAX_PER_IP_PER_HOUR = Number(process.env.MAX_SANDBOXES_PER_IP_PER_HOUR ?? 30)

export interface World {
  id: string
  kind: 'sandbox' | 'live'
  chaos: ChaosSettings
  createdAt: Date
  lastSeenAt: Date
}

function toWorld(row: typeof worlds.$inferSelect): World {
  return { id: row.id, kind: row.kind, chaos: normalizeChaos(row.chaos), createdAt: row.createdAt, lastSeenAt: row.lastSeenAt }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function getWorld(id: string): Promise<World | null> {
  if (!UUID.test(id)) return null
  const [row] = await db.select().from(worlds).where(eq(worlds.id, id))
  return row ? toWorld(row) : null
}

export async function createWorld(options: { ipHash?: string; kind?: 'sandbox' | 'live'; id?: string } = {}): Promise<World> {
  const kind = options.kind ?? 'sandbox'
  if (kind === 'sandbox') {
    if (options.ipHash) {
      const [recent] = await rows<{ n: number }>(
        db,
        sql`select count(*)::int as n from worlds where ip_hash = ${options.ipHash} and created_at > now() - interval '1 hour'`,
      )
      if (recent.n >= MAX_PER_IP_PER_HOUR) throw new DomainError('RATE_LIMITED', 'Too many new sandboxes from this network. Try again in an hour.', 429)
    }
    await purgeExpired()
    const [count] = await rows<{ n: number }>(db, sql`select count(*)::int as n from worlds where kind = 'sandbox'`)
    if (count.n >= MAX_SANDBOXES) {
      const oldest = await db.select({ id: worlds.id }).from(worlds).where(eq(worlds.kind, 'sandbox')).orderBy(asc(worlds.lastSeenAt)).limit(count.n - MAX_SANDBOXES + 1)
      for (const w of oldest) await purgeWorld(w.id)
    }
  }
  const world = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(worlds)
      .values({ id: options.id, kind, chaos: CALM, ipHash: options.ipHash })
      .onConflictDoNothing()
      .returning()
    if (!row) {
      const [existing] = await tx.select().from(worlds).where(eq(worlds.id, options.id!))
      return toWorld(existing)
    }
    await initChain(tx, row.id)
    await tx
      .insert(simWallets)
      .values([
        { worldId: row.id, msisdn: TRUST_MSISDN, name: 'Agri-OS escrow (trust account)', kind: 'TRUST', balanceNgwee: 0 },
        { worldId: row.id, msisdn: ZRA_MSISDN, name: 'Zambia Revenue Authority collections', kind: 'TAX', balanceNgwee: 0 },
      ])
      .onConflictDoNothing()
    await appendEvent(tx, row.id, {
      type: 'world.created',
      entityType: 'world',
      entityId: row.id,
      actor: 'system',
      payload: { kind, note: kind === 'sandbox' ? 'A private sandbox: shared reference data, private activity.' : 'Live world for real USSD traffic.' },
    })
    return toWorld(row)
  })
  return world
}

export async function ensureLiveWorld(): Promise<World> {
  return (await getWorld(LIVE_WORLD_ID)) ?? createWorld({ kind: 'live', id: LIVE_WORLD_ID })
}

/** Deletes a world and everything in it. The ledger and audit trail are append-only, so this runs as maintenance. */
export async function purgeWorld(id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('agrios.maintenance', 'on', true)`)
    await tx.delete(worlds).where(eq(worlds.id, id))
  })
}

export async function purgeExpired(limit = 5): Promise<number> {
  const stale = await db
    .select({ id: worlds.id })
    .from(worlds)
    .where(and(eq(worlds.kind, 'sandbox'), lt(worlds.lastSeenAt, sql`now() - make_interval(hours => ${config.sandboxTtlHours()})`)))
    .limit(limit)
  for (const w of stale) await purgeWorld(w.id)
  return stale.length
}

export function worldIdFrom(request: NextRequest): string | null {
  const value = request.cookies.get(WORLD_COOKIE)?.value ?? request.headers.get('x-agrios-world')
  return value && UUID.test(value) ? value : null
}

export async function requireWorld(request: NextRequest): Promise<World> {
  const id = worldIdFrom(request)
  const world = id ? await getWorld(id) : null
  if (!world) throw new HttpError(401, 'NO_WORLD', 'No sandbox yet. POST /api/world to create one.')
  return world
}

/** Marks a world as in use (at most once a minute) so it isn't cleaned up while someone is exploring it. */
export async function touchWorld(world: World): Promise<void> {
  if (Date.now() - world.lastSeenAt.getTime() < 60_000) return
  await db.update(worlds).set({ lastSeenAt: new Date() }).where(and(eq(worlds.id, world.id), gte(worlds.createdAt, new Date(0))))
}

export async function setChaos(worldId: string, chaos: ChaosSettings): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(worlds).set({ chaos }).where(eq(worlds.id, worldId))
    await appendEvent(tx, worldId, { type: 'chaos.changed', entityType: 'world', entityId: worldId, actor: 'visitor', payload: { ...chaos } })
  })
}
