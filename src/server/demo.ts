import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from './db'
import { DomainError } from './errors'
import { offersAtDepot } from './pledges'
import { random } from './random'
import { listFarmers } from './reference'
import { events, pledges, worlds } from './schema'
import { handleUssd, USSD_CODE } from './ussd'
import { getWorld } from './world'

/**
 * Other farmers at a depot pledging to an offer, so a demo truck has a real load. Each one goes through the same
 * USSD engine a phone would (the whole menu path in one request, as Africa's Talking replays it).
 */
export async function simulateCrowd(worldId: string, input: { orderId: string; depotId: string; count: number; exclude: string[] }) {
  const pledged = new Set((await db.select({ farmerId: pledges.farmerId }).from(pledges).where(eq(pledges.orderId, input.orderId))).map((p) => p.farmerId))
  const candidates = (await listFarmers(db, worldId, { depotId: input.depotId })).filter((f) => !input.exclude.includes(f.phone) && !pledged.has(f.id)).slice(0, input.count)
  const results: Array<{ farmer: string; bags: number; reply: string }> = []
  for (const farmer of candidates) {
    const offers = await offersAtDepot(worldId, input.depotId)
    const index = offers.findIndex((o) => o.order.id === input.orderId)
    if (index < 0) break
    const bags = Math.min(offers[index].remainingBags, 6 + Math.floor(random() * 9))
    if (bags < 1) break
    const path = ['1', ...Array<string>(Math.floor(index / 3)).fill('9'), String((index % 3) + 1), String(bags), '1']
    const reply = await handleUssd(worldId, { sessionId: randomUUID(), serviceCode: USSD_CODE, phoneNumber: farmer.phone, text: path.join('*') })
    results.push({ farmer: farmer.name, bags, reply })
  }
  return results
}

const MONEY_EVENTS = ['payout.succeeded', 'settlement.completed', 'escrow.funded']

/** The "insider" demo: changes a recorded amount directly in the database, bypassing the app (sandboxes only). */
export async function tamper(worldId: string) {
  const world = await getWorld(worldId)
  if (!world || world.kind !== 'sandbox') throw new DomainError('NOT_SANDBOX', 'Tampering is only allowed in a sandbox', 403)
  const [row] = await db.select({ tamper: worlds.tamper }).from(worlds).where(eq(worlds.id, worldId))
  if (row?.tamper) throw new DomainError('ALREADY_TAMPERED', 'Put the last change back before trying another')
  const [target] = await db
    .select()
    .from(events)
    .where(and(eq(events.worldId, worldId), inArray(events.type, MONEY_EVENTS)))
    .orderBy(desc(events.seq))
    .limit(1)
  if (!target) throw new DomainError('NOTHING_YET', 'Run a harvest first: there is no payment in the trail yet', 409)
  const payload = target.payload as Record<string, unknown>
  const field = ['amountNgwee', 'buyerTotalNgwee', 'produceNgwee'].find((f) => typeof payload[f] === 'number')!
  const before = payload[field] as number
  const after = before * 10
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('agrios.maintenance', 'on', true)`)
    await tx.update(events).set({ payload: { ...payload, [field]: after } }).where(eq(events.id, target.id))
    await tx.update(worlds).set({ tamper: { seq: target.seq, original: payload, field } }).where(eq(worlds.id, worldId))
  })
  return { seq: target.seq, type: target.type, field, before, after }
}

export async function undoTamper(worldId: string) {
  const [row] = await db.select({ tamper: worlds.tamper }).from(worlds).where(eq(worlds.id, worldId))
  if (!row?.tamper) return false
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('agrios.maintenance', 'on', true)`)
    await tx.update(events).set({ payload: row.tamper!.original as Record<string, unknown> }).where(and(eq(events.worldId, worldId), eq(events.seq, row.tamper!.seq)))
    await tx.update(worlds).set({ tamper: null }).where(eq(worlds.id, worldId))
  })
  return true
}
