/**
 * Shared reference data every sandbox starts from: Zambia's districts, six depots, four buyers, four transporters,
 * 48 farmers, and about six months of trade history (signed invoices) across all ten provinces, so the tax-authority
 * view has a real national picture before anyone runs a harvest. Everyone here is fictional.
 *
 *   npm run db:seed            # once (skips if already seeded)
 *   npm run db:seed -- --force # rebuild the reference data (deletes all sandboxes)
 */
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { roadKm } from '../src/domain/geo'
import { produceValue, GRADE_FACTOR_BP, type CropCode, type Grade } from '../src/domain/produce'
import { applyBasisPoints } from '../src/domain/money'
import { priceBelowMarket, transitLoss, newFarmerHighVolume } from '../src/domain/risk'
import { transportFee } from '../src/domain/transport'
import { ZAMBIA_MAP } from '../src/domain/map'
import { closeDb, db, rows } from '../src/server/db'
import { signInvoice } from '../src/server/invoices'
import { seeded } from '../src/server/random'
import { buyers, depots, districts, farmers, invoices, riskFlags, transporters } from '../src/server/schema'
import { PLATFORM } from '../src/server/settlement'
import { ensureLiveWorld } from '../src/server/world'

const rng = seeded(20261125)
const pick = <T,>(list: readonly T[]) => list[Math.floor(rng() * list.length)]
const between = (min: number, max: number) => min + rng() * (max - min)
const int = (min: number, max: number) => Math.floor(between(min, max + 1))

const DEPOTS = [
  { code: 'DEP-CHP', name: 'Chipata', districtId: 'chipata', lat: -13.645, lng: 32.646, operator: 'Chipata District Farmers’ Cooperative', clerkName: 'Ruth Phiri', clerkPhone: '+260955100201' },
  { code: 'DEP-KTE', name: 'Katete', districtId: 'katete', lat: -14.059, lng: 32.042, operator: 'Katete Grain Aggregators', clerkName: 'Joseph Banda', clerkPhone: '+260955100202' },
  { code: 'DEP-PTK', name: 'Petauke', districtId: 'petauke', lat: -14.242, lng: 31.326, operator: 'Petauke Smallholder Union', clerkName: 'Agness Mbewe', clerkPhone: '+260955100203' },
  { code: 'DEP-MKS', name: 'Mkushi', districtId: 'mkushi', lat: -13.62, lng: 29.39, operator: 'Mkushi Farm Block Cooperative', clerkName: 'Davies Mulenga', clerkPhone: '+260955100204' },
  { code: 'DEP-CHM', name: 'Choma', districtId: 'choma', lat: -16.807, lng: 26.983, operator: 'Choma Farmers’ Association', clerkName: 'Esther Mweemba', clerkPhone: '+260955100205' },
  { code: 'DEP-MPG', name: 'Mpongwe', districtId: 'mpongwe', lat: -13.51, lng: 28.155, operator: 'Mpongwe Grain Cooperative', clerkName: 'Kelvin Chanda', clerkPhone: '+260955100206' },
]

const BUYERS = [
  { code: 'BUY-KPM', name: 'Kafue Plains Milling', tpin: '2001100201', plantName: 'Kafue mill', districtId: 'kafue', lat: -15.769, lng: 28.181, phone: '+260955200101' },
  { code: 'BUY-CGP', name: 'Chibombo Grain Processors', tpin: '2001100202', plantName: 'Chibombo plant', districtId: 'chibombo', lat: -14.656, lng: 28.072, phone: '+260955200102' },
  { code: 'BUY-CBF', name: 'Copperbelt Feeds & Foods', tpin: '2001100203', plantName: 'Ndola plant', districtId: 'ndola', lat: -12.959, lng: 28.637, phone: '+260955200103' },
  { code: 'BUY-ZVE', name: 'Zambezi Valley Exports', tpin: '2001100204', plantName: 'Lusaka warehouse', districtId: 'lusaka', lat: -15.4167, lng: 28.2833, phone: '+260955200104' },
]

