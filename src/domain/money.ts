/**
 * Money is always a whole number of ngwee (K1 = 100 ngwee). Floats never touch an amount:
 * multiplication and rounding happen in BigInt, and every result is checked to be a safe integer.
 */
export type Ngwee = number

export function isNgwee(value: unknown): value is Ngwee {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

export function assertNgwee(value: number, label = 'amount'): Ngwee {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a whole number of ngwee (got ${value})`)
  return value
}

/** Integer division, rounding half away from zero. */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError('denominator must be positive')
  const sign = numerator < 0n ? -1n : 1n
  const n = numerator * sign
  return sign * ((n * 2n + denominator) / (denominator * 2n))
}

export function toSafeNumber(value: bigint, label = 'amount'): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`${label} is too large to represent exactly`)
  }
  return Number(value)
}

/** amount × basisPoints ÷ 10 000, rounded half up. 1 600 bp = 16 %, 100 bp = 1 %. */
export function applyBasisPoints(amount: Ngwee, basisPoints: number): Ngwee {
  assertNgwee(amount)
  if (!Number.isSafeInteger(basisPoints)) throw new RangeError('basis points must be a whole number')
  return toSafeNumber(divRound(BigInt(amount) * BigInt(basisPoints), 10_000n))
}

/**
 * Splits a non-negative total into whole-ngwee parts proportional to the weights.
 * The parts always add up to exactly the total (largest-remainder method, ties to the earliest part).
 */
export function allocate(total: Ngwee, weights: readonly number[]): Ngwee[] {
  assertNgwee(total)
  if (total < 0) throw new RangeError('allocate needs a non-negative total')
  if (weights.length === 0) return []
  const big = weights.map((w) => {
    if (!Number.isSafeInteger(w) || w < 0) throw new RangeError('weights must be non-negative whole numbers')
    return BigInt(w)
  })
  let sum = big.reduce((a, b) => a + b, 0n)
  const effective = sum === 0n ? big.map(() => 1n) : big
  if (sum === 0n) sum = BigInt(big.length)
  const t = BigInt(total)
  const raw = effective.map((w) => t * w)
  const parts = raw.map((r) => r / sum)
  let remainder = t - parts.reduce((a, b) => a + b, 0n)
  const order = raw
    .map((r, i) => ({ i, rem: r % sum }))
    .sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : a.i - b.i))
  for (let k = 0; remainder > 0n; k++, remainder--) parts[order[k % order.length].i] += 1n
  return parts.map((p) => toSafeNumber(p))
}

export function sum(values: readonly Ngwee[]): Ngwee {
  let total = 0
  for (const v of values) total = assertNgwee(total + assertNgwee(v), 'sum')
  return total
}

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** K1,234.50 — deterministic (no locale), so server and browser render the same text. */
export function formatKwacha(ngwee: Ngwee, options: { decimals?: boolean } = {}): string {
  assertNgwee(ngwee)
  const sign = ngwee < 0 ? '-' : ''
  const abs = Math.abs(ngwee)
  if (options.decimals === false) return `${sign}K${group(String(Math.round(abs / 100)))}`
  const whole = Math.floor(abs / 100)
  const cents = String(abs % 100).padStart(2, '0')
  return `${sign}K${group(String(whole))}.${cents}`
}

/** K1.2M, K845K, K12,400 — for dashboards. */
export function formatKwachaCompact(ngwee: Ngwee): string {
  const sign = ngwee < 0 ? '-' : ''
  const k = Math.abs(ngwee) / 100
  if (k >= 1_000_000_000) return `${sign}K${trim(k / 1_000_000_000)}B`
  if (k >= 1_000_000) return `${sign}K${trim(k / 1_000_000)}M`
  if (k >= 100_000) return `${sign}K${Math.round(k / 1000)}K`
  return `${sign}K${group(String(Math.round(k)))}`
}

function trim(n: number): string {
  return n >= 100 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, '')
}

/** Parses a decimal kwacha string ("1234.5", "1234.50") into ngwee without floating point. */
export function parseKwacha(text: string): Ngwee {
  const m = /^(-)?(\d{1,13})(?:\.(\d{1,2}))?$/.exec(text.trim())
  if (!m) throw new RangeError(`Not a kwacha amount: "${text}"`)
  const cents = (m[3] ?? '').padEnd(2, '0')
  const value = Number(m[2]) * 100 + Number(cents)
  return m[1] ? -value : value
}

/** 123450 → "1234.50" (what payment APIs expect on the wire). */
export function toDecimalString(ngwee: Ngwee): string {
  assertNgwee(ngwee)
  const sign = ngwee < 0 ? '-' : ''
  const abs = Math.abs(ngwee)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}
