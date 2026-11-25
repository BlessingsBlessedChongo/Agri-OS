import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { canonicalJson, eventHash, GENESIS_HASH, verifyChain, type ChainEvent } from '@/domain/chain'
import { scoreFarmer } from '@/domain/credit'
import { median, priceBelowMarket, transitLoss } from '@/domain/risk'

function chain(n: number) {
  const events: Array<ChainEvent & { hash: string }> = []
  let prev = GENESIS_HASH
  for (let seq = 1; seq <= n; seq++) {
    const e: ChainEvent = { worldId: 'w', seq, type: 'payout.succeeded', entityType: 'payout', entityId: `p${seq}`, actor: 'zamtel', payload: { amountNgwee: seq * 1000 }, occurredAt: new Date(1_700_000_000_000 + seq), prevHash: prev }
    const hash = eventHash(e)
    events.push({ ...e, hash })
    prev = hash
  }
  return events
}

describe('audit chain', () => {
  it('verifies an untouched chain', () => {
    expect(verifyChain(chain(20))).toMatchObject({ ok: true, checked: 20, headSeq: 20 })
  })

  it('points at the exact event whose contents were changed', () => {
    const events = chain(20)
    events[11] = { ...events[11], payload: { amountNgwee: 999_999 } }
    expect(verifyChain(events).problem).toMatchObject({ seq: 12, kind: 'CONTENT_CHANGED' })
  })

  it('notices a replaced or deleted event', () => {
    const events = chain(10)
    expect(verifyChain([...events.slice(0, 4), ...events.slice(5)]).problem).toMatchObject({ seq: 5, kind: 'SEQUENCE_GAP' })
    const forged = { ...events[4], hash: 'f'.repeat(64) }
    expect(verifyChain([...events.slice(0, 4), forged, ...events.slice(5)]).problem?.seq).toBe(5)
  })

  it('hashes the same data the same way regardless of key order (jsonb reorders keys)', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string({ maxLength: 6 }), fc.oneof(fc.integer(), fc.string(), fc.boolean())), (obj) => {
        const reversed = Object.fromEntries(Object.entries(obj).reverse())
        expect(canonicalJson(reversed)).toBe(canonicalJson(obj))
      }),
    )
  })
})

describe('credit record', () => {
  const now = new Date('2026-11-25T10:00:00Z')
  const month = (m: number) => new Date(Date.UTC(2026, m, 10))

  it('explains every point and stays within 0–100', () => {
    const r = scoreFarmer({
      now,
      sales: [5, 6, 7, 8, 9, 10].map((m) => ({ at: month(m), grams: 900_000, amount: 540_000, grade: 'A' as const })),
      pledgedKg: 5000,
      deliveredKg: 4800,
      firstTradeAt: new Date('2024-06-01T00:00:00Z'),
      districtMedianYearGrams: 4_000_000,
    })
    expect(r.score).toBeGreaterThanOrEqual(80)
    expect(r.band).toBe('STRONG')
    expect(r.factors.reduce((a, f) => a + f.points, 0)).toBe(r.score)
    expect(r.factors.every((f) => f.points <= f.max && f.detail.length > 10)).toBe(true)
  })

  it('starts a newcomer in the middle on reliability, not at zero', () => {
    const r = scoreFarmer({ now, sales: [], pledgedKg: 0, deliveredKg: 0, firstTradeAt: null, districtMedianYearGrams: 4_000_000 })
    expect(r.factors.find((f) => f.key === 'reliability')!.points).toBe(21)
    expect(r.band).toBe('BUILDING')
    expect(r.earlyPaymentEligible).toBe(false)
  })
})

describe('risk rules', () => {
  it('flags a price well under the district median, with the evidence', () => {
    const f = priceBelowMarket({ invoiceId: 'i1', district: 'Lundazi', crop: 'Soya', pricePerKgNgwee: 600, medianPerKgNgwee: 950, sampleSize: 30 })
    expect(f).toMatchObject({ type: 'PRICE_BELOW_MARKET', severity: 'HIGH' })
    expect(priceBelowMarket({ invoiceId: 'i2', district: 'Lundazi', crop: 'Soya', pricePerKgNgwee: 900, medianPerKgNgwee: 950, sampleSize: 30 })).toBeNull()
    expect(priceBelowMarket({ invoiceId: 'i3', district: 'Lundazi', crop: 'Soya', pricePerKgNgwee: 100, medianPerKgNgwee: 950, sampleSize: 2 })).toBeNull()
  })

  it('flags produce missing in transit beyond the allowance', () => {
    expect(transitLoss({ consignmentId: 'c', ref: 'CON-001', depotGrams: 10_000_000, arrivedGrams: 9_960_000, toleranceGrams: 50_000 })).toBeNull()
    expect(transitLoss({ consignmentId: 'c', ref: 'CON-001', depotGrams: 10_000_000, arrivedGrams: 9_700_000, toleranceGrams: 50_000 })?.severity).toBe('HIGH')
  })

  it('takes a real observed value as the median', () => {
    expect(median([5, 1, 3, 2])).toBe(2)
    expect(median([])).toBe(0)
  })
})
