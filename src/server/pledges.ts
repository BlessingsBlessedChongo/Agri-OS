import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { CROPS } from '@/domain/produce'
import { shortDate } from '@/ussd/i18n'
import { nextRef } from './counters'
import { db, rows } from './db'
import { DomainError, notFound } from './errors'
import { lockOrder, remainingKg } from './orders'
import { getDepot, getFarmer } from './reference'
import { buyers, depots, orderDepots, orders, pledges } from './schema'
import { smsFarmer } from './sms'
import { inWorld } from './uow'

/** Open offers a farmer at this depot can pledge to, with what is still available. */
export async function offersAtDepot(worldId: string, depotId: string) {
  const list = await db
    .select({ order: orders, buyerName: buyers.name, depotName: depots.name })
    .from(orderDepots)
    .innerJoin(orders, eq(orders.id, orderDepots.orderId))
    .innerJoin(buyers, eq(buyers.id, orders.buyerId))
    .innerJoin(depots, eq(depots.id, orderDepots.depotId))
    .where(and(eq(orderDepots.depotId, depotId), eq(orders.worldId, worldId), eq(orders.status, 'OPEN'), sql`${orders.deliverBy} > now()`))
    .orderBy(asc(orders.createdAt))
  const result = []
  for (const row of list) {
    const left = await remainingKg(db, row.order.id, row.order.quantityKg)
    const bagKg = CROPS[row.order.crop].bagKg
    if (left >= bagKg) result.push({ ...row, remainingKg: left, remainingBags: Math.floor(left / bagKg), bagKg })
  }
  return result
}

export interface PledgeInput {
  farmerId: string
  orderId: string
  depotId: string
  bags: number
  channel: 'USSD' | 'APP'
  idempotencyKey: string
}

/** Records a farmer's promise to deliver. Idempotent by key, and never lets an order be over-pledged. */
export async function createPledge(worldId: string, input: PledgeInput) {
  const [existing] = await db.select().from(pledges).where(and(eq(pledges.worldId, worldId), eq(pledges.idempotencyKey, input.idempotencyKey)))
  if (existing) return { pledge: existing, created: false }
  const farmer = await getFarmer(db, worldId, input.farmerId)
  if (!farmer) throw notFound('Farmer')
  const depot = await getDepot(db, worldId, input.depotId)
  if (!depot) throw notFound('Depot')
  return inWorld(worldId, async (u) => {
    const order = await lockOrder(u.tx, worldId, input.orderId)
    if (!order) throw notFound('Order')
    if (order.status !== 'OPEN' || order.deliverBy < new Date()) throw new DomainError('ORDER_CLOSED', `Order ${order.ref} is not taking pledges`)
    const [link] = await rows<{ n: number }>(u.tx, sql`select count(*)::int as n from order_depots where order_id = ${order.id} and depot_id = ${depot.id}`)
    if (link.n === 0) throw new DomainError('WRONG_DEPOT', `Order ${order.ref} is not collecting at ${depot.name} Depot`)
    const bagKg = CROPS[order.crop].bagKg
    const kg = input.bags * bagKg
    const left = await remainingKg(u.tx, order.id, order.quantityKg)
    if (input.bags < 1 || kg > left) throw new DomainError('OVER_PLEDGED', `Only ${Math.floor(left / bagKg)} bags are still needed`)
    const ref = await nextRef(u.tx, worldId, 'AGR')
    const [pledge] = await u.tx
      .insert(pledges)
      .values({ worldId, ref, orderId: order.id, farmerId: farmer.id, depotId: depot.id, bags: input.bags, kgPledged: kg, channel: input.channel, idempotencyKey: input.idempotencyKey })
      .returning()
    await smsFarmer(u, farmer, 'pledge.created', (w) => w.sms.pledged(ref, input.bags, w.crop[order.crop] ?? order.crop, depot.name, shortDate(order.deliverBy)))
    u.emit({
      type: 'pledge.created',
      entityType: 'pledge',
      entityId: pledge.id,
      actor: `farmer:${farmer.phone}`,
      payload: { ref, order: order.ref, farmer: farmer.name, depot: depot.name, bags: input.bags, kg, channel: input.channel },
    })
    return { pledge, created: true }
  })
}

export async function pledgesOfFarmer(worldId: string, farmerId: string) {
  return db
    .select({ pledge: pledges, crop: orders.crop })
    .from(pledges)
    .innerJoin(orders, eq(orders.id, pledges.orderId))
    .where(and(eq(pledges.worldId, worldId), eq(pledges.farmerId, farmerId)))
    .orderBy(desc(pledges.createdAt))
    .limit(10)
}
