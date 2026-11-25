/**
 * End-to-end check against a running Agri-OS (npm run build && npm start, then npm run e2e).
 * Drives a whole harvest over HTTP exactly as the browser and Africa's Talking would, then checks the money,
 * the invoices, the reconciliation and the audit trail. Exits non-zero on the first failure.
 *
 *   BASE_URL=http://localhost:3000 npm run e2e            # calm network
 *   BASE_URL=http://localhost:3000 npm run e2e -- --storm # everything going wrong
 */
import { randomUUID } from 'node:crypto'

const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const storm = process.argv.includes('--storm')
let worldId = ''
let passed = 0

function check(condition: unknown, label: string) {
  if (!condition) {
    console.error(`  ✗ ${label}`)
    process.exit(1)
  }
  passed++
  console.log(`  ✓ ${label}`)
}

async function call<T = Record<string, unknown>>(path: string, init: { method?: string; body?: unknown; form?: Record<string, string> } = {}): Promise<{ status: number; data: T; text: string }> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (worldId) headers['x-agrios-world'] = worldId
  let body: string | undefined
  if (init.form) {
    headers['content-type'] = 'application/x-www-form-urlencoded'
    body = new URLSearchParams(init.form).toString()
  } else if (init.body !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(init.body)
  }
  const response = await fetch(`${BASE}${path}`, { method: init.method ?? (body ? 'POST' : 'GET'), headers, body })
  const text = await response.text()
  let data: unknown = null
  try {
    data = JSON.parse(text)
  } catch {
    data = null
  }
  return { status: response.status, data: data as T, text }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function until<T>(label: string, probe: () => Promise<T | null | false | undefined>, timeoutMs = storm ? 240_000 : 90_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    await call('/api/tick', { method: 'POST' })
    const value = await probe()
    if (value) return value
    if (Date.now() > deadline) {
      console.error(`  ✗ timed out waiting for: ${label}`)
      process.exit(1)
    }
    await sleep(700)
  }
}

interface Ref {
  depots: Array<{ id: string; code: string }>
  buyers: Array<{ id: string; code: string; phone: string }>
  transporters: Array<{ id: string; code: string }>
  farmers: Array<{ id: string; phone: string; depotId: string; name: string }>
}

