import { describe, expect, it } from 'vitest'
import { cleanName, MAX_SCREEN, runUssd, type OfferView, type UssdServices } from '@/ussd/engine'
import { LANGS, type Lang } from '@/ussd/i18n'

/** Worst-case data: long names, big numbers, full lists. */
const offers: OfferView[] = [
  { orderId: 'o1', crop: 'GROUNDNUTS', minGrade: 'B', priceNgweePerKg: 1580, bagKg: 50, buyerName: 'Chibombo Grain Processors', depotId: 'd1', depotName: 'Kapiri Mposhi', deliverBy: new Date('2026-12-30T10:00:00Z'), remainingBags: 200 },
  { orderId: 'o2', crop: 'SUNFLOWER', minGrade: 'A', priceNgweePerKg: 755, bagKg: 50, buyerName: 'Copperbelt Feeds & Foods', depotId: 'd1', depotName: 'Kapiri Mposhi', deliverBy: new Date('2026-12-30T10:00:00Z'), remainingBags: 120 },
  { orderId: 'o3', crop: 'MAIZE', minGrade: 'C', priceNgweePerKg: 620, bagKg: 50, buyerName: 'Kafue Plains Milling', depotId: 'd1', depotName: 'Kapiri Mposhi', deliverBy: new Date('2026-12-30T10:00:00Z'), remainingBags: 80 },
  { orderId: 'o4', crop: 'SOYA', minGrade: 'A', priceNgweePerKg: 1020, bagKg: 50, buyerName: 'Zambezi Valley Exports', depotId: 'd1', depotName: 'Kapiri Mposhi', deliverBy: new Date('2026-12-30T10:00:00Z'), remainingBags: 40 },
]

function services(options: { registered: boolean; offers?: OfferView[]; pledgeOk?: boolean } = { registered: true }) {
  const calls: string[] = []
  const s: UssdServices = {
    serviceCode: '*384*123#',
    host: 'agri-os.example.com',
    farmer: options.registered ? { id: 'f1', name: 'Loveness Simuyemba', depotId: 'd1', depotName: 'Kapiri Mposhi' } : null,
    depots: async () => ['Chipata', 'Katete', 'Petauke', 'Mkushi', 'Choma', 'Mpongwe', 'Kapiri Mposhi', 'Chibombo'].map((name, i) => ({ id: `d${i}`, name })),
    offers: async () => options.offers ?? offers,
    pledges: async () => [
      { ref: 'AGR-0042', crop: 'GROUNDNUTS', bags: 200, status: 'PLEDGED' as const },
      { ref: 'AGR-0041', crop: 'SUNFLOWER', bags: 120, status: 'DELIVERED' as const },
      { ref: 'AGR-0040', crop: 'MAIZE', bags: 80, status: 'EXPIRED' as const },
      { ref: 'AGR-0039', crop: 'SOYA', bags: 40, status: 'CANCELLED' as const },
    ],
    payments: async () => [1, 2, 3, 4].map((i) => ({ at: new Date(`2026-11-${10 + i}T10:00:00Z`), amountNgwee: 15_800_000 + i, status: (['PAID', 'SENDING', 'RETRYING', 'PAID'] as const)[i - 1] })),
    record: async () => ({ score: 74, band: 'GOOD' as const, salesCount: 14, yearAmountNgwee: 12_345_678_00, reliabilityPct: 96 }),
    register: async (name) => {
      calls.push(`register:${name}`)
      return { id: 'f2', name, depotId: 'd0', depotName: 'Chipata' }
    },
    pledge: async (offer, bags) => {
      calls.push(`pledge:${offer.orderId}:${bags}`)
      return options.pledgeOk === false ? { ok: false } : { ok: true, ref: 'AGR-0043' }
    },
    setLanguage: async (lang) => {
      calls.push(`lang:${lang}`)
    },
    share: async () => {
      calls.push('share')
      return { code: 'K7Q2MX' }
    },
  }
  return { s, calls }
}