const TRANSPORTERS = [
  { code: 'TRN-LUA', name: 'Luangwa Haulage', phone: '+260955300101', tpin: '2002200301', vatRegistered: true, truckReg: 'ACF 4512', capacityKg: 30_000, tareKg: 11_800, rateNgweePerTonneKm: 230 },
  { code: 'TRN-MWA', name: 'Mwami Transport', phone: '+260955300102', tpin: null, vatRegistered: false, truckReg: 'ALB 2219', capacityKg: 15_000, tareKg: 7_400, rateNgweePerTonneKm: 260 },
  { code: 'TRN-KAF', name: 'Kafue Logistics', phone: '+260955300103', tpin: '2002200303', vatRegistered: true, truckReg: 'BAH 7781', capacityKg: 32_000, tareKg: 12_200, rateNgweePerTonneKm: 210 },
  { code: 'TRN-MBA', name: 'Mbala Movers', phone: '+260955300104', tpin: null, vatRegistered: false, truckReg: 'AAZ 9034', capacityKg: 10_000, tareKg: 5_900, rateNgweePerTonneKm: 280 },
]

const FIRST_F = ['Grace', 'Esther', 'Ruth', 'Agness', 'Precious', 'Memory', 'Mercy', 'Joyce', 'Loveness', 'Martha', 'Beatrice', 'Bupe', 'Brenda', 'Florence', 'Charity', 'Natasha']
const FIRST_M = ['John', 'Joseph', 'Peter', 'Moses', 'Kelvin', 'Davies', 'Charles', 'Patrick', 'Emmanuel', 'Kennedy', 'Brian', 'Elijah', 'Mathews', 'Gift', 'Bwalya', 'Musonda']
const SURNAMES: Record<string, string[]> = {
  eastern: ['Banda', 'Phiri', 'Mwale', 'Zulu', 'Tembo', 'Daka', 'Lungu', 'Mbewe', 'Ngoma', 'Sakala', 'Nkhoma', 'Jere', 'Mvula', 'Chirwa'],
  central: ['Mulenga', 'Chanda', 'Bwalya', 'Mwansa', 'Musonda', 'Chilufya', 'Kapambwe', 'Mutale'],
  southern: ['Mweemba', 'Moonga', 'Hamoonga', 'Choongo', 'Muleya', 'Simuyemba', 'Halwiindi', 'Mudenda'],
  copperbelt: ['Kabwe', 'Chileshe', 'Mumba', 'Kalaba', 'Mwamba', 'Kunda', 'Chisanga', 'Ngosa'],
  lusaka: ['Mwanza', 'Tembo', 'Phiri', 'Soko', 'Lungu', 'Zimba'],
  northern: ['Mwila', 'Kasonde', 'Chibwe', 'Kangwa', 'Mwape', 'Nsama'],
  muchinga: ['Simukonda', 'Siame', 'Mwenya', 'Nkonde', 'Sichone'],
  luapula: ['Chola', 'Mwansa', 'Kapapa', 'Bwalya', 'Chishimba'],
  'north-western': ['Kayombo', 'Sakuwaha', 'Kahilu', 'Samakayi', 'Chinyama'],
  western: ['Mubita', 'Simasiku', 'Mukela', 'Sitali', 'Inambao', 'Lubinda'],
}

const PROVINCE_CROPS: Record<string, Array<[CropCode, number]>> = {
  eastern: [['MAIZE', 45], ['SOYA', 20], ['GROUNDNUTS', 20], ['SUNFLOWER', 15]],
  central: [['MAIZE', 60], ['SOYA', 30], ['SUNFLOWER', 10]],
  southern: [['MAIZE', 65], ['SUNFLOWER', 20], ['GROUNDNUTS', 15]],
  copperbelt: [['MAIZE', 60], ['SOYA', 40]],
  lusaka: [['MAIZE', 70], ['SOYA', 30]],
  northern: [['MAIZE', 50], ['GROUNDNUTS', 30], ['SOYA', 20]],
  muchinga: [['MAIZE', 55], ['GROUNDNUTS', 30], ['SOYA', 15]],
  luapula: [['MAIZE', 50], ['GROUNDNUTS', 40], ['SOYA', 10]],
  'north-western': [['MAIZE', 70], ['SOYA', 30]],
  western: [['MAIZE', 60], ['GROUNDNUTS', 40]],
}

/** Price per kg (grade A) at the start and end of the six months: harvest-time lows rising into the lean season. */
const PRICE_RANGE: Record<CropCode, [number, number]> = { MAIZE: [560, 640], SOYA: [900, 1020], GROUNDNUTS: [1350, 1580], SUNFLOWER: [680, 760] }

const HISTORY_DISTRICTS = [
  'lundazi', 'nyimba', 'sinda', 'chadiza', 'mambwe', 'serenje', 'kabwe', 'chibombo', 'kapiri-mposhi', 'chisamba', 'mumbwa', 'monze', 'mazabuka', 'kalomo', 'pemba',
  'namwala', 'masaiti', 'ndola', 'luanshya', 'chongwe', 'kafue', 'rufunsa', 'kasama', 'mbala', 'mpika', 'mansa', 'solwezi', 'kaoma', 'mongu', 'chinsali',
]

