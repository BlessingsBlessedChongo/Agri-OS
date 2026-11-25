import type { Ngwee } from './money'
import type { Grade } from './produce'

/**
 * A farmer's trade record, scored 0–100 from what Agri-OS has actually seen them do. Every point is explained, so a
 * farmer (or a lender they share it with) can see why the score is what it is and what would raise it.
 */
export interface CreditInput {
  now: Date
  sales: ReadonlyArray<{ at: Date; grams: number; amount: Ngwee; grade: Grade | null }>
  pledgedKg: number
  deliveredKg: number
  firstTradeAt: Date | null
  /** What a typical farmer in the same district sold over the last 12 months. */
  districtMedianYearGrams: number
}

export type CreditBand = 'BUILDING' | 'FAIR' | 'GOOD' | 'STRONG'

export interface CreditFactor {
  key: 'reliability' | 'volume' | 'consistency' | 'quality' | 'tenure'
  label: string
  points: number
  max: number
  detail: string
}

export interface CreditResult {
  score: number
  band: CreditBand
  factors: CreditFactor[]
  salesCount: number
  yearAmount: Ngwee
  yearGrams: number
  reliabilityPct: number | null
  earlyPaymentEligible: boolean
}

const YEAR_MS = 365 * 24 * 60 * 60 * 1000
const MONTH_MS = YEAR_MS / 12

export function bandFor(score: number): CreditBand {
  if (score >= 80) return 'STRONG'
  if (score >= 60) return 'GOOD'
  if (score >= 40) return 'FAIR'
  return 'BUILDING'
}

const tonnes = (grams: number) => `${(grams / 1_000_000).toFixed(1)} t`

export function scoreFarmer(input: CreditInput): CreditResult {
  const since = input.now.getTime() - YEAR_MS
  const year = input.sales.filter((s) => s.at.getTime() >= since && s.at.getTime() <= input.now.getTime())
  const yearGrams = year.reduce((a, s) => a + s.grams, 0)
  const yearAmount = year.reduce((a, s) => a + s.amount, 0)

  // Reliability: did they deliver what they promised? No promises yet earns a neutral 60 %.
  const ratio = input.pledgedKg > 0 ? Math.min(1, input.deliveredKg / input.pledgedKg) : null
  const reliability: CreditFactor = {
    key: 'reliability',
    label: 'Keeps promises',
    max: 35,
    points: Math.round(35 * (ratio ?? 0.6)),
    detail:
      ratio === null
        ? 'No pledges yet, so this starts in the middle.'
        : `Delivered ${Math.round(ratio * 100)}% of what was pledged (${tonnes(input.deliveredKg * 1000)} of ${tonnes(input.pledgedKg * 1000)}).`,
  }

  const median = Math.max(1, input.districtMedianYearGrams)
  const volumeRatio = yearGrams / median
  const volume: CreditFactor = {
    key: 'volume',
    label: 'Volume sold',
    max: 20,
    points: Math.round(20 * Math.min(1, volumeRatio / 1.5)),
    detail: `${tonnes(yearGrams)} in 12 months, ${volumeRatio >= 1 ? `${volumeRatio.toFixed(1)}× ` : `${Math.round(volumeRatio * 100)}% of `}a typical farmer in the district.`,
  }

  const months = new Set(year.map((s) => `${s.at.getUTCFullYear()}-${s.at.getUTCMonth()}`)).size
  const consistency: CreditFactor = {
    key: 'consistency',
    label: 'Sells regularly',
    max: 20,
    points: Math.round(20 * Math.min(1, months / 6)),
    detail: `Sold in ${months} of the last 12 months (6 or more earns full points).`,
  }

  const graded = year.filter((s) => s.grade)
  const gradedGrams = graded.reduce((a, s) => a + s.grams, 0)
  const gradeAGrams = graded.filter((s) => s.grade === 'A').reduce((a, s) => a + s.grams, 0)
  const gradeBGrams = graded.filter((s) => s.grade === 'B').reduce((a, s) => a + s.grams, 0)
  const qualityShare = gradedGrams > 0 ? (gradeAGrams + 0.5 * gradeBGrams) / gradedGrams : 0
  const quality: CreditFactor = {
    key: 'quality',
    label: 'Quality',
    max: 15,
    points: Math.round(15 * qualityShare),
    detail: gradedGrams > 0 ? `${Math.round((gradeAGrams / gradedGrams) * 100)}% graded A, ${Math.round((gradeBGrams / gradedGrams) * 100)}% graded B.` : 'No graded deliveries yet.',
  }

  const tenureMonths = input.firstTradeAt ? Math.max(0, (input.now.getTime() - input.firstTradeAt.getTime()) / MONTH_MS) : 0
  const tenure: CreditFactor = {
    key: 'tenure',
    label: 'Time trading',
    max: 10,
    points: Math.round(10 * Math.min(1, tenureMonths / 24)),
    detail: input.firstTradeAt ? `First sale ${Math.floor(tenureMonths)} months ago (24 earns full points).` : 'No sales yet.',
  }

  const factors = [reliability, volume, consistency, quality, tenure]
  const score = Math.max(0, Math.min(100, factors.reduce((a, f) => a + f.points, 0)))
  return {
    score,
    band: bandFor(score),
    factors,
    salesCount: year.length,
    yearAmount,
    yearGrams,
    reliabilityPct: ratio === null ? null : Math.round(ratio * 100),
    earlyPaymentEligible: score >= 60 && year.length >= 3,
  }
}
