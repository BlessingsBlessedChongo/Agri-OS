import { hasDatabase } from '../db'
import { randomUUID } from 'node:crypto'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CHAOS_PRESETS } from '@/domain/chaos'
import { handleZamtelRequest } from '@/integrations/zamtel/simulator'
import { simulateReading } from '@/integrations/weighbridge/device'
import { dispatchConsignment } from '@/server/consignments'
import { closeDb, db, rows } from '@/server/db'
import { recordDelivery } from '@/server/deliveries'
import { verifyWorldChain } from '@/server/events'
import { verifyInvoice } from '@/server/invoices'
import { ledgerHealth, balanceOf } from '@/server/ledger'
import { closeOrder, createOrder, requestFunding } from '@/server/orders'
import { resetRandom, seeded, setRandom } from '@/server/random'
import { reconcile, resilienceReport } from '@/server/reconciliation'
import { buyers, depots, farmers, invoices, orders, payouts, pledges, simWallets, transporters } from '@/server/schema'
import { handleUssd } from '@/server/ussd'
import { submitReading } from '@/server/weighbridge'
import { settleWorld } from '@/server/worker'
import { createWorld, purgeWorld, setChaos } from '@/server/world'

const DAY = 24 * 60 * 60 * 1000
const created: string[] = []

async function newWorld() {
  const world = await createWorld()
  created.push(world.id)
  return world.id
}

async function reference() {
  const [buyer] = await db.select().from(buyers).where(and(isNull(buyers.worldId), eq(buyers.code, 'BUY-KPM')))
  const [depot] = await db.select().from(depots).where(and(isNull(depots.worldId), eq(depots.code, 'DEP-CHP')))
  const [truck] = await db.select().from(transporters).where(eq(transporters.code, 'TRN-LUA'))
  return { buyer, depot, truck }
}

/** The buyer approves the payment prompt on their phone (waiting for it if the request had to be retried). */
async function approveWhenAsked(worldId: string, msisdn: string) {
  for (let i = 0; i < 60; i++) {
    const res = await handleZamtelRequest({ worldId, method: 'GET', path: '/customer/prompts', query: new URLSearchParams({ msisdn }), headers: {}, body: undefined })
    const prompt = (res.body as { prompts: Array<{ id: string }> }).prompts[0]
    if (prompt) {
      const answer = await handleZamtelRequest({ worldId, method: 'POST', path: `/customer/prompts/${prompt.id}/approve`, query: new URLSearchParams(), headers: {}, body: { pin: '1234' } })
      expect(answer.status).toBe(200)
      return
    }
    await settleWorld(worldId, { timeoutMs: 1500 })
  }
  throw new Error('The buyer was never asked to pay')
}

async function harvest(worldId: string, farmerCount: number) {
  const { buyer, depot, truck } = await reference()
  const order = await createOrder(worldId, { buyerId: buyer.id, crop: 'MAIZE', minGrade: 'B', quantityKg: 6000, priceNgweePerKg: 620, depotIds: [depot.id], deliverBy: new Date(Date.now() + 7 * DAY) })
  await requestFunding(worldId, order.id)
  await approveWhenAsked(worldId, buyer.phone)
  await settleWorld(worldId)
  expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0].status).toBe('OPEN')

  const local = await db.select().from(farmers).where(and(isNull(farmers.worldId), eq(farmers.depotId, depot.id))).limit(farmerCount)
  for (const [i, f] of local.entries()) {
    const reply = await handleUssd(worldId, { sessionId: randomUUID(), serviceCode: '*384*123#', phoneNumber: f.phone, text: `1*1*${8 + i}*1` })
    expect(reply.startsWith('END '), reply).toBe(true)
  }
  const ps = await db.select().from(pledges).where(eq(pledges.orderId, order.id))
  expect(ps).toHaveLength(farmerCount)
  for (const p of ps) {
    const r = await recordDelivery(worldId, { id: randomUUID(), orderId: order.id, depotId: depot.id, farmerId: p.farmerId, pledgeId: p.id, bags: p.bags, netGrams: p.bags * 50_000 - 300, moisture10: 128, grade: 'A', scaleMode: 'SCALE', recordedAt: new Date(), recordedOffline: false })
    expect(r.status).toBe('created')
  }
  const consignment = await dispatchConsignment(worldId, { orderId: order.id, depotId: depot.id, transporterId: truck.id })
  await submitReading(worldId, (await simulateReading(worldId, consignment.id, 'GROSS'))!)
  const result = await submitReading(worldId, (await simulateReading(worldId, consignment.id, 'TARE'))!)
  return { order, buyer, consignment, result, pledges: ps }
}

async function walletOf(worldId: string, msisdn: string) {
  const [w] = await db.select().from(simWallets).where(and(eq(simWallets.worldId, worldId), eq(simWallets.msisdn, msisdn)))
  return w?.balanceNgwee ?? 0
}