function weighted<T>(items: Array<[T, number]>): T {
  const total = items.reduce((a, [, w]) => a + w, 0)
  let r = rng() * total
  for (const [item, w] of items) {
    if ((r -= w) <= 0) return item
  }
  return items[0][0]
}

function gradeRoll(): Grade {
  const r = rng()
  return r < 0.55 ? 'A' : r < 0.9 ? 'B' : 'C'
}

async function wipeBaseline() {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('agrios.maintenance', 'on', true)`)
    await tx.execute(sql`delete from worlds`)
    await tx.execute(sql`delete from invoices where world_id is null`)
    await tx.execute(sql`delete from risk_flags where world_id is null`)
    await tx.execute(sql`delete from farmers where world_id is null`)
    await tx.execute(sql`delete from depots where world_id is null`)
    await tx.execute(sql`delete from buyers where world_id is null`)
    await tx.execute(sql`delete from transporters where world_id is null`)
    await tx.execute(sql`delete from districts`)
  })
}

async function main() {
  const force = process.argv.includes('--force')
  const [{ n }] = await rows<{ n: number }>(db, sql`select count(*)::int as n from depots where world_id is null`)
  if (n > 0 && !force) {
    await ensureLiveWorld()
    console.log('Reference data is already in place. Run with --force to rebuild it (this deletes every sandbox).')
    return
  }
  if (force) await wipeBaseline()

  await db.insert(districts).values(
    ZAMBIA_MAP.districts.map((d) => ({ id: d.id, name: d.name, province: d.province, provinceName: ZAMBIA_MAP.provinces.find((p) => p.id === d.province)?.name ?? d.province, lat: d.lat, lng: d.lng })),
  )
  const provinceOf = new Map(ZAMBIA_MAP.districts.map((d) => [d.id, d.province]))
  const districtById = new Map(ZAMBIA_MAP.districts.map((d) => [d.id, d]))

  const depotRows = await db.insert(depots).values(DEPOTS).returning()
  const buyerRows = await db.insert(buyers).values(BUYERS.map((b) => ({ ...b, vatRegistered: true }))).returning()
  const transporterRows = await db.insert(transporters).values(TRANSPORTERS).returning()

  // 8 farmers per depot. Mary Banda (Chipata) is the farmer the guided demo follows.
  const farmerValues: Array<typeof farmers.$inferInsert & { reliability: number }> = []
  let serial = 0
  for (const depot of depotRows) {
    const province = provinceOf.get(depot.districtId)!
    for (let i = 0; i < 8; i++) {
      serial++
      const female = i % 2 === 0
      const name = depot.code === 'DEP-CHP' && i === 0 ? 'Mary Banda' : `${pick(female ? FIRST_F : FIRST_M)} ${pick(SURNAMES[province])}`
      const language = province === 'eastern' ? (rng() < 0.7 ? 'nya' : 'en') : province === 'central' || province === 'copperbelt' ? (rng() < 0.6 ? 'bem' : 'en') : 'en'
      farmerValues.push({
        code: `F-${String(serial).padStart(4, '0')}`,
        name,
        phone: `+2609554${String(10100 + serial).padStart(5, '0')}`,
        districtId: depot.districtId,
        depotId: depot.id,
        language: name === 'Mary Banda' ? 'en' : language,
        fictional: true,
        joinedAt: new Date(Date.now() - int(200, 900) * 24 * 60 * 60 * 1000),
        reliability: between(0.82, 1),
      })
    }
  }
  const farmerRows = await db.insert(farmers).values(farmerValues.map(({ reliability, ...f }) => (void reliability, f))).returning()
  const reliabilityByFarmer = new Map(farmerRows.map((f, i) => [f.id, farmerValues[i].reliability]))

  // ── Six months of history ──────────────────────────────────────────────────────────────────────────────────────
  const now = Date.now()
  const DAY = 24 * 60 * 60 * 1000
  const historyStart = now - 182 * DAY
  const invoiceRows: Array<typeof invoices.$inferInsert> = []
  const farmerGrams = new Map<string, number>()
  let historyNumber = 0
  let receipt = 0
  const nextNumber = () => `HIS-2026-${String(++historyNumber).padStart(6, '0')}`

  const priceFor = (crop: CropCode, at: number, districtId: string) => {
    const [from, to] = PRICE_RANGE[crop]
    const t = (at - historyStart) / (now - historyStart)
    const districtBias = 1 + ((districtId.charCodeAt(0) + districtId.length) % 9 - 4) / 100
    return Math.round((from + (to - from) * t) * districtBias * between(0.97, 1.03))
  }

  const batches: Array<{ districtId: string; at: number; anomaly?: 'cheap' | 'loss' }> = []
  for (let week = 0; week < 26; week++) {
    // Depot districts trade most weeks; a smallholder sells a few bags at a time, a few times a season.
    for (const depot of depotRows) if (rng() < 0.6) batches.push({ districtId: depot.districtId, at: historyStart + week * 7 * DAY + between(0, 6) * DAY })
    for (const d of HISTORY_DISTRICTS) if (rng() < 0.36) batches.push({ districtId: d, at: historyStart + week * 7 * DAY + between(0, 6) * DAY })
  }
  // A few things for the risk view to find.
  batches.push({ districtId: 'lundazi', at: now - 9 * DAY, anomaly: 'cheap' })
  batches.push({ districtId: 'serenje', at: now - 6 * DAY, anomaly: 'loss' })

  const flags: Array<typeof riskFlags.$inferInsert> = []
  for (const batch of batches) {
    const district = districtById.get(batch.districtId)
    if (!district) continue
    const province = provinceOf.get(batch.districtId)!
    const crop = batch.anomaly === 'cheap' ? 'SOYA' : weighted(PROVINCE_CROPS[province] ?? PROVINCE_CROPS.central)
    const buyer = [...buyerRows].sort((a, b) => roadKm(district, a) - roadKm(district, b))[rng() < 0.7 ? 0 : 1]
    const transporter = pick(transporterRows)
    const issuedAt = new Date(Math.min(batch.at, now - DAY))
    const local = depotRows.find((d) => d.districtId === batch.districtId)
    const sellers = local ? farmerRows.filter((f) => f.depotId === local.id) : []
    const sales = local ? int(4, 9) : int(5, 14)
    let batchGrams = 0
    let batchValue = 0
    for (let s = 0; s < sales; s++) {
      const farmer = sellers.length ? pick(sellers) : null
      const name = farmer?.name ?? `${pick(rng() < 0.5 ? FIRST_F : FIRST_M)} ${pick(SURNAMES[province] ?? SURNAMES.central)}`
      const sellerId = farmer?.id ?? `hist-${batch.districtId}-${name.toLowerCase().replace(/\W+/g, '-')}`
      const bags = local ? int(2, 16) : int(3, 30)
      const grams = Math.round(bags * 50_000 * between(0.975, 1.0))
      const grade = gradeRoll()
      let pricePerKg = priceFor(crop, issuedAt.getTime(), batch.districtId)
      if (batch.anomaly === 'cheap' && s < 3) pricePerKg = Math.round(pricePerKg * 0.6)
      const amount = produceValue(grams, pricePerKg, grade)
      batchGrams += grams
      batchValue += amount
      if (farmer) farmerGrams.set(farmer.id, (farmerGrams.get(farmer.id) ?? 0) + grams)
      invoiceRows.push({
        number: nextNumber(),
        kind: 'PRODUCE',
        source: 'history',
        sellerKind: 'FARMER',
        sellerId,
        sellerName: name,
        buyerId: buyer.id,
        buyerName: buyer.name,
        buyerTpin: buyer.tpin,
        districtId: batch.districtId,
        crop,
        grade,
        quantityGrams: grams,
        unitPriceNgwee: Math.round((pricePerKg * GRADE_FACTOR_BP[grade]) / 10_000),
        subtotalNgwee: amount,
        vatNgwee: 0,
        withholdingNgwee: 0,
        totalNgwee: amount,
        taxLines: [],
        issuedAt,
      })
      if (batch.anomaly === 'cheap' && s < 3) {
        flags.push({ ...toFlag(priceBelowMarket({ invoiceId: invoiceRows[invoiceRows.length - 1].number as string, district: district.name, crop: 'Soya beans', pricePerKgNgwee: pricePerKg, medianPerKgNgwee: priceFor(crop, issuedAt.getTime(), batch.districtId), sampleSize: 24 })!), districtId: batch.districtId })
      }
    }
    const km = roadKm(district, buyer)
    const haulage = transportFee(batchGrams, km, transporter.rateNgweePerTonneKm)
    const vat = transporter.vatRegistered ? applyBasisPoints(haulage, 1600) : 0
    invoiceRows.push({
      number: nextNumber(), kind: 'TRANSPORT', source: 'history', sellerKind: 'TRANSPORTER', sellerId: transporter.id, sellerName: transporter.name, sellerTpin: transporter.tpin,
      buyerId: buyer.id, buyerName: buyer.name, buyerTpin: buyer.tpin, districtId: batch.districtId, crop, quantityGrams: batchGrams,
      subtotalNgwee: haulage, vatNgwee: vat, withholdingNgwee: 0, totalNgwee: haulage + vat, taxLines: [], issuedAt,
    })
    const fee = applyBasisPoints(batchValue, 100)
    const feeVat = applyBasisPoints(fee, 1600)
    invoiceRows.push({
      number: nextNumber(), kind: 'SERVICE', source: 'history', sellerKind: 'PLATFORM', sellerName: PLATFORM.name, sellerTpin: PLATFORM.tpin,
      buyerId: buyer.id, buyerName: buyer.name, buyerTpin: buyer.tpin, districtId: batch.districtId, subtotalNgwee: fee, vatNgwee: feeVat,
      withholdingNgwee: 0, totalNgwee: fee + feeVat, taxLines: [{ code: 'VAT_SERVICE_FEE', name: 'VAT on the Agri-OS service fee', kind: 'VAT', rateBp: 1600, collection: 'REMIT', amount: feeVat }], issuedAt,
    })
    if (batch.anomaly === 'loss') {
      const arrived = Math.round(batchGrams * 0.972)
      flags.push({ ...toFlag(transitLoss({ consignmentId: `history-${batch.districtId}`, ref: 'CON-H17', depotGrams: batchGrams, arrivedGrams: arrived, toleranceGrams: Math.floor(batchGrams * 0.005) })!), districtId: batch.districtId })
    }
  }

  // Sign every invoice exactly as live ones are signed, so the public verify page works for history too.
  for (const row of invoiceRows) {
    receipt++
    row.vsdcStatus = 'ACCEPTED'
    row.vsdcReceiptNo = receipt
    row.vsdcInternalData = randomUUID().replace(/-/g, '').slice(0, 26).toUpperCase()
    row.vsdcSignature = randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase().replace(/(.{4})(?!$)/g, '$1-')
    row.vsdcAcceptedAt = row.issuedAt
    row.vsdcAttempts = 1
    const id = randomUUID()
    row.id = id
    const full = { createdAt: row.issuedAt, worldId: null, orderId: null, settlementId: null, deliveryId: null, sellerTpin: null, crop: null, grade: null, quantityGrams: null, unitPriceNgwee: null, signature: null, keyId: null, ...row } as typeof invoices.$inferSelect
    const { signature, keyId } = signInvoice(full)
    row.signature = signature
    row.keyId = keyId
  }
  for (let i = 0; i < invoiceRows.length; i += 400) await db.insert(invoices).values(invoiceRows.slice(i, i + 400))

  // Each farmer's record of promises kept (pledges before Agri-OS kept this history).
  for (const f of farmerRows) {
    const delivered = Math.round((farmerGrams.get(f.id) ?? 0) / 1000)
    const pledged = Math.round(delivered / (reliabilityByFarmer.get(f.id) ?? 1))
    await db.execute(sql`update farmers set history_delivered_kg = ${delivered}, history_pledged_kg = ${pledged} where id = ${f.id}`)
  }

  const newcomer = farmerRows.find((f) => f.depotId === depotRows[3].id)!
  flags.push({
    ...toFlag(newFarmerHighVolume({ farmerId: newcomer.id, farmerName: `${newcomer.name.split(' ')[0]} K.`, daysRegistered: 6, grams: 21_400_000, districtMedianYearGrams: 18_000_000 })!),
    districtId: newcomer.districtId,
  })
  await db.insert(riskFlags).values(flags.map((f, i) => ({ ...f, createdAt: new Date(now - (flags.length - i) * 2 * DAY) })))

  await ensureLiveWorld()
  console.log(
    `Seeded ${ZAMBIA_MAP.districts.length} districts, ${depotRows.length} depots, ${buyerRows.length} buyers, ${transporterRows.length} transporters, ${farmerRows.length} farmers, ${invoiceRows.length} history invoices, ${flags.length} risk flags.`,
  )
}

function toFlag(f: NonNullable<ReturnType<typeof priceBelowMarket>>) {
  return { worldId: null, type: f.type, severity: f.severity, title: f.title, explanation: f.explanation, evidence: f.evidence, dedupeKey: f.dedupeKey }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => closeDb())
