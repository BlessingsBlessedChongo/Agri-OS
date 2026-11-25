import { and, eq, inArray, sql } from 'drizzle-orm'
import { ACCOUNTS } from '@/domain/accounts'
import { formatKwacha } from '@/domain/money'
import { priceBelowMarket } from '@/domain/risk'
import { computeSettlement } from '@/domain/settlement'
import { applyTaxes } from '@/domain/tax'
import { checkTransit } from '@/domain/transport'
import { config } from './config'
import { nextNumber } from './counters'
import { rows } from './db'
import { enqueue } from './jobs'
import { post } from './ledger'
import { escrowFunded, maybeCompleteOrder } from './orders'
import { effectiveTaxRules, getBuyer, getDepot, getTransporter } from './reference'
import { districtMedianPrice, raiseFlag } from './risk'
import { consignments, deliveries, farmers, invoices, orders, payouts, settlements } from './schema'
import type { Uow } from './uow'
import { ZRA_MSISDN } from './world'

export const PLATFORM = { name: 'Agri-OS Settlement Services', tpin: process.env.AGRIOS_TPIN ?? '1002003001' }

export function invoiceNumber(year: number, n: number) {
  return `INV-${year}-${String(n).padStart(6, '0')}`
}

/**
 * Settles one weighed truck in the caller's transaction: posts the balanced ledger entry, queues every payout and
 * invoice (outbox), and records why each amount is what it is. If escrow can't cover it, the truck is HELD and the
 * order's escrow target rises by exactly the shortfall, so funding the order again releases it.
 */
