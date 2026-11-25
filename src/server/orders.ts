import { and, asc, desc, eq, inArray, notInArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { ACCOUNTS } from '@/domain/accounts'
import { roadKm } from '@/domain/geo'
import { formatKwacha } from '@/domain/money'
import { CROP_CODES, CROPS, GRADES, type CropCode } from '@/domain/produce'
import { escrowTarget } from '@/domain/settlement'
import { transportFee } from '@/domain/transport'
import { zamtel, type ProviderStatus } from '@/integrations/zamtel/client'
import { nextRef } from './counters'
import { db, rows, type Tx } from './db'
import { DomainError, notFound } from './errors'
import { enqueue } from './jobs'
import { balanceOf, post } from './ledger'
import { effectiveTaxRules, getBuyer, getDepot, listFarmers, listTransporters, visibleTo } from './reference'
import { collections, consignments, deliveries, depots, orderDepots, orders, payouts, pledges } from './schema'
import { smsFarmer } from './sms'
import { inWorld, type Uow } from './uow'

export const createOrderInput = z.object({
  buyerId: z.uuid(),
  crop: z.enum(CROP_CODES as [CropCode, ...CropCode[]]),
  minGrade: z.enum(GRADES),
  quantityKg: z.number().int().min(500).max(100_000),
  priceNgweePerKg: z.number().int().min(100).max(5_000),
  depotIds: z.array(z.uuid()).min(1).max(6),
  deliverBy: z.coerce.date(),
})

export type Order = typeof orders.$inferSelect

export async function lockOrder(tx: Tx, worldId: string, orderId: string): Promise<Order | null> {
  const [order] = await rows<{ id: string }>(tx, sql`select id from orders where id = ${orderId} and world_id = ${worldId} for update`)
  if (!order) return null
  const [row] = await tx.select().from(orders).where(eq(orders.id, orderId))
  return row
}

export async function createOrder(worldId: string, input: z.infer<typeof createOrderInput>): Promise<Order> {
  const buyer = await getBuyer(db, worldId, input.buyerId)
  if (!buyer) throw notFound('Buyer')
  const now = Date.now()
  if (input.deliverBy.getTime() < now + 60 * 60 * 1000) throw new DomainError('BAD_DATE', 'The delivery date must be at least an hour from now', 422)
  if (input.deliverBy.getTime() > now + 90 * 24 * 60 * 60 * 1000) throw new DomainError('BAD_DATE', 'The delivery date must be within 90 days', 422)
  const chosen: Array<{ depot: NonNullable<Awaited<ReturnType<typeof getDepot>>>; distanceKm: number }> = []
  for (const id of [...new Set(input.depotIds)]) {
    const depot = await getDepot(db, worldId, id)
    if (!depot) throw notFound('Depot')
    chosen.push({ depot, distanceKm: roadKm(depot, buyer) })
  }
  const transporters = await listTransporters(db, worldId)
  const maxRate = Math.max(...transporters.map((t) => t.rateNgweePerTonneKm))
  const maxKm = Math.max(...chosen.map((c) => c.distanceKm))
  const rules = await effectiveTaxRules(db, worldId)
  const target = escrowTarget({
    quantityKg: input.quantityKg,
    pricePerKgNgwee: input.priceNgweePerKg,
    feeBp: 100,
    maxTransportNgwee: transportFee(input.quantityKg * 1000, maxKm, maxRate),
    rules,
  })
  return inWorld(worldId, async (u) => {
    const ref = await nextRef(u.tx, worldId, 'ORD')
    const [order] = await u.tx
      .insert(orders)
      .values({ worldId, ref, buyerId: buyer.id, crop: input.crop, minGrade: input.minGrade, quantityKg: input.quantityKg, priceNgweePerKg: input.priceNgweePerKg, escrowTargetNgwee: target, deliverBy: input.deliverBy })
      .returning()
    await u.tx.insert(orderDepots).values(chosen.map((c) => ({ worldId, orderId: order.id, depotId: c.depot.id, distanceKm: c.distanceKm })))
    u.emit({
      type: 'order.created',
      entityType: 'order',
      entityId: order.id,
      actor: `buyer:${buyer.code}`,
      payload: { ref, buyer: buyer.name, crop: input.crop, quantityKg: input.quantityKg, priceNgweePerKg: input.priceNgweePerKg, minGrade: input.minGrade, depots: chosen.map((c) => c.depot.name), escrowTargetNgwee: target },
    })
    return order
  })
}

/** How much is in escrow for an order right now (escrow is a liability, so its balance is negative). */
export async function escrowFunded(runner: Parameters<typeof balanceOf>[0], worldId: string, orderId: string) {
  return -(await balanceOf(runner, worldId, `escrow:order:${orderId}`))
}

/**
 * Asks the buyer's Zamtel Money wallet for whatever escrow is still missing. The request is recorded first and the
 * provider is called with no transaction open; the result comes back by callback or by a status check job.
 */
export async function requestFunding(worldId: string, orderId: string) {
  const prepared = await inWorld(worldId, async (u) => {
    const order = await lockOrder(u.tx, worldId, orderId)
    if (!order) throw notFound('Order')
    if (order.status !== 'FUNDING' && order.status !== 'OPEN') throw new DomainError('ORDER_CLOSED', `Order ${order.ref} is ${order.status.toLowerCase()}`)
    const [pending] = await u.tx
      .select()
      .from(collections)
      .where(and(eq(collections.orderId, orderId), inArray(collections.status, ['PENDING', 'UNKNOWN'])))
    if (pending) return { collection: pending, existing: true as const }
    const funded = await escrowFunded(u.tx, worldId, orderId)
    const amount = order.escrowTargetNgwee - funded
    if (amount <= 0) throw new DomainError('ALREADY_FUNDED', `Order ${order.ref} is fully funded`)
    const buyer = (await getBuyer(u.tx, worldId, order.buyerId))!
    const [{ n }] = await rows<{ n: number }>(u.tx, sql`select count(*)::int as n from collections where order_id = ${orderId}`)
    const [collection] = await u.tx
      .insert(collections)
      .values({ worldId, orderId, buyerId: buyer.id, msisdn: buyer.phone, amountNgwee: amount, idempotencyKey: `collection:${orderId}:${n + 1}` })
      .returning()
    u.emit({ type: 'escrow.requested', entityType: 'order', entityId: orderId, actor: `buyer:${buyer.code}`, payload: { ref: order.ref, amountNgwee: amount, collectionId: collection.id } })
    return { collection, existing: false as const, ref: order.ref }
  })
  if (prepared.existing) return prepared.collection
  return sendCollection(worldId, prepared.collection.id)
}

async function sendCollection(worldId: string, collectionId: string) {
  const [collection] = await db.select().from(collections).where(eq(collections.id, collectionId))
  const [order] = await db.select({ ref: orders.ref }).from(orders).where(eq(orders.id, collection.orderId))
  const outcome = await zamtel(worldId).collect({
    amountNgwee: collection.amountNgwee,
    msisdn: collection.msisdn,
    reference: collection.id,
    description: `escrow for order ${order.ref}`,
    idempotencyKey: collection.idempotencyKey,
  })
  if (outcome.kind === 'accepted') {
    await db.update(collections).set({ providerTxnId: outcome.txn.transactionId, updatedAt: new Date() }).where(eq(collections.id, collectionId))
    if (outcome.txn.status === 'SUCCEEDED' || outcome.txn.status === 'FAILED') {
      await applyCollectionStatus(worldId, collectionId, outcome.txn.status, { providerTxnId: outcome.txn.transactionId, failureReason: outcome.txn.failureReason, source: 'response' })
    } else {
      await enqueue(db, worldId, 'collection.check', { collectionId }, { delayMs: 20_000, maxAttempts: 40 })
    }
  } else if (outcome.kind === 'rejected') {
    await applyCollectionStatus(worldId, collectionId, 'FAILED', { failureReason: outcome.message, source: 'response' })
  } else {
    await db.update(collections).set({ status: 'UNKNOWN', lastError: outcome.reason, updatedAt: new Date() }).where(eq(collections.id, collectionId))
    await enqueue(db, worldId, 'collection.check', { collectionId }, { delayMs: 3000, maxAttempts: 40 })
  }
  const [fresh] = await db.select().from(collections).where(eq(collections.id, collectionId))
  return fresh
}

/** Status check for a collection whose result hasn't arrived (lost callback, or the request itself timed out). */
export async function checkCollection(worldId: string, collectionId: string): Promise<void | { again: number }> {
  const [collection] = await db.select().from(collections).where(and(eq(collections.id, collectionId), eq(collections.worldId, worldId)))
  if (!collection || collection.status === 'SUCCEEDED' || collection.status === 'FAILED') return
  const txn = await zamtel(worldId).byReference(collection.id)
  if (!txn) {
    // The provider never received it: resending with the same idempotency key is safe (it schedules its own check).
    await sendCollection(worldId, collectionId)
    return
  }
  if (txn.status === 'SUCCEEDED' || txn.status === 'FAILED') {
    await applyCollectionStatus(worldId, collectionId, txn.status, { providerTxnId: txn.transactionId, failureReason: txn.failureReason, source: 'poll' })
    return
  }
  return { again: 5000 }
}

export async function applyCollectionStatus(
  worldId: string,
  collectionId: string,
  status: ProviderStatus,
  info: { providerTxnId?: string; failureReason?: string | null; source: 'callback' | 'poll' | 'response' },
) {
  return inWorld(worldId, (u) => applyCollectionStatusTx(u, collectionId, status, info))
}

export async function applyCollectionStatusTx(
  u: Uow,
  collectionId: string,
  status: ProviderStatus,
  info: { providerTxnId?: string; failureReason?: string | null; source: 'callback' | 'poll' | 'response' },
): Promise<'applied' | 'ignored'> {
  const [locked] = await rows<{ id: string }>(u.tx, sql`select id from collections where id = ${collectionId} and world_id = ${u.worldId} for update`)
  if (!locked) return 'ignored'
  const [collection] = await u.tx.select().from(collections).where(eq(collections.id, collectionId))
  if (collection.status === 'SUCCEEDED' || collection.status === 'FAILED') return 'ignored'
  if (status === 'PENDING_APPROVAL' || status === 'PROCESSING') {
    if (collection.status === 'UNKNOWN') await u.tx.update(collections).set({ status: 'PENDING', updatedAt: new Date() }).where(eq(collections.id, collectionId))
    return 'applied'
  }
  const order = (await lockOrder(u.tx, u.worldId, collection.orderId))!
  if (status === 'FAILED') {
    await u.tx.update(collections).set({ status: 'FAILED', lastError: info.failureReason ?? 'Failed', providerTxnId: info.providerTxnId ?? collection.providerTxnId, updatedAt: new Date() }).where(eq(collections.id, collectionId))
    u.emit({ type: 'escrow.failed', entityType: 'order', entityId: order.id, actor: 'zamtel', payload: { ref: order.ref, reason: info.failureReason ?? 'Failed', source: info.source } })
    return 'applied'
  }
  await post(u.tx, u.worldId, {
    kind: 'escrow.funded',
    memo: `Escrow funded for order ${order.ref}`,
    idempotencyKey: `collection:${collectionId}:succeeded`,
    refType: 'collection',
    refId: collectionId,
    postings: [
      { account: ACCOUNTS.trust, amount: collection.amountNgwee },
      { account: ACCOUNTS.escrow(order.id, order.ref), amount: -collection.amountNgwee },
    ],
  })
  await u.tx
    .update(collections)
    .set({ status: 'SUCCEEDED', providerTxnId: info.providerTxnId ?? collection.providerTxnId, succeededAt: new Date(), updatedAt: new Date() })
    .where(eq(collections.id, collectionId))
  const funded = await escrowFunded(u.tx, u.worldId, order.id)
  u.emit({ type: 'escrow.funded', entityType: 'order', entityId: order.id, actor: 'zamtel', payload: { ref: order.ref, amountNgwee: collection.amountNgwee, fundedNgwee: funded, source: info.source } })
  if (order.status === 'FUNDING' && funded >= order.escrowTargetNgwee) {
    await u.tx.update(orders).set({ status: 'OPEN', fundedAt: new Date() }).where(eq(orders.id, order.id))
    u.emit({ type: 'order.opened', entityType: 'order', entityId: order.id, actor: 'system', payload: { ref: order.ref } })
    await announceOffer(u, order)
  }
  // A truck held for lack of escrow can now be settled.
  const held = await u.tx.select({ id: consignments.id }).from(consignments).where(and(eq(consignments.orderId, order.id), eq(consignments.status, 'HELD')))
  if (held.length > 0) {
    const { settleConsignmentTx } = await import('./settlement')
    for (const c of held) await settleConsignmentTx(u, c.id)
  }
  return 'applied'
}

/** Tells farmers registered at the order's depots that a buyer is waiting. */
async function announceOffer(u: Uow, order: Order) {
  const depotRows = await u.tx.select({ depot: depots }).from(orderDepots).innerJoin(depots, eq(depots.id, orderDepots.depotId)).where(eq(orderDepots.orderId, order.id))
  for (const { depot } of depotRows) {
    const farmers = await listFarmers(u.tx, u.worldId, { depotId: depot.id })
    for (const farmer of farmers.slice(0, 40)) {
      await smsFarmer(u, farmer, 'offer.new', (w) => w.sms.newOffer(w.crop[order.crop] ?? order.crop, formatKwacha(order.priceNgweePerKg), depot.name, '*384*123#'))
    }
  }
}

export async function closeOrder(worldId: string, orderId: string) {
  return inWorld(worldId, async (u) => {
    const order = await lockOrder(u.tx, worldId, orderId)
    if (!order) throw notFound('Order')
    if (order.status !== 'OPEN' && order.status !== 'FUNDING') throw new DomainError('NOT_OPEN', `Order ${order.ref} is already ${order.status.toLowerCase()}`)
    await u.tx.update(orders).set({ status: 'CLOSED', closedAt: new Date() }).where(eq(orders.id, orderId))
    await u.tx.update(pledges).set({ status: 'EXPIRED' }).where(and(eq(pledges.orderId, orderId), eq(pledges.status, 'PLEDGED')))
    u.emit({ type: 'order.closed', entityType: 'order', entityId: orderId, actor: 'buyer', payload: { ref: order.ref } })
    await maybeCompleteOrder(u, orderId)
  })
}

/**
 * A closed order completes once every delivery has been shipped and settled; whatever is left in escrow goes back
 * to the buyer through the same payout machinery as everyone else.
 */
export async function maybeCompleteOrder(u: Uow, orderId: string) {
  const [order] = await u.tx.select().from(orders).where(eq(orders.id, orderId))
  if (!order || order.status !== 'CLOSED') return
  const [open] = await rows<{ n: number }>(
    u.tx,
    sql`select (select count(*) from consignments where order_id = ${orderId} and status <> 'SETTLED')
             + (select count(*) from deliveries where order_id = ${orderId} and status = 'RECEIVED') as n`,
  )
  if (Number(open.n) > 0) return
  const refund = await escrowFunded(u.tx, u.worldId, orderId)
  const buyer = (await getBuyer(u.tx, u.worldId, order.buyerId))!
  if (refund > 0) {
    const account = ACCOUNTS.buyer(buyer.id, buyer.name)
    await post(u.tx, u.worldId, {
      kind: 'escrow.refund',
      memo: `Unused escrow returned for order ${order.ref}`,
      idempotencyKey: `refund:${orderId}`,
      refType: 'order',
      refId: orderId,
      postings: [
        { account: ACCOUNTS.escrow(order.id, order.ref), amount: refund },
        { account, amount: -refund },
      ],
    })
    const [payout] = await u.tx
      .insert(payouts)
      .values({ worldId: u.worldId, orderId, kind: 'REFUND', partyId: buyer.id, partyName: buyer.name, msisdn: buyer.phone, accountCode: account.code, amountNgwee: refund })
      .returning({ id: payouts.id })
    await enqueue(u.tx, u.worldId, 'payout.dispatch', { payoutId: payout.id }, { delayMs: 500 })
  }
  await u.tx.update(orders).set({ status: 'COMPLETED', completedAt: new Date() }).where(eq(orders.id, orderId))
  u.emit({ type: 'order.completed', entityType: 'order', entityId: orderId, actor: 'system', payload: { ref: order.ref, refundNgwee: refund } })
}

/** Remaining kilograms an order still needs (pledges count as taken). */
export async function remainingKg(runner: Parameters<typeof rows>[0], orderId: string, quantityKg: number): Promise<number> {
  const [r] = await rows<{ kg: number }>(runner, sql`select coalesce(sum(kg_pledged), 0)::int as kg from pledges where order_id = ${orderId} and status in ('PLEDGED', 'DELIVERED')`)
  return Math.max(0, quantityKg - r.kg)
}

/** Everything the buyer screen shows for one order. */
export async function orderDetail(worldId: string, orderId: string) {
  const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.worldId, worldId)))
  if (!order) return null
  const buyer = await getBuyer(db, worldId, order.buyerId)
  const depotRows = await db
    .select({ depot: depots, distanceKm: orderDepots.distanceKm })
    .from(orderDepots)
    .innerJoin(depots, eq(depots.id, orderDepots.depotId))
    .where(eq(orderDepots.orderId, orderId))
    .orderBy(asc(depots.code))
  const [pledgeRows, deliveryRows, consignmentRows, collectionRows, payoutRows] = await Promise.all([
    db.select().from(pledges).where(eq(pledges.orderId, orderId)).orderBy(desc(pledges.createdAt)),
    db.select().from(deliveries).where(eq(deliveries.orderId, orderId)).orderBy(desc(deliveries.recordedAt)),
    db.select().from(consignments).where(eq(consignments.orderId, orderId)).orderBy(desc(consignments.dispatchedAt)),
    db.select().from(collections).where(eq(collections.orderId, orderId)).orderBy(desc(collections.createdAt)),
    db.select().from(payouts).where(eq(payouts.orderId, orderId)).orderBy(asc(payouts.createdAt)),
  ])
  const funded = await escrowFunded(db, worldId, orderId)
  const pledgedKg = pledgeRows.filter((p) => p.status !== 'CANCELLED' && p.status !== 'EXPIRED').reduce((a, p) => a + p.kgPledged, 0)
  const received = deliveryRows.filter((d) => d.status !== 'REJECTED')
  return {
    order,
    buyer,
    crop: CROPS[order.crop],
    depots: depotRows,
    escrow: { targetNgwee: order.escrowTargetNgwee, fundedNgwee: funded },
    progress: {
      pledgedKg,
      deliveredGrams: received.reduce((a, d) => a + d.netGrams, 0),
      settledGrams: received.filter((d) => d.status === 'SETTLED').reduce((a, d) => a + d.netGrams, 0),
      paidNgwee: payoutRows.filter((p) => p.status === 'SUCCEEDED' && p.kind === 'FARMER').reduce((a, p) => a + p.amountNgwee, 0),
    },
    pledges: pledgeRows,
    deliveries: deliveryRows,
    consignments: consignmentRows,
    collections: collectionRows,
    payouts: payoutRows,
  }
}