async function main() {
  console.log(`Agri-OS end-to-end against ${BASE}${storm ? ' (storm)' : ''}`)

  console.log('Health and sandbox')
  check((await call('/api/health')).data.ok === true, 'health check passes')
  const created = await call<{ world: { id: string; guide: { phone: string } } }>('/api/world?reset=1', { method: 'POST' })
  check(created.status === 201, 'a fresh sandbox is created')
  worldId = created.data.world.id
  if (storm) check((await call('/api/chaos', { method: 'PUT', body: { preset: 'storm' } })).status === 200, 'chaos set to storm')

  const ref = (await call<Ref>('/api/reference')).data
  const depot = ref.depots.find((d) => d.code === 'DEP-CHP')!
  const buyer = ref.buyers.find((b) => b.code === 'BUY-KPM')!
  const truck = ref.transporters.find((t) => t.code === 'TRN-LUA')!
  const locals = ref.farmers.filter((f) => f.depotId === depot.id).slice(0, 5)
  check(locals.length === 5, 'reference data has farmers at Chipata')

  console.log('Buyer posts demand and funds escrow')
  const order = await call<{ order: { id: string; ref: string } }>('/api/orders', {
    body: { buyerId: buyer.id, crop: 'MAIZE', minGrade: 'B', quantityKg: 5000, priceNgweePerKg: 620, depotIds: [depot.id], deliverBy: new Date(Date.now() + 4 * 86_400_000).toISOString() },
  })
  check(order.status === 201, `order ${order.data.order?.ref} created`)
  const orderId = order.data.order.id
  check((await call(`/api/orders/${orderId}/fund`, { method: 'POST' })).status === 202, 'escrow requested from Zamtel Money')
  const prompt = await until('payment prompt on the buyer’s phone', async () => {
    const r = await call<{ prompts: Array<{ id: string }> }>(`/api/sim/zamtel/${worldId}/v1/customer/prompts?msisdn=${encodeURIComponent(buyer.phone)}`)
    return r.data.prompts?.[0]
  })
  check((await call(`/api/sim/zamtel/${worldId}/v1/customer/prompts/${prompt.id}/approve`, { body: { pin: '0000' } })).status === 403, 'a wrong PIN is refused')
  check((await call(`/api/sim/zamtel/${worldId}/v1/customer/prompts/${prompt.id}/approve`, { body: { pin: '2580' } })).status === 200, 'buyer approves with the right PIN')
  await until('order open', async () => (await call<{ order: { status: string } }>(`/api/orders/${orderId}`)).data.order.status === 'OPEN')
  check(true, 'escrow arrived and the order is open')

  console.log('Farmers pledge by USSD')
  for (const [i, f] of locals.entries()) {
    const sessionId = randomUUID()
    const steps = ['', '1', '1', String(8 + i), '1']
    let reply = ''
    for (let s = 1; s <= steps.length; s++) {
      reply = (await call('/api/ussd', { form: { sessionId, serviceCode: '*384*123#', phoneNumber: f.phone, text: steps.slice(1, s).join('*') } })).text
    }
    check(reply.startsWith('END '), `${f.name} pledged ${8 + i} bags`)
    // Africa's Talking can repeat a request; the pledge must not be made twice.
    await call('/api/ussd', { form: { sessionId, serviceCode: '*384*123#', phoneNumber: f.phone, text: steps.slice(1).join('*') } })
  }
  const pledges = (await call<{ pledges: Array<{ id: string; farmerId: string; bags: number }> }>(`/api/orders/${orderId}`)).data.pledges
  check(pledges.length === 5, 'repeated USSD requests did not duplicate pledges')

  console.log('Depot weighs, partly offline')
  const deliveries = pledges.map((p, i) => ({
    id: randomUUID(),
    orderId,
    depotId: depot.id,
    farmerId: p.farmerId,
    pledgeId: p.id,
    bags: p.bags,
    netGrams: p.bags * 50_000 - 250 + i * 90,
    moisture10: 120 + i * 6,
    grade: i === 4 ? 'C' : 'A',
    scaleMode: 'SCALE',
    recordedAt: new Date(Date.now() - (i < 2 ? 600_000 : 0)).toISOString(),
    recordedOffline: i < 2,
  }))
  const sync = await call<{ results: Array<{ status: string; accepted?: boolean }> }>('/api/deliveries/sync', { body: { deliveries } })
  check(sync.data.results.filter((r) => r.status === 'created').length === 5, 'five deliveries synced')
  check(sync.data.results.filter((r) => r.accepted === false).length === 1, 'the grade C delivery is turned away')
  const again = await call<{ results: Array<{ status: string }> }>('/api/deliveries/sync', { body: { deliveries } })
  check(again.data.results.every((r) => r.status === 'duplicate'), 're-sending the outbox is recognised, not duplicated')

  console.log('Truck and weighbridge')
  const consignment = await call<{ consignment: { id: string; depotGrams: number } }>('/api/consignments', { body: { orderId, depotId: depot.id, transporterId: truck.id } })
  check(consignment.status === 201, 'truck loaded')
  const consignmentId = consignment.data.consignment.id
  const gross = (await call<{ reading: { grams: number }; signature: string }>('/api/sim/weighbridge', { body: { consignmentId, kind: 'GROSS' } })).data
  const forged = await call('/api/weighbridge/readings', { body: { reading: { ...gross.reading, grams: gross.reading.grams - 500_000 }, signature: gross.signature } })
  check(forged.status === 422, 'a weight altered after signing is refused')
  check((await call('/api/weighbridge/readings', { body: gross })).status === 200, 'signed loaded weight accepted')
  const tare = (await call('/api/sim/weighbridge', { body: { consignmentId, kind: 'TARE' } })).data
  const settled = await call<{ status: string }>('/api/weighbridge/readings', { body: tare })
  check(settled.data.status === 'SETTLED', 'empty weight accepted and the truck settled')

  console.log('Payouts, invoices, refund')
  const detail = await until('every payout finished', async () => {
    const d = (await call<{ payouts: Array<{ status: string; kind: string; amountNgwee: number; partyName: string }> }>(`/api/orders/${orderId}`)).data
    return d.payouts.length > 0 && d.payouts.every((p) => p.status === 'SUCCEEDED' || p.status === 'FAILED') ? d : null
  })
  const farmerPayouts = detail.payouts.filter((p) => p.kind === 'FARMER')
  check(farmerPayouts.length === 4, 'four farmers owed (the refused delivery is not paid)')
  if (!storm) check(detail.payouts.every((p) => p.status === 'SUCCEEDED'), 'every payout succeeded')
  const invoices = await until('every invoice accepted by the VSDC', async () => {
    const list = (await call<{ invoices: Array<{ id: string; vsdcStatus: string }> }>('/api/invoices?live=1&limit=50')).data.invoices
    return list.length === 6 && list.every((i) => i.vsdcStatus === 'ACCEPTED') ? list : null
  })
  const verdicts = await Promise.all(invoices.map(async (i) => (await call<{ status: string }>(`/api/invoices/${i.id}`)).data.status))
  check(verdicts.every((v) => v === 'VALID'), 'all six invoices verify publicly (signature + VSDC receipt)')
  check((await call(`/api/orders/${orderId}/close`, { method: 'POST' })).status === 200, 'buyer closes the order')
  await until('refund paid', async () => {
    const d = (await call<{ order: { status: string }; payouts: Array<{ kind: string; status: string }> }>(`/api/orders/${orderId}`)).data
    const refund = d.payouts.find((p) => p.kind === 'REFUND')
    return d.order.status === 'COMPLETED' && refund && (refund.status === 'SUCCEEDED' || refund.status === 'FAILED')
  })
  check(true, 'order completed and unused escrow returned')

  console.log('The books')
  const books = await until('reconciliation balanced', async () => {
    const r = (await call<{ reconciliation: { status: string }; report: { doublePayments: number; ledger: { ok: boolean } } }>('/api/resilience')).data
    return r.reconciliation.status === 'BALANCED' ? r : null
  })
  check(books.report.doublePayments === 0, 'no payment reached the provider twice')
  check(books.report.ledger.ok, 'ledger invariants hold')
  const chain = await call<{ ok: boolean; checked: number }>('/api/audit/verify')
  check(chain.data.ok, `audit trail verifies (${chain.data.checked} events)`)

  console.log('Tampering')
  check((await call('/api/audit/tamper', { method: 'POST' })).status === 200, 'an amount is changed directly in the database')
  const broken = await call<{ ok: boolean; problem: { kind: string } }>('/api/audit/verify')
  check(!broken.data.ok && broken.data.problem.kind === 'CONTENT_CHANGED', 'verification catches it and names the event')
  await call('/api/audit/tamper', { method: 'DELETE' })
  check((await call<{ ok: boolean }>('/api/audit/verify')).data.ok, 'after putting it back, the chain is whole')

  console.log(`\nAll ${passed} checks passed.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