export async function settleConsignmentTx(u: Uow, consignmentId: string) {
  const worldId = u.worldId
  await rows(u.tx, sql`select id from consignments where id = ${consignmentId} and world_id = ${worldId} for update`)
  const [c] = await u.tx.select().from(consignments).where(eq(consignments.id, consignmentId))
  if (!c || (c.status !== 'WEIGHED' && c.status !== 'HELD') || c.arrivedGrams === null) return null
  const [order] = await u.tx.select().from(orders).where(eq(orders.id, c.orderId))
  const buyer = (await getBuyer(u.tx, worldId, order.buyerId))!
  const transporter = (await getTransporter(u.tx, worldId, c.transporterId))!
  const depot = (await getDepot(u.tx, worldId, c.depotId))!
  const loaded = await u.tx
    .select({ delivery: deliveries, farmerName: farmers.name, farmerPhone: farmers.phone })
    .from(deliveries)
    .innerJoin(farmers, eq(farmers.id, deliveries.farmerId))
    .where(and(eq(deliveries.consignmentId, c.id), eq(deliveries.status, 'LOADED')))
  if (loaded.length === 0) return null

  const rules = await effectiveTaxRules(u.tx, worldId)
  const transit = checkTransit(c.depotGrams, c.arrivedGrams)
  const breakdown = computeSettlement({
    order: { id: order.id, ref: order.ref, feeBp: order.feeBp },
    deliveries: loaded.map((l) => ({ id: l.delivery.id, farmerId: l.delivery.farmerId, farmerName: l.farmerName, payableGrams: l.delivery.payableGrams, amount: l.delivery.amountNgwee })),
    transporter: { id: transporter.id, name: transporter.name, vatRegistered: transporter.vatRegistered },
    transportGross: c.transportFeeNgwee,
    transit,
    rules,
  })

  const available = await escrowFunded(u.tx, worldId, order.id)
  if (available < breakdown.buyerTotal) {
    const short = breakdown.buyerTotal - available
    if (c.status !== 'HELD') {
      await u.tx.update(consignments).set({ status: 'HELD', holdReason: `Escrow is short by ${formatKwacha(short)}` }).where(eq(consignments.id, c.id))
      await u.tx.update(orders).set({ escrowTargetNgwee: sql`${orders.escrowTargetNgwee} + ${short}` }).where(eq(orders.id, order.id))
      u.emit({ type: 'consignment.held', entityType: 'consignment', entityId: c.id, actor: 'system', payload: { ref: c.ref, order: order.ref, shortNgwee: short, buyerTotalNgwee: breakdown.buyerTotal, availableNgwee: available } })
    }
    return null
  }

  const { entryId } = await post(u.tx, worldId, {
    kind: 'settlement',
    memo: `Truck ${c.ref} settled for order ${order.ref}`,
    idempotencyKey: `settlement:${c.id}`,
    refType: 'consignment',
    refId: c.id,
    postings: breakdown.postings,
  })
  const [settlement] = await u.tx
    .insert(settlements)
    .values({
      worldId,
      consignmentId: c.id,
      orderId: order.id,
      journalEntryId: entryId,
      produceNgwee: breakdown.produce.total,
      transportNgwee: breakdown.transport.charged,
      deductionNgwee: breakdown.transport.deduction,
      feeNgwee: breakdown.fee.amount,
      taxToZraNgwee: breakdown.toZra,
      buyerTotalNgwee: breakdown.buyerTotal,
      breakdown: JSON.parse(JSON.stringify(breakdown)),
    })
    .returning()
  await u.tx.update(deliveries).set({ status: 'SETTLED' }).where(inArray(deliveries.id, loaded.map((l) => l.delivery.id)))
  await u.tx.update(consignments).set({ status: 'SETTLED', settledAt: new Date(), holdReason: null }).where(eq(consignments.id, c.id))

  // Payouts (the outbox): written now, sent by jobs, each exactly once.
  const payoutRows: Array<typeof payouts.$inferInsert> = breakdown.farmers.map((share) => ({
    worldId,
    orderId: order.id,
    settlementId: settlement.id,
    kind: 'FARMER' as const,
    partyId: share.farmerId,
    partyName: share.farmerName,
    msisdn: loaded.find((l) => l.delivery.farmerId === share.farmerId)!.farmerPhone,
    accountCode: ACCOUNTS.farmer(share.farmerId, share.farmerName).code,
    amountNgwee: share.net,
  }))
  if (breakdown.transport.payout > 0) {
    payoutRows.push({ worldId, orderId: order.id, settlementId: settlement.id, kind: 'TRANSPORTER', partyId: transporter.id, partyName: transporter.name, msisdn: transporter.phone, accountCode: ACCOUNTS.transporter(transporter.id, transporter.name).code, amountNgwee: breakdown.transport.payout })
  }
  if (breakdown.toZra > 0) {
    payoutRows.push({ worldId, orderId: order.id, settlementId: settlement.id, kind: 'TAX', partyId: 'ZRA', partyName: 'Zambia Revenue Authority', msisdn: ZRA_MSISDN, accountCode: ACCOUNTS.zra.code, amountNgwee: breakdown.toZra })
  }
  const created = await u.tx.insert(payouts).values(payoutRows.filter((p) => p.amountNgwee > 0)).returning({ id: payouts.id })
  for (const [i, p] of created.entries()) await enqueue(u.tx, worldId, 'payout.dispatch', { payoutId: p.id }, { delayMs: 200 + i * 120 })

  // Invoices: the buyer issues each farmer's invoice on the farmer's behalf (reverse invoicing).
  const issuedAt = new Date()
  const year = issuedAt.getUTCFullYear()
  const invoiceRows: Array<typeof invoices.$inferInsert> = []
  for (const l of loaded) {
    const d = l.delivery
    const taxed = applyTaxes('PRODUCE', d.amountNgwee, { vatRegistered: false }, rules)
    invoiceRows.push({
      worldId,
      number: invoiceNumber(year, await nextNumber(u.tx, worldId, 'INV')),
      kind: 'PRODUCE',
      orderId: order.id,
      settlementId: settlement.id,
      deliveryId: d.id,
      sellerKind: 'FARMER',
      sellerId: d.farmerId,
      sellerName: l.farmerName,
      buyerId: buyer.id,
      buyerName: buyer.name,
      buyerTpin: buyer.tpin,
      districtId: depot.districtId,
      crop: order.crop,
      grade: d.grade,
      quantityGrams: d.payableGrams,
      unitPriceNgwee: Math.round((d.priceNgweePerKg * d.gradeFactorBp) / 10_000),
      subtotalNgwee: d.amountNgwee,
      vatNgwee: taxed.vat,
      withholdingNgwee: taxed.withholding,
      totalNgwee: d.amountNgwee + taxed.vat,
      taxLines: taxed.lines,
      issuedAt,
    })
  }
  if (breakdown.transport.charged > 0) {
    invoiceRows.push({
      worldId,
      number: invoiceNumber(year, await nextNumber(u.tx, worldId, 'INV')),
      kind: 'TRANSPORT',
      orderId: order.id,
      settlementId: settlement.id,
      sellerKind: 'TRANSPORTER',
      sellerId: transporter.id,
      sellerName: transporter.name,
      sellerTpin: transporter.tpin,
      buyerId: buyer.id,
      buyerName: buyer.name,
      buyerTpin: buyer.tpin,
      districtId: depot.districtId,
      crop: order.crop,
      quantityGrams: c.arrivedGrams,
      subtotalNgwee: breakdown.transport.charged,
      vatNgwee: breakdown.transport.taxed.vat,
      withholdingNgwee: breakdown.transport.taxed.withholding,
      totalNgwee: breakdown.transport.taxed.fromBuyer,
      taxLines: breakdown.transport.taxed.lines,
      issuedAt,
    })
  }
  if (breakdown.fee.amount > 0) {
    invoiceRows.push({
      worldId,
      number: invoiceNumber(year, await nextNumber(u.tx, worldId, 'INV')),
      kind: 'SERVICE',
      orderId: order.id,
      settlementId: settlement.id,
      sellerKind: 'PLATFORM',
      sellerName: PLATFORM.name,
      sellerTpin: PLATFORM.tpin,
      buyerId: buyer.id,
      buyerName: buyer.name,
      buyerTpin: buyer.tpin,
      districtId: depot.districtId,
      subtotalNgwee: breakdown.fee.amount,
      vatNgwee: breakdown.fee.taxed.vat,
      totalNgwee: breakdown.fee.taxed.fromBuyer,
      taxLines: breakdown.fee.taxed.lines,
      issuedAt,
    })
  }
  const createdInvoices = await u.tx.insert(invoices).values(invoiceRows).returning({ id: invoices.id })
  for (const [i, inv] of createdInvoices.entries()) await enqueue(u.tx, worldId, 'invoice.submit', { invoiceId: inv.id }, { delayMs: 150 + i * 80 })

  u.emit({
    type: 'settlement.completed',
    entityType: 'consignment',
    entityId: c.id,
    actor: 'system',
    payload: {
      ref: c.ref,
      order: order.ref,
      farmers: breakdown.farmers.length,
      produceNgwee: breakdown.produce.total,
      transportNgwee: breakdown.transport.charged,
      transitDeductionNgwee: breakdown.transport.deduction,
      feeNgwee: breakdown.fee.amount,
      taxToZraNgwee: breakdown.toZra,
      buyerTotalNgwee: breakdown.buyerTotal,
      invoices: createdInvoices.length,
      payouts: created.length,
    },
  })

  // Is this price fair for the district? (Checked against last season's history plus this world's trades.)
  const market = await districtMedianPrice(u.tx, worldId, depot.districtId, order.crop)
  const finding = priceBelowMarket({
    invoiceId: createdInvoices[0]?.id ?? c.id,
    district: depot.name,
    crop: order.crop.charAt(0) + order.crop.slice(1).toLowerCase(),
    pricePerKgNgwee: order.priceNgweePerKg,
    medianPerKgNgwee: market.median,
    sampleSize: market.sampleSize,
  })
  if (finding) await raiseFlag(u, finding, depot.districtId)

  await maybeCompleteOrder(u, order.id)
  return settlement
}

export function appBaseUrl() {
  return config.appUrl()
}
