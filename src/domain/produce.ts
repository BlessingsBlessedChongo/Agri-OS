import { divRound, toSafeNumber, type Ngwee } from './money'

/**
 * Crops traded on Agri-OS. Moisture is kept in tenths of a percent (125 = 12.5 %) so all arithmetic stays whole.
 * Standards are illustrative trade norms: grain above its standard moisture is partly water, and the buyer pays
 * only for the dry weight (the standard "moisture shrink" adjustment).
 */
export const CROPS = {
  MAIZE: { code: 'MAIZE', name: 'Maize', bagKg: 50, standardMoisture10: 125, maxMoisture10: 180 },
  SOYA: { code: 'SOYA', name: 'Soya beans', bagKg: 50, standardMoisture10: 130, maxMoisture10: 170 },
  GROUNDNUTS: { code: 'GROUNDNUTS', name: 'Groundnuts', bagKg: 50, standardMoisture10: 80, maxMoisture10: 120 },
  SUNFLOWER: { code: 'SUNFLOWER', name: 'Sunflower', bagKg: 50, standardMoisture10: 100, maxMoisture10: 150 },
} as const

export type CropCode = keyof typeof CROPS
export const CROP_CODES = Object.keys(CROPS) as CropCode[]

export function isCropCode(value: string): value is CropCode {
  return value in CROPS
}

export const GRADES = ['A', 'B', 'C'] as const
export type Grade = (typeof GRADES)[number]

/** Price paid for each grade, as a share of the grade-A price (basis points). */
export const GRADE_FACTOR_BP: Record<Grade, number> = { A: 10_000, B: 9_500, C: 8_800 }

export function isGrade(value: string): value is Grade {
  return (GRADES as readonly string[]).includes(value)
}

/** True when `grade` is at least as good as `minimum` (A is best). */
export function meetsMinimum(grade: Grade, minimum: Grade): boolean {
  return GRADES.indexOf(grade) <= GRADES.indexOf(minimum)
}

/** Dry weight the buyer pays for: net × (100 − moisture) ÷ (100 − standard) once moisture is above the standard. */
export function payableGrams(netGrams: number, moisture10: number, crop: CropCode): number {
  const { standardMoisture10 } = CROPS[crop]
  if (moisture10 <= standardMoisture10) return netGrams
  return toSafeNumber(divRound(BigInt(netGrams) * BigInt(1000 - moisture10), BigInt(1000 - standardMoisture10)))
}

/** payable kg × price per kg × grade factor, rounded half up to the ngwee. */
export function produceValue(payable: number, pricePerKgNgwee: number, grade: Grade): Ngwee {
  return toSafeNumber(
    divRound(BigInt(payable) * BigInt(pricePerKgNgwee) * BigInt(GRADE_FACTOR_BP[grade]), 1_000n * 10_000n),
  )
}

export interface DeliveryAssessment {
  accepted: boolean
  reason: string | null
  payableGrams: number
  gradeFactorBp: number
  amount: Ngwee
}

export function assessDelivery(input: {
  crop: CropCode
  netGrams: number
  moisture10: number
  grade: Grade
  minimumGrade: Grade
  pricePerKgNgwee: number
}): DeliveryAssessment {
  const crop = CROPS[input.crop]
  const reject = (reason: string): DeliveryAssessment => ({ accepted: false, reason, payableGrams: 0, gradeFactorBp: 0, amount: 0 })
  if (!Number.isSafeInteger(input.netGrams) || input.netGrams <= 0) return reject('No weight was recorded')
  if (!Number.isSafeInteger(input.moisture10) || input.moisture10 < 0) return reject('Moisture reading is missing')
  if (input.moisture10 > crop.maxMoisture10) {
    return reject(`Too wet: ${input.moisture10 / 10}% moisture (the limit is ${crop.maxMoisture10 / 10}%)`)
  }
  if (!meetsMinimum(input.grade, input.minimumGrade)) {
    return reject(`Grade ${input.grade} is below the buyer's minimum of grade ${input.minimumGrade}`)
  }
  const payable = payableGrams(input.netGrams, input.moisture10, input.crop)
  return {
    accepted: true,
    reason: null,
    payableGrams: payable,
    gradeFactorBp: GRADE_FACTOR_BP[input.grade],
    amount: produceValue(payable, input.pricePerKgNgwee, input.grade),
  }
}

export function bagPrice(pricePerKgNgwee: number, crop: CropCode): Ngwee {
  return pricePerKgNgwee * CROPS[crop].bagKg
}

/** 401 200 g → "401.2 kg"; 14 300 000 g → "14.3 t". */
export function formatWeight(grams: number): string {
  const kg = grams / 1000
  if (Math.abs(kg) >= 1000) return `${(kg / 1000).toFixed(kg >= 100_000 ? 0 : 1).replace(/\.0$/, '')} t`
  return `${kg.toFixed(1).replace(/\.0$/, '')} kg`
}