const registeredPaths = [[], ['1'], ['1', '9'], ['1', '1'], ['1', '1', '200'], ['1', '1', '999'], ['2'], ['3'], ['4'], ['5'], ['7'], ['1', '1', '200', '1'], ['4', '1'], ['1', '1', '200', '2']]
const newPaths = [[], ['1'], ['2'], ['2', '1'], ['2', '1', 'Loveness Simuyemba'], ['2', '1', '1x'], ['2', '1', 'Loveness Simuyemba', '7'], ['2', '1', 'Loveness Simuyemba', '7', '1'], ['3', '1', 'Loveness Simuyemba', '7', '2']]

describe('USSD screens', () => {
  for (const lang of LANGS) {
    it(`fit on one screen in ${lang}`, async () => {
      for (const path of registeredPaths) {
        const screen = await runUssd(services({ registered: true }).s, path, lang as Lang)
        expect(screen.text.length, `${lang} ${path.join('*')}: ${screen.text}`).toBeLessThanOrEqual(MAX_SCREEN)
      }
      for (const path of newPaths) {
        const screen = await runUssd(services({ registered: false }).s, path, lang as Lang)
        expect(screen.text.length, `${lang} new ${path.join('*')}: ${screen.text}`).toBeLessThanOrEqual(MAX_SCREEN)
      }
    })

    it(`shows the whole offer without cutting lines in ${lang}`, async () => {
      const screen = await runUssd(services({ registered: true }).s, ['1', '1'], lang as Lang)
      expect(screen.text.split('\n')).toHaveLength(7)
    })
  }
})

describe('USSD navigation and actions', () => {
  it('pledges only on the final confirmation', async () => {
    const { s, calls } = services({ registered: true })
    const confirm = await runUssd(s, ['1', '1', '8'], 'en')
    expect(confirm.type).toBe('CON')
    expect(confirm.text).toContain('Pledge 8 bags (400kg) of Groundnuts at K790/bag = K6,320')
    expect(calls).toEqual([])
    const done = await runUssd(s, ['1', '1', '8', '1'], 'en')
    expect(done).toMatchObject({ type: 'END' })
    expect(done.text).toContain('AGR-0043')
    expect(calls).toEqual(['pledge:o1:8'])
  })

  it('says so when the offer filled up in the meantime', async () => {
    const done = await runUssd(services({ registered: true, pledgeOk: false }).s, ['1', '1', '8', '1'], 'en')
    expect(done.text).toMatch(/closed or is full/)
  })

  it('goes back with 0 and home with 00', async () => {
    const { s } = services({ registered: true })
    expect((await runUssd(s, ['1', '1', '0'], 'en')).text).toMatch(/^Offers at/)
    expect((await runUssd(s, ['1', '1', '00'], 'en')).text).toMatch(/^Agri-OS · Loveness/)
  })

  it('pages through offers three at a time', async () => {
    const page2 = await runUssd(services({ registered: true }).s, ['1', '9'], 'en')
    expect(page2.text).toContain('Soya')
    expect(page2.text).not.toContain('9. More')
  })

  it('keeps the screen and explains a bad entry', async () => {
    const screen = await runUssd(services({ registered: true }).s, ['1', '1', '999'], 'en')
    expect(screen.type).toBe('CON')
    expect(screen.text).toMatch(/^Enter a number from 1 to 200\./)
  })

  it('registers a new farmer in the language they chose', async () => {
    const { s, calls } = services({ registered: false })
    const done = await runUssd(s, ['3', '1', 'loveness  simuyemba', '1', '1'], 'en')
    expect(calls).toEqual(['register:Loveness Simuyemba'])
    expect(done.text).toMatch(/^Takulandirani, Loveness!/)
  })

  it('switches language and confirms it on the main menu', async () => {
    const { s, calls } = services({ registered: true })
    const screen = await runUssd(s, ['5', '2'], 'en')
    expect(calls).toEqual(['lang:bem'])
    expect(screen.text).toMatch(/^Ululimi lwasungwa\.\nAgri-OS · Loveness\n1\. Imitengo ya bashita/)
  })

  it('shares the trade record with a code', async () => {
    const screen = await runUssd(services({ registered: true }).s, ['4', '1'], 'nya')
    expect(screen.type).toBe('END')
    expect(screen.text).toContain('K7Q2MX')
  })

  it('accepts real names and refuses junk', () => {
    expect(cleanName("mary  o'neil-banda")).toBe("Mary O'neil-banda")
    expect(cleanName('12345')).toBeNull()
    expect(cleanName('x')).toBeNull()
  })
})
