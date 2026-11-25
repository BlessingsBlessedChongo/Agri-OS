import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { formatKwacha } from '@/domain/money'
import { assessDelivery, formatWeight, GRADES } from '@/domain/produce'
import { splitDeliveries } from '@/domain/risk'
import { nextRef } from './counters'
import { db, rows } from './db'
import { DomainError, notFound } from './errors'
import { lockOrder } from './orders'
import { getDepot, getFarmer } from './reference'
import { raiseFlag } from './risk'
import { deliveries, depots, farmers, orderDepots, orders, pledges } from './schema'
import { smsFarmer } from './sms'
import { inWorld } from './uow'

/** A delivery as the depot device records it. `id` is generated on the device so offline records sync exactly once. */
export const deliveryInput = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  depotId: z.uuid(),
  farmerId: z.uuid(),
  pledgeId: z.uuid().nullish(),
  bags: z.number().int().min(1).max(400),
  netGrams: z.number().int().min(1_000).max(40_000_000),
  moisture10: z.number().int().min(0).max(400),
  grade: z.enum(GRADES),
  scaleMode: z.enum(['SCALE', 'MANUAL']),
  recordedAt: z.coerce.date(),
  recordedOffline: z.boolean().default(false),
})
export type DeliveryInput = z.infer<typeof deliveryInput>

export type SyncResult =
  | { id: string; status: 'created' | 'duplicate'; ref: string; accepted: boolean; amountNgwee: number; reason: string | null }
  | { id: string; status: 'refused'; message: string }

export async function recordDelivery(worldId: string, input: DeliveryInput): Promise<SyncResult> {
  const [existing] = await db.select().from(deliveries).where(eq(deliveries.id, input.id))
  if (existing) {
    if (existing.worldId !== worldId) return { id: input.id, status: 'refused', message: 'This record belongs to another sandbox' }
    return { id: input.id, status: 'duplicate', ref: existing.ref, accepted: existing.status !== 'REJECTED', amountNgwee: existing.amountNgwee, reason: existing.rejectReason }
  }
  const farmer = await getFarmer(db, worldId, input.farmerId)
  if (!farmer) throw notFound('Farmer')
  const depot = await getDepot(db, worldId, input.depotId)
  if (!depot) throw notFound('Depot')
  if (input.recordedAt.getTime() > Date.now() + 5 * 60 * 1000) throw new DomainError('CLOCK', 'The device clock is ahead; check the date on the depot phone', 422)

  return inWorld(worldId, async (u) => {
    const order = await lockOrder(u.tx, worldId, input.orderId)
    if (!order) throw notFound('Order')
    const takingDeliveries = order.status === 'OPEN' || (order.status === 'CLOSED' && order.closedAt && input.recordedAt <= order.closedAt)
    if (!takingDeliveries) throw new DomainError('ORDER_CLOSED', `Order ${order.ref} is not taking deliveries`)
    const [link] = await rows<{ n: number }>(u.tx, sql`select count(*)::int as n from order_depots where order_id = ${order.id} and depot_id = ${depot.id}`)
    if (link.n === 0) throw new DomainError('WRONG_DEPOT', `Order ${order.ref} is not collecting at ${depot.name} Depot`)

    let pledgeId = input.pledgeId ?? null
    if (pledgeId) {
      const [p] = await u.tx.select().from(pledges).where(eq(pledges.id, pledgeId))
      if (!p || p.farmerId !== farmer.id || p.orderId !== order.id) throw new DomainError('WRONG_PLEDGE', 'That pledge is not this farmer’s pledge for this order', 422)
    } else {
      const [p] = await u.tx
        .select({ id: pledges.id })
        .from(pledges)
        .where(and(eq(pledges.orderId, order.id), eq(pledges.farmerId, farmer.id), eq(pledges.depotId, depot.id), eq(pledges.status, 'PLEDGED')))
        .orderBy(asc(pledges.createdAt))
        .limit(1)
      pledgeId = p?.id ?? null
    }

    const assessment = assessDelivery({ crop: order.crop, netGrams: input.netGrams, moisture10: input.moisture10, grade: input.grade, minimumGrade: order.minGrade, pricePerKgNgwee: order.priceNgweePerKg })
    const ref = await nextRef(u.tx, worldId, 'GRN')
    await u.tx.insert(deliveries).values({
      id: input.id,
      worldId,
      ref,
      orderId: order.id,
      depotId: depot.id,
      farmerId: farmer.id,
      pledgeId,
      bags: input.bags,
      netGrams: input.netGrams,
      moisture10: input.moisture10,
      grade: input.grade,
      gradeFactorBp: assessment.gradeFactorBp,
      payableGrams: assessment.payableGrams,
      priceNgweePerKg: order.priceNgweePerKg,
      amountNgwee: assessment.amount,
      status: assessment.accepted ? 'RECEIVED' : 'REJECTED',
      rejectReason: assessment.reason,
      scaleMode: input.scaleMode,
      recordedOffline: input.recordedOffline,
      recordedAt: input.recordedAt,
    })
    if (pledgeId && assessment.accepted) {
      await u.tx
        .update(pledges)
        .set({ kgDelivered: sql`${pledges.kgDelivered} + ${Math.round(input.netGrams / 1000)}`, status: 'DELIVERED' })
        .where(eq(pledges.id, pledgeId))
    }
    if (assessment.accepted) {
      await smsFarmer(u, farmer, 'delivery.received', (w) =>
        w.sms.received(ref, input.bags, formatWeight(input.netGrams), input.grade, depot.name, formatKwacha(assessment.amount)),
      )
    } else {
      await smsFarmer(u, farmer, 'delivery.rejected', (w) => w.sms.rejected(ref, depot.name, assessment.reason ?? ''))
    }
    const lagSeconds = Math.max(0, Math.round((Date.now() - input.recordedAt.getTime()) / 1000))
    u.emit({
      type: assessment.accepted ? 'delivery.received' : 'delivery.rejected',
      entityType: 'delivery',
      entityId: input.id,
      actor: `depot:${depot.code}`,
      payload: {
        ref,
        order: order.ref,
        farmer: farmer.name,
        depot: depot.name,
        bags: input.bags,
        netGrams: input.netGrams,
        moisture10: input.moisture10,
        grade: input.grade,
        payableGrams: assessment.payableGrams,
        amountNgwee: assessment.amount,
        reason: assessment.reason,
        recordedOffline: input.recordedOffline,
        syncedAfterSeconds: input.recordedOffline ? lagSeconds : 0,
      },
    })

    // Several depots on one day for the same farmer is worth a second look.
    const today = await rows<{ depot: string; n: number }>(
      u.tx,
      sql`select d.name as depot, count(*)::int as n from deliveries x join depots d on d.id = x.depot_id
          where x.world_id = ${worldId} and x.farmer_id = ${farmer.id} and x.recorded_at::date = ${input.recordedAt.toISOString().slice(0, 10)}::date
          group by d.name`,
    )
    const finding = splitDeliveries({
      farmerId: farmer.id,
      farmerName: farmer.name,
      day: input.recordedAt.toISOString().slice(0, 10),
      depots: today.map((t) => t.depot),
      deliveries: today.reduce((a, t) => a + t.n, 0),
    })
    if (finding) await raiseFlag(u, finding, farmer.districtId)

    return { id: input.id, status: 'created' as const, ref, accepted: assessment.accepted, amountNgwee: assessment.amount, reason: assessment.reason }
  })
}