export async function listOrders(worldId: string) {
  const list = await db.select().from(orders).where(eq(orders.worldId, worldId)).orderBy(desc(orders.createdAt))
  if (list.length === 0) return []
  const stats = await rows<{ order_id: string; pledged_kg: number; delivered_grams: number; settled_grams: number }>(
    db,
    sql`select o.id as order_id,
          coalesce((select sum(kg_pledged) from pledges p where p.order_id = o.id and p.status in ('PLEDGED','DELIVERED')), 0)::int as pledged_kg,
          coalesce((select sum(net_grams) from deliveries d where d.order_id = o.id and d.status <> 'REJECTED'), 0)::bigint as delivered_grams,
          coalesce((select sum(net_grams) from deliveries d where d.order_id = o.id and d.status = 'SETTLED'), 0)::bigint as settled_grams
        from orders o where o.world_id = ${worldId}`,
  )
  const byId = new Map(stats.map((s) => [s.order_id, s]))
  return list.map((o) => ({
    ...o,
    pledgedKg: byId.get(o.id)?.pledged_kg ?? 0,
    deliveredGrams: Number(byId.get(o.id)?.delivered_grams ?? 0),
    settledGrams: Number(byId.get(o.id)?.settled_grams ?? 0),
  }))
}

export { visibleTo, notInArray }
