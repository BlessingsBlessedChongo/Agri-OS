import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { computeSettlement, escrowTarget } from '@/domain/settlement'
import { DEFAULT_TAX_RULES, type TaxRule } from '@/domain/tax'
import { checkTransit } from '@/domain/transport'

const delivery = fc.record({
  farmer: fc.integer({ min: 1, max: 6 }),
  payableGrams: fc.integer({ min: 50_000, max: 3_000_000 }),
  price: fc.integer({ min: 300, max: 2_000 }),
})

const rules = fc.record({
  feeVat: fc.integer({ min: 0, max: 2500 }),
  transportVat: fc.integer({ min: 0, max: 2500 }),
  transportRemit: fc.boolean(),
  produceVat: fc.integer({ min: 0, max: 2000 }),
  wht: fc.integer({ min: 0, max: 1500 }),
  whtOn: fc.boolean(),
})

function ruleSet(r: { feeVat: number; transportVat: number; transportRemit: boolean; produceVat: number; wht: number; whtOn: boolean }): TaxRule[] {
  return DEFAULT_TAX_RULES.map((rule) => {
    if (rule.code === 'VAT_SERVICE_FEE') return { ...rule, rateBp: r.feeVat }
    if (rule.code === 'VAT_TRANSPORT') return { ...rule, rateBp: r.transportVat, collection: r.transportRemit ? 'REMIT' : 'RECORD' }
    if (rule.code === 'VAT_PRODUCE') return { ...rule, rateBp: r.produceVat }
    if (rule.code === 'WHT_PRODUCE') return { ...rule, rateBp: r.wht, enabled: r.whtOn }
    return rule
  })
}

describe('settlement', () => {
  it('always balances, whatever the deliveries, losses and tax rules', () => {
    fc.assert(
      fc.property(
        fc.array(delivery, { minLength: 1, maxLength: 30 }),
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.integer({ min: 0, max: 600 }),
        fc.boolean(),
        rules,
        (items, transportGross, lossBp, vatRegistered, r) => {
          const deliveries = items.map((d, i) => ({ id: `d${i}`, farmerId: `f${d.farmer}`, farmerName: `Farmer ${d.farmer}`, payableGrams: d.payableGrams, amount: Math.round((d.payableGrams * d.price) / 1000) }))
          const loaded = deliveries.reduce((a, d) => a + d.payableGrams, 0)
          const s = computeSettlement({
            order: { id: 'o1', ref: 'ORD-0001', feeBp: 100 },
            deliveries,
            transporter: { id: 't1', name: 'Haulier', vatRegistered },
            transportGross,
            transit: checkTransit(loaded, Math.round(loaded * (1 - lossBp / 10_000))),
            rules: ruleSet(r),
          })
          // 1. The ledger entry balances.
          expect(s.postings.reduce((a, p) => a + p.amount, 0)).toBe(0)
          // 2. What the buyer pays is exactly what farmers, transporter, Agri-OS and ZRA receive.
          const received = s.farmers.reduce((a, f) => a + f.net, 0) + s.transport.payout + s.fee.amount + s.toZra
          expect(received).toBe(s.buyerTotal)
          // 3. Farmers are paid in full for what the depot weighed (only a withholding, if switched on, comes off).
          for (const f of s.farmers) expect(f.net).toBe(f.gross - f.withholding + f.vatToSeller)
          // 4. A transit deduction never exceeds the haulage fee, and no amount is negative.
          expect(s.transport.deduction).toBeLessThanOrEqual(transportGross)
          expect([s.buyerTotal, s.toZra, s.fee.amount, s.transport.payout, ...s.farmers.map((f) => f.net)].every((n) => n >= 0 && Number.isSafeInteger(n))).toBe(true)
        },
      ),
      { numRuns: 400 },
    )
  })

  it('works through a realistic truck by hand', () => {
    const s = computeSettlement({
      order: { id: 'o1', ref: 'ORD-0001', feeBp: 100 },
      deliveries: [
        { id: 'd1', farmerId: 'mary', farmerName: 'Mary Banda', payableGrams: 400_000, amount: 248_000 },
        { id: 'd2', farmerId: 'john', farmerName: 'John Phiri', payableGrams: 600_000, amount: 353_400 },
      ],
      transporter: { id: 't1', name: 'Luangwa Haulage', vatRegistered: true },
      transportGross: 100_000,
      transit: checkTransit(1_000_000, 998_000),
      rules: DEFAULT_TAX_RULES,
    })
    expect(s.produce.total).toBe(601_400)
    expect(s.fee.amount).toBe(6014) // 1 %
    expect(s.fee.taxed.vat).toBe(962) // 16 % of the fee, to ZRA
    expect(s.transport.taxed.vat).toBe(16_000) // recorded, paid to the VAT-registered haulier
    expect(s.toZra).toBe(962)
    expect(s.buyerTotal).toBe(601_400 + 100_000 + 16_000 + 6014 + 962)
    expect(s.farmers.find((f) => f.farmerId === 'mary')!.net).toBe(248_000)
  })

  it('asks for enough escrow to cover the worst case', () => {
    const target = escrowTarget({ quantityKg: 12_000, pricePerKgNgwee: 620, feeBp: 100, maxTransportNgwee: 2_000_000, rules: DEFAULT_TAX_RULES })
    expect(target).toBeGreaterThan(12_000 * 620 + 2_000_000)
    expect(target % 100).toBe(0)
  })
})