/** Syncs a depot device's outbox. Each record stands alone: one refusal never blocks the rest. */
export async function syncDeliveries(worldId: string, items: DeliveryInput[]): Promise<SyncResult[]> {
  const results: SyncResult[] = []
  for (const item of items) {
    try {
      results.push(await recordDelivery(worldId, item))
    } catch (error) {
      const message = error instanceof DomainError || (error as { status?: number })?.status ? (error as Error).message : 'Could not record this delivery'
      if (!(error instanceof DomainError) && !(error as { status?: number })?.status) console.error('[sync] delivery failed', error)
      results.push({ id: item.id, status: 'refused', message })
    }
  }
  return results
}

/** What the depot screen shows: open orders here, who pledged, and today's receipts. */
export async function depotBoard(worldId: string, depotId: string) {
  const depot = await getDepot(db, worldId, depotId)
  if (!depot) return null
  const openOrders = await db
    .select({ order: orders })
    .from(orderDepots)
    .innerJoin(orders, eq(orders.id, orderDepots.orderId))
    .where(and(eq(orderDepots.depotId, depotId), eq(orders.worldId, worldId), inArray(orders.status, ['OPEN', 'CLOSED'])))
    .orderBy(desc(orders.createdAt))
  const orderIds = openOrders.map((o) => o.order.id)
  const expected = orderIds.length
    ? await db
        .select({ pledge: pledges, farmerName: farmers.name, farmerPhone: farmers.phone, farmerCode: farmers.code })
        .from(pledges)
        .innerJoin(farmers, eq(farmers.id, pledges.farmerId))
        .where(and(eq(pledges.depotId, depotId), inArray(pledges.orderId, orderIds)))
        .orderBy(asc(pledges.createdAt))
    : []
  const received = orderIds.length
    ? await db
        .select({ delivery: deliveries, farmerName: farmers.name })
        .from(deliveries)
        .innerJoin(farmers, eq(farmers.id, deliveries.farmerId))
        .where(and(eq(deliveries.depotId, depotId), inArray(deliveries.orderId, orderIds)))
        .orderBy(desc(deliveries.recordedAt))
        .limit(100)
    : []
  const [district] = await db.select({ name: depots.name }).from(depots).where(eq(depots.id, depotId))
  return { depot, districtName: district?.name ?? '', orders: openOrders.map((o) => o.order), expected, received }
}
