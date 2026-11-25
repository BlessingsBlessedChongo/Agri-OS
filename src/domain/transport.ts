import { divRound, toSafeNumber, type Ngwee } from './money'

/** Haulage is priced per tonne-kilometre: grams × km × rate ÷ 1 000 000. */
export function transportFee(grams: number, km: number, rateNgweePerTonneKm: number): Ngwee {
  return toSafeNumber(divRound(BigInt(grams) * BigInt(km) * BigInt(rateNgweePerTonneKm), 1_000_000n))
}

/** Allowance for dust and handling between the depot scale and the plant weighbridge: 0.5 %. */
export const TRANSIT_TOLERANCE_BP = 50

export interface TransitCheck {
  depotGrams: number
  arrivedGrams: number
  /** arrived − depot: negative means produce went missing on the road. */
  varianceGrams: number
  varianceBp: number
  toleranceGrams: number
  /** Loss beyond the allowance; the transporter answers for it. */
  chargeableLossGrams: number
  withinTolerance: boolean
}

export function checkTransit(depotGrams: number, arrivedGrams: number): TransitCheck {
  const varianceGrams = arrivedGrams - depotGrams
  const toleranceGrams = Math.floor((depotGrams * TRANSIT_TOLERANCE_BP) / 10_000)
  const loss = Math.max(0, -varianceGrams)
  const chargeableLossGrams = Math.max(0, loss - toleranceGrams)
  const varianceBp = depotGrams === 0 ? 0 : Math.round((varianceGrams * 10_000) / depotGrams)
  return { depotGrams, arrivedGrams, varianceGrams, varianceBp, toleranceGrams, chargeableLossGrams, withinTolerance: chargeableLossGrams === 0 }
}