describe.skipIf(!hasDatabase)('a full harvest', () => {
  beforeAll(() => setRandom(seeded(7)))
  afterAll(async () => {
    resetRandom()
    for (const id of created) await purgeWorld(id)
    await closeDb()
  })

  it('pays every farmer exactly once, invoices everything and reconciles to the ngwee', async () => {
    const worldId = await newWorld()
    const { order, result } = await harvest(worldId, 5)
    expect(result.status).toBe('SETTLED')
    expect((await settleWorld(worldId)).quiet).toBe(true)

    const paid = await db.select().from(payouts).where(eq(payouts.worldId, worldId))
    expect(paid.map((p) => p.kind).sort()).toEqual(['FARMER', 'FARMER', 'FARMER', 'FARMER', 'FARMER', 'TAX', 'TRANSPORTER'])
    expect(paid.every((p) => p.status === 'SUCCEEDED' && p.attempt === 1)).toBe(true)
    for (const p of paid.filter((x) => x.kind === 'FARMER')) expect(await walletOf(worldId, p.msisdn)).toBe(15_000 + p.amountNgwee)

    const issued = await db.select().from(invoices).where(eq(invoices.worldId, worldId))
    expect(issued).toHaveLength(7) // 5 reverse invoices + haulage + service fee
    expect(issued.every((i) => i.vsdcStatus === 'ACCEPTED' && i.vsdcReceiptNo)).toBe(true)
    for (const i of issued) expect((await verifyInvoice(i.id))!.status).toBe('VALID')

    expect((await ledgerHealth(worldId)).ok).toBe(true)
    expect((await reconcile(worldId)).status).toBe('BALANCED')
    expect((await verifyWorldChain(worldId)).ok).toBe(true)

    // Closing the order returns the unused escrow to the buyer.
    await closeOrder(worldId, order.id)
    await settleWorld(worldId)
    expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0].status).toBe('COMPLETED')
    const refund = (await db.select().from(payouts).where(and(eq(payouts.worldId, worldId), eq(payouts.kind, 'REFUND'))))[0]
    expect(refund.status).toBe('SUCCEEDED')
    expect((await reconcile(worldId)).status).toBe('BALANCED')
    // What stays in the trust wallet is exactly Agri-OS's fee income.
    expect(await balanceOf(db, worldId, 'bank:zamtel-trust')).toBe(-(await balanceOf(db, worldId, 'revenue:fees')))
  })

  it('refuses a weight that was not signed by the weighbridge', async () => {
    const worldId = await newWorld()
    const { buyer, depot, truck } = await reference()
    const order = await createOrder(worldId, { buyerId: buyer.id, crop: 'MAIZE', minGrade: 'B', quantityKg: 2000, priceNgweePerKg: 620, depotIds: [depot.id], deliverBy: new Date(Date.now() + 7 * DAY) })
    await requestFunding(worldId, order.id)
    await approveWhenAsked(worldId, buyer.phone)
    await settleWorld(worldId)
    const [f] = await db.select().from(farmers).where(and(isNull(farmers.worldId), eq(farmers.depotId, depot.id))).limit(1)
    await recordDelivery(worldId, { id: randomUUID(), orderId: order.id, depotId: depot.id, farmerId: f.id, bags: 10, netGrams: 500_000, moisture10: 120, grade: 'A', scaleMode: 'MANUAL', recordedAt: new Date(), recordedOffline: true })
    const c = await dispatchConsignment(worldId, { orderId: order.id, depotId: depot.id, transporterId: truck.id })
    const signed = (await simulateReading(worldId, c.id, 'GROSS'))!
    const forged = { reading: { ...signed.reading, grams: signed.reading.grams - 100_000 }, signature: signed.signature }
    await expect(submitReading(worldId, forged)).rejects.toThrow(/not signed by a known weighbridge/)
  })

  it('detects an insider editing the audit trail directly in the database', async () => {
    const worldId = await newWorld()
    await harvest(worldId, 2)
    await settleWorld(worldId)
    expect((await verifyWorldChain(worldId)).ok).toBe(true)
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('agrios.maintenance', 'on', true)`)
      await tx.execute(sql`update events set payload = jsonb_set(payload, '{amountNgwee}', '1') where world_id = ${worldId} and type = 'payout.succeeded' and seq = (select min(seq) from events where world_id = ${worldId} and type = 'payout.succeeded')`)
    })
    const check = await verifyWorldChain(worldId)
    expect(check.ok).toBe(false)
    expect(check.problem?.kind).toBe('CONTENT_CHANGED')
    // And without maintenance mode the database refuses the edit outright.
    const refused = await db.execute(sql`update events set payload = '{}' where world_id = ${worldId}`).catch((e: Error & { cause?: Error }) => e)
    expect(String((refused as Error & { cause?: Error })?.cause?.message ?? refused)).toMatch(/events is append-only/)
  })
})

describe.skipIf(!hasDatabase)('a harvest in a storm', () => {
  afterAll(async () => {
    resetRandom()
    for (const id of created) await purgeWorld(id)
    await closeDb()
  })

  it.each([11, 23, 42])('never loses or duplicates money (seed %i)', async (seed) => {
    setRandom(seeded(seed))
    const worldId = await newWorld()
    await setChaos(worldId, CHAOS_PRESETS.storm.settings)
    await harvest(worldId, 4)
    expect((await settleWorld(worldId, { timeoutMs: 150_000 })).quiet).toBe(true)

    const report = await resilienceReport(worldId)
    expect(report.doublePayments).toBe(0)
    expect(report.ledger.ok).toBe(true)

    const all = await db.select().from(payouts).where(eq(payouts.worldId, worldId))
    for (const p of all) {
      expect(['SUCCEEDED', 'FAILED']).toContain(p.status)
      const [{ n }] = await rows<{ n: number }>(db, sql`select count(*)::int as n from sim_transactions where world_id = ${worldId} and status = 'SUCCEEDED' and split_part(reference, ':', 1) = ${p.id}`)
      expect(n).toBe(p.status === 'SUCCEEDED' ? 1 : 0)
      if (p.kind === 'FARMER' && p.status === 'SUCCEEDED') expect(await walletOf(worldId, p.msisdn)).toBe(15_000 + p.amountNgwee)
    }
    const recon = await reconcile(worldId)
    expect(recon.status).toBe('BALANCED')
    expect((await verifyWorldChain(worldId)).ok).toBe(true)
  })
})
