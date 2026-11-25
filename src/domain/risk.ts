import { formatKwacha } from './money'
import { formatWeight } from './produce'

/**
 * Explained risk flags for ZRA and the operations team. Rules, not a black box: each flag says what was seen,
 * why it matters, and the evidence behind it.
 */
export type RiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH'
export type RiskType = 'PRICE_BELOW_MARKET' | 'TRANSIT_LOSS' | 'SPLIT_DELIVERIES' | 'NEW_FARMER_HIGH_VOLUME' | 'PAYOUT_STUCK'

export interface RiskFinding {
  type: RiskType
  severity: RiskSeverity
  title: string
  explanation: string
  evidence: Record<string, string | number | boolean | null>
  dedupeKey: string
}

/** A price well under the district median can mean an under-declared sale or a farmer being cheated. */
export function priceBelowMarket(input: {
  invoiceId: string
  district: string
  crop: string
  pricePerKgNgwee: number
  medianPerKgNgwee: number
  sampleSize: number
}): RiskFinding | null {
  if (input.sampleSize < 5 || input.medianPerKgNgwee <= 0) return null
  const ratio = input.pricePerKgNgwee / input.medianPerKgNgwee
  if (ratio >= 0.8) return null
  return {
    type: 'PRICE_BELOW_MARKET',
    severity: ratio < 0.65 ? 'HIGH' : 'MEDIUM',
    title: `${input.crop} sold ${Math.round((1 - ratio) * 100)}% below the ${input.district} median`,
    explanation: `Paid ${formatKwacha(input.pricePerKgNgwee)}/kg against a median of ${formatKwacha(input.medianPerKgNgwee)}/kg over ${input.sampleSize} recent sales. Either the sale was under-declared or the farmer was underpaid.`,
    evidence: { invoiceId: input.invoiceId, pricePerKg: input.pricePerKgNgwee, medianPerKg: input.medianPerKgNgwee, sampleSize: input.sampleSize },
    dedupeKey: `price:${input.invoiceId}`,
  }
}

/** Produce that leaves a depot and doesn't arrive is either theft or a scale problem. */
export function transitLoss(input: { consignmentId: string; ref: string; depotGrams: number; arrivedGrams: number; toleranceGrams: number }): RiskFinding | null {
  const loss = input.depotGrams - input.arrivedGrams
  if (loss <= input.toleranceGrams) return null
  const pct = (loss / input.depotGrams) * 100
  return {
    type: 'TRANSIT_LOSS',
    severity: pct >= 2 ? 'HIGH' : 'MEDIUM',
    title: `${formatWeight(loss)} missing from truck ${input.ref}`,
    explanation: `The depot loaded ${formatWeight(input.depotGrams)} but the weighbridge measured ${formatWeight(input.arrivedGrams)} (${pct.toFixed(1)}% short, allowance 0.5%). The value of the loss beyond the allowance was taken off the haulage fee; farmers were paid in full.`,
    evidence: { consignmentId: input.consignmentId, depotGrams: input.depotGrams, arrivedGrams: input.arrivedGrams },
    dedupeKey: `transit:${input.consignmentId}`,
  }
}

/** The same farmer delivering to several depots on one day can be a ghost-farmer or threshold-splitting pattern. */
export function splitDeliveries(input: { farmerId: string; farmerName: string; day: string; depots: string[]; deliveries: number }): RiskFinding | null {
  const distinct = new Set(input.depots).size
  if (distinct < 2 && input.deliveries < 4) return null
  return {
    type: 'SPLIT_DELIVERIES',
    severity: distinct >= 3 ? 'HIGH' : 'MEDIUM',
    title: `${input.farmerName} delivered ${input.deliveries} times on ${input.day}`,
    explanation: `${input.deliveries} deliveries across ${distinct} depot${distinct === 1 ? '' : 's'} in one day. Worth checking that one farmer really grew all of it.`,
    evidence: { farmerId: input.farmerId, day: input.day, depots: [...new Set(input.depots)].join(', '), deliveries: input.deliveries },
    dedupeKey: `split:${input.farmerId}:${input.day}`,
  }
}

/** A brand-new registration selling far more than a typical season is a classic ghost-farmer sign. */
export function newFarmerHighVolume(input: { farmerId: string; farmerName: string; daysRegistered: number; grams: number; districtMedianYearGrams: number }): RiskFinding | null {
  if (input.daysRegistered > 14 || input.districtMedianYearGrams <= 0) return null
  if (input.grams < input.districtMedianYearGrams * 0.6) return null
  return {
    type: 'NEW_FARMER_HIGH_VOLUME',
    severity: 'HIGH',
    title: `New farmer ${input.farmerName} sold ${formatWeight(input.grams)} in ${input.daysRegistered} days`,
    explanation: `Registered ${input.daysRegistered} days ago and already sold ${Math.round((input.grams / input.districtMedianYearGrams) * 100)}% of what a typical farmer in the district sells in a year.`,
    evidence: { farmerId: input.farmerId, grams: input.grams, districtMedianYearGrams: input.districtMedianYearGrams },
    dedupeKey: `newfarmer:${input.farmerId}`,
  }
}

export function payoutStuck(input: { payoutId: string; partyName: string; amount: number; attempts: number; lastError: string | null }): RiskFinding {
  return {
    type: 'PAYOUT_STUCK',
    severity: 'HIGH',
    title: `Payout of ${formatKwacha(input.amount)} to ${input.partyName} needs attention`,
    explanation: `Failed ${input.attempts} times${input.lastError ? ` (last: ${input.lastError})` : ''}. The money is safe in escrow; it was not sent twice.`,
    evidence: { payoutId: input.payoutId, attempts: input.attempts },
    dedupeKey: `payout:${input.payoutId}`,
  }
}

/** Median of a numeric list (lower middle for even counts, so it is always a real observed price). */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) / 2)]
}
