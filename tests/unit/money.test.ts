import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { allocate, applyBasisPoints, divRound, formatKwacha, formatKwachaCompact, parseKwacha, toDecimalString } from '@/domain/money'

describe('money', () => {
  it('rounds half away from zero', () => {
    expect(divRound(5n, 2n)).toBe(3n)
    expect(divRound(-5n, 2n)).toBe(-3n)
    expect(divRound(4n, 3n)).toBe(1n)
    expect(divRound(5n, 3n)).toBe(2n)
  })

  it('applies basis points to the ngwee', () => {
    expect(applyBasisPoints(10_000, 1600)).toBe(1600)
    expect(applyBasisPoints(1, 5000)).toBe(1) // 0.5 ngwee rounds up
    expect(applyBasisPoints(248_000, 100)).toBe(2480)
  })

  it('allocates a total exactly, whatever the weights', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e12 }), fc.array(fc.integer({ min: 0, max: 1e6 }), { minLength: 1, maxLength: 40 }), (total, weights) => {
        const parts = allocate(total, weights)
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total)
        expect(parts.every((p) => Number.isSafeInteger(p) && p >= 0)).toBe(true)
        const sum = weights.reduce((a, b) => a + b, 0)
        if (sum > 0) parts.forEach((p, i) => expect(Math.abs(p - (total * weights[i]) / sum)).toBeLessThanOrEqual(1))
      }),
    )
  })

  it('formats without depending on the locale', () => {
    expect(formatKwacha(123_456_789)).toBe('K1,234,567.89')
    expect(formatKwacha(-50)).toBe('-K0.50')
    expect(formatKwacha(31_000, { decimals: false })).toBe('K310')
    expect(formatKwachaCompact(1_234_567_800)).toBe('K12.3M')
    expect(formatKwachaCompact(84_500_000)).toBe('K845K')
  })

  it('round-trips decimal strings exactly', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99_999_999_999_99 }), (ngwee) => {
        expect(parseKwacha(toDecimalString(ngwee))).toBe(ngwee)
      }),
    )
    expect(parseKwacha('12.5')).toBe(1250)
    expect(() => parseKwacha('12.345')).toThrow()
    expect(() => parseKwacha('1e3')).toThrow()
  })
})
