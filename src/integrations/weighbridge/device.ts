import { randomBytes } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { canonicalJson } from '@/domain/chain'
import { db, rows } from '@/server/db'
import { buyers, consignments, orders, transporters } from '@/server/schema'
import { derivedSecret, hmacHex, safeEqual } from '@/server/signing'
import { getWorld } from '@/server/world'

/**
 * Weighbridge readings are signed by the device (an HMAC with a key only the device and Agri-OS share), so a weight
 * cannot be typed in by hand or edited on the way: an unsigned or altered reading is refused.
 */
export interface WeighbridgeReading {
  deviceId: string
  consignmentId: string
  kind: 'GROSS' | 'TARE'
  grams: number
  readAt: string
  nonce: string
}

export const deviceIdFor = (buyerCode: string) => `WB-${buyerCode}`

export function signReading(reading: WeighbridgeReading): string {
  return hmacHex(derivedSecret(`weighbridge:${reading.deviceId}`), canonicalJson(reading))
}

export function verifyReading(reading: WeighbridgeReading, signature: string): boolean {
  return safeEqual(signReading(reading), signature)
}

/** Weighbridges read in 10 kg steps. */
const RESOLUTION_GRAMS = 10_000
const roundTo = (grams: number) => Math.round(grams / RESOLUTION_GRAMS) * RESOLUTION_GRAMS

/**
 * The simulated device at the buyer's plant. GROSS = loaded truck, TARE = empty truck after unloading.
 * The load that arrives is what the depot loaded, less the world's transit loss, plus the scale's ±0.05 % noise.
 */
export async function simulateReading(worldId: string, consignmentId: string, kind: 'GROSS' | 'TARE', rng: () => number = Math.random) {
  const world = await getWorld(worldId)
  if (!world) return null
  const [row] = await db
    .select({ consignment: consignments, tareKg: transporters.tareKg, buyerCode: buyers.code })
    .from(consignments)
    .innerJoin(transporters, eq(transporters.id, consignments.transporterId))
    .innerJoin(orders, eq(orders.id, consignments.orderId))
    .innerJoin(buyers, eq(buyers.id, orders.buyerId))
    .where(eq(consignments.id, consignmentId))
  if (!row || row.consignment.worldId !== worldId) return null
  // The same truck weighs the same empty: derive its tare noise from the consignment so retries agree.
  const [{ seed }] = await rows<{ seed: number }>(db, sql`select abs(hashtext(${consignmentId}))::int % 1000 as seed`)
  const tareGrams = row.tareKg * 1000 + (seed - 500) * 20
  const noise = 1 + (rng() - 0.5) * 0.001
  const arrived = row.consignment.depotGrams * (1 - world.chaos.transitLossBp / 10_000) * noise
  const grams = kind === 'TARE' ? roundTo(tareGrams) : roundTo(tareGrams + arrived)
  const reading: WeighbridgeReading = { deviceId: deviceIdFor(row.buyerCode), consignmentId, kind, grams, readAt: new Date().toISOString(), nonce: randomBytes(8).toString('hex') }
  return { reading, signature: signReading(reading) }
}
