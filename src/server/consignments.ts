import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { transportFee } from '@/domain/transport'
import { nextRef } from './counters'
import { db, rows } from './db'
import { DomainError, notFound } from './errors'
import { lockOrder } from './orders'
import { getDepot, getTransporter } from './reference'
import { buyers, consignments, deliveries, depots, orderDepots, orders, transporters, weighbridgeReadings } from './schema'
import { inWorld } from './uow'

export const dispatchInput = z.object({ orderId: z.uuid(), depotId: z.uuid(), transporterId: z.uuid() })

/** Loads what the depot has received for an order onto a truck (oldest first, up to the truck's capacity). */
export async function dispatchConsignment(worldId: string, input: z.infer<typeof dispatchInput>) {
  const transporter = await getTransporter(db, worldId, input.transporterId)
  if (!transporter) throw notFound('Transporter')
  const depot = await getDepot(db, worldId, input.depotId)
  if (!depot) throw notFound('Depot')
  return inWorld(worldId, async (u) => {
    const order = await lockOrder(u.tx, worldId, input.orderId)
    if (!order) throw notFound('Order')
    const [link] = await u.tx.select().from(orderDepots).where(and(eq(orderDepots.orderId, order.id), eq(orderDepots.depotId, depot.id)))
    if (!link) throw new DomainError('WRONG_DEPOT', `Order ${order.ref} is not collecting at ${depot.name} Depot`)
    const waiting = await rows<{ id: string; net_grams: number }>(
      u.tx,
      sql`select id, net_grams from deliveries
          where order_id = ${order.id} and depot_id = ${depot.id} and status = 'RECEIVED' and consignment_id is null
          order by recorded_at, id for update`,
    )
    if (waiting.length === 0) throw new DomainError('NOTHING_TO_SHIP', `Nothing received at ${depot.name} Depot is waiting for a truck`)
    const capacity = transporter.capacityKg * 1000
    const picked: string[] = []
    let load = 0
    for (const d of waiting) {
      if (picked.length > 0 && load + d.net_grams > capacity) break
      picked.push(d.id)
      load += d.net_grams
    }
    const ref = await nextRef(u.tx, worldId, 'CON', 3)
    const fee = transportFee(load, link.distanceKm, transporter.rateNgweePerTonneKm)
    const [consignment] = await u.tx
      .insert(consignments)
      .values({ worldId, ref, orderId: order.id, depotId: depot.id, transporterId: transporter.id, truckReg: transporter.truckReg, depotGrams: load, distanceKm: link.distanceKm, transportFeeNgwee: fee })
      .returning()
    await u.tx.update(deliveries).set({ status: 'LOADED', consignmentId: consignment.id }).where(inArray(deliveries.id, picked))
    u.emit({
      type: 'consignment.dispatched',
      entityType: 'consignment',
      entityId: consignment.id,
      actor: `depot:${depot.code}`,
      payload: { ref, order: order.ref, depot: depot.name, transporter: transporter.name, truck: transporter.truckReg, depotGrams: load, deliveries: picked.length, distanceKm: link.distanceKm, transportFeeNgwee: fee, leftAtDepot: waiting.length - picked.length },
    })
    return consignment
  })
}

/** Trucks heading for (or standing at) a buyer's weighbridge. */
export async function weighbridgeQueue(worldId: string, buyerId?: string) {
  const list = await db
    .select({ consignment: consignments, orderRef: orders.ref, crop: orders.crop, buyerId: orders.buyerId, buyerCode: buyers.code, buyerName: buyers.name, depotName: depots.name, transporterName: transporters.name, tareKg: transporters.tareKg })
    .from(consignments)
    .innerJoin(orders, eq(orders.id, consignments.orderId))
    .innerJoin(buyers, eq(buyers.id, orders.buyerId))
    .innerJoin(depots, eq(depots.id, consignments.depotId))
    .innerJoin(transporters, eq(transporters.id, consignments.transporterId))
    .where(buyerId ? and(eq(consignments.worldId, worldId), eq(orders.buyerId, buyerId)) : eq(consignments.worldId, worldId))
    .orderBy(desc(consignments.dispatchedAt))
    .limit(30)
  const ids = list.map((l) => l.consignment.id)
  const readings = ids.length ? await db.select().from(weighbridgeReadings).where(inArray(weighbridgeReadings.consignmentId, ids)) : []
  return list.map((l) => ({ ...l, readings: readings.filter((r) => r.consignmentId === l.consignment.id) }))
}
