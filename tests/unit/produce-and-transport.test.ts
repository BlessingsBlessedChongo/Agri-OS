import { describe, expect, it } from 'vitest'
import { assessDelivery, formatWeight, payableGrams, produceValue } from '@/domain/produce'
import { checkTransit, transportFee } from '@/domain/transport'
import { roadKm } from '@/domain/geo'

describe('produce', () => {
  it('pays only for dry weight above the standard moisture', () => {
    expect(payableGrams(400_000, 125, 'MAIZE')).toBe(400_000)
    // 14.5% moisture: 400 kg × 85.5 / 87.5 = 390.857 kg
    expect(payableGrams(400_000, 145, 'MAIZE')).toBe(390_857)
  })

  it('values produce by kilogram, price and grade', () => {
    expect(produceValue(400_000, 620, 'A')).toBe(248_000) // K2,480.00
    expect(produceValue(400_000, 620, 'B')).toBe(235_600) // 95 %
  })

  it('refuses wet grain and grades below the buyer’s minimum', () => {
    const base = { crop: 'MAIZE' as const, netGrams: 400_000, minimumGrade: 'B' as const, pricePerKgNgwee: 620 }
    expect(assessDelivery({ ...base, moisture10: 190, grade: 'A' }).accepted).toBe(false)
    expect(assessDelivery({ ...base, moisture10: 120, grade: 'C' }).reason).toMatch(/below the buyer/)
    expect(assessDelivery({ ...base, moisture10: 120, grade: 'B' })).toMatchObject({ accepted: true, amount: 235_600 })
  })

  it('formats weights', () => {
    expect(formatWeight(401_200)).toBe('401.2 kg')
    expect(formatWeight(14_300_000)).toBe('14.3 t')
  })
})

describe('transport', () => {
  it('prices haulage per tonne-kilometre', () => {
    // 14 t × 615 km × K2.30
    expect(transportFee(14_000_000, 615, 230)).toBe(1_980_300)
  })

  it('allows 0.5 % in transit and charges the rest to the transporter', () => {
    expect(checkTransit(10_000_000, 9_960_000)).toMatchObject({ withinTolerance: true, chargeableLossGrams: 0 })
    expect(checkTransit(10_000_000, 9_700_000)).toMatchObject({ withinTolerance: false, chargeableLossGrams: 250_000, varianceBp: -300 })
  })

  it('estimates road distance from coordinates', () => {
    const chipata = { lat: -13.645, lng: 32.646 }
    const kafue = { lat: -15.769, lng: 28.181 }
    expect(roadKm(chipata, kafue)).toBeGreaterThan(550)
    expect(roadKm(chipata, kafue)).toBeLessThan(700)
  })
})
