import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { formatWeight } from '@/domain/produce'
import { transitLoss } from '@/domain/risk'
import { checkTransit } from '@/domain/transport'
import { deviceIdFor, verifyReading } from '@/integrations/weighbridge/device'
import { rows } from './db'
import { DomainError, notFound } from './errors'
import { raiseFlag } from './risk'
import { buyers, consignments, depots, orders, weighbridgeReadings } from './schema'
import { settleConsignmentTx } from './settlement'
import { inWorld } from './uow'

export const readingInput = z.object({
  reading: z.object({
    deviceId: z.string().min(3).max(40),
    consignmentId: z.uuid(),
    kind: z.enum(['GROSS', 'TARE']),
    grams: z.number().int().positive().max(80_000_000),
    readAt: z.string().min(10).max(40),
    nonce: z.string().min(8).max(64),
  }),
  signature: z.string().regex(/^[0-9a-f]{64}$/, 'signature must be 64 hex characters'),
})

/**
 * Accepts one signed weighbridge reading. When the truck has been weighed loaded (GROSS) and empty (TARE), the
 * arrived weight is compared with what the depot loaded, and the truck is settled in the same transaction.
 */
export async function submitReading(worldId: string, input: z.infer<typeof readingInput>) {
  const { reading, signature } = input
  if (!verifyReading(reading, signature)) {
    throw new DomainError('UNSIGNED_READING', 'This weight is not signed by a known weighbridge. Weights must come from the device; they cannot be typed in.', 422)
  }
  return inWorld(worldId, async (u) => {
    const [locked] = await rows<{ id: string }>(u.tx, sql`select id from consignments where id = ${reading.consignmentId} and world_id = ${worldId} for update`)
    if (!locked) throw notFound('Truck')
    const [row] = await u.tx
      .select({ consignment: consignments, buyerCode: buyers.code, orderRef: orders.ref, depotDistrict: depots.districtId })
      .from(consignments)
      .innerJoin(orders, eq(orders.id, consignments.orderId))
      .innerJoin(buyers, eq(buyers.id, orders.buyerId))
      .innerJoin(depots, eq(depots.id, consignments.depotId))
      .where(eq(consignments.id, reading.consignmentId))
    const c = row.consignment
    if (reading.deviceId !== deviceIdFor(row.buyerCode)) throw new DomainError('WRONG_DEVICE', 'This reading comes from a different plant’s weighbridge', 422)

    const [existing] = await u.tx.select().from(weighbridgeReadings).where(and(eq(weighbridgeReadings.consignmentId, c.id), eq(weighbridgeReadings.kind, reading.kind)))
    if (existing) {
      if (existing.nonce === reading.nonce) return { consignmentId: c.id, status: c.status, duplicate: true }
      throw new DomainError('ALREADY_WEIGHED', `Truck ${c.ref} already has a ${reading.kind === 'GROSS' ? 'loaded' : 'empty'} weight`)
    }
    if (c.status !== 'IN_TRANSIT') throw new DomainError('NOT_IN_TRANSIT', `Truck ${c.ref} is ${c.status.toLowerCase().replace('_', ' ')}`)
    if (reading.kind === 'TARE') {
      const [gross] = await u.tx.select().from(weighbridgeReadings).where(and(eq(weighbridgeReadings.consignmentId, c.id), eq(weighbridgeReadings.kind, 'GROSS')))
      if (!gross) throw new DomainError('WEIGH_LOADED_FIRST', 'Weigh the truck loaded (gross) before weighing it empty (tare)', 422)
    }
    await u.tx.insert(weighbridgeReadings).values({ worldId, consignmentId: c.id, kind: reading.kind, grams: reading.grams, deviceId: reading.deviceId, nonce: reading.nonce, signature, readAt: new Date(reading.readAt) })
    u.emit({ type: 'weighbridge.read', entityType: 'consignment', entityId: c.id, actor: `device:${reading.deviceId}`, payload: { ref: c.ref, kind: reading.kind, grams: reading.grams, signed: true } })

    if (reading.kind === 'GROSS') return { consignmentId: c.id, status: c.status, duplicate: false }

    const [gross] = await u.tx.select().from(weighbridgeReadings).where(and(eq(weighbridgeReadings.consignmentId, c.id), eq(weighbridgeReadings.kind, 'GROSS')))
    const arrived = gross.grams - reading.grams
    if (arrived <= 0) throw new DomainError('BAD_WEIGHTS', 'The empty truck weighs more than the loaded one', 422)
    const transit = checkTransit(c.depotGrams, arrived)
    await u.tx.update(consignments).set({ status: 'WEIGHED', arrivedGrams: arrived, varianceGrams: transit.varianceGrams, weighedAt: new Date() }).where(eq(consignments.id, c.id))
    u.emit({
      type: 'consignment.weighed',
      entityType: 'consignment',
      entityId: c.id,
      actor: `device:${reading.deviceId}`,
      payload: { ref: c.ref, order: row.orderRef, depotGrams: c.depotGrams, arrivedGrams: arrived, varianceGrams: transit.varianceGrams, varianceBp: transit.varianceBp, withinTolerance: transit.withinTolerance, summary: `${formatWeight(arrived)} arrived of ${formatWeight(c.depotGrams)} loaded` },
    })
    const finding = transitLoss({ consignmentId: c.id, ref: c.ref, depotGrams: c.depotGrams, arrivedGrams: arrived, toleranceGrams: transit.toleranceGrams })
    if (finding) await raiseFlag(u, finding, row.depotDistrict)
    const settlement = await settleConsignmentTx(u, c.id)
    return { consignmentId: c.id, status: settlement ? 'SETTLED' : 'HELD', duplicate: false, transit }
  })
}
