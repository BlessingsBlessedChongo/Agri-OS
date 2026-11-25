import { and, desc, eq, gt, sql } from 'drizzle-orm'
import { scoreFarmer, type CreditResult } from '@/domain/credit'
import { randomCode } from '@/domain/ids'
import { median } from '@/domain/risk'
import type { Grade } from '@/domain/produce'
import { db, rows, type DbOrTx } from './db'
import { getDistrict, getFarmer, visibleTo, type Farmer } from './reference'
import { creditShares, invoices } from './schema'
import { smsFarmer } from './sms'
import { inWorld } from './uow'
import { config } from './config'

/** What a typical farmer in the district sold over the last 12 months (median of per-farmer totals). */
export async function districtMedianYearGrams(runner: DbOrTx, worldId: string, districtId: string): Promise<number> {
  const totals = await rows<{ grams: number }>(
    runner,
    sql`select sum(quantity_grams)::bigint as grams from invoices
        where kind = 'PRODUCE' and district_id = ${districtId} and seller_id is not null
          and (world_id is null or world_id = ${worldId}) and issued_at > now() - interval '365 days'
        group by seller_id`,
  )
  return median(totals.map((t) => Number(t.grams)))
}

export async function creditFor(runner: DbOrTx, worldId: string, farmer: Farmer, now = new Date()): Promise<CreditResult> {
  const sales = await runner
    .select({ at: invoices.issuedAt, grams: invoices.quantityGrams, amount: invoices.subtotalNgwee, grade: invoices.grade })
    .from(invoices)
    .where(and(eq(invoices.sellerId, farmer.id), eq(invoices.kind, 'PRODUCE'), visibleTo(invoices.worldId, worldId)))
  // A pledge counts once it is delivered or its delivery date has passed; open pledges are not held against anyone.
  const [live] = await rows<{ pledged: number; delivered: number }>(
    runner,
    sql`select coalesce(sum(p.kg_pledged), 0)::int as pledged, coalesce(sum(least(p.kg_delivered, p.kg_pledged)), 0)::int as delivered
        from pledges p join orders o on o.id = p.order_id
        where p.world_id = ${worldId} and p.farmer_id = ${farmer.id}
          and (p.status = 'DELIVERED' or (p.status = 'PLEDGED' and o.deliver_by < now()))`,
  )
  const first = sales.reduce<Date | null>((min, s) => (!min || s.at < min ? s.at : min), null)
  return scoreFarmer({
    now,
    sales: sales.map((s) => ({ at: s.at, grams: s.grams ?? 0, amount: s.amount, grade: (s.grade as Grade | null) ?? null })),
    pledgedKg: farmer.historyPledgedKg + live.pledged,
    deliveredKg: farmer.historyDeliveredKg + live.delivered,
    firstTradeAt: first,
    districtMedianYearGrams: await districtMedianYearGrams(runner, worldId, farmer.districtId),
  })
}

/** A share code the farmer gives a lender. Re-sharing within 10 minutes returns the same code (USSD retries). */
export async function shareRecord(worldId: string, farmer: Farmer): Promise<{ code: string; expiresAt: Date }> {
  const [recent] = await db
    .select()
    .from(creditShares)
    .where(and(eq(creditShares.worldId, worldId), eq(creditShares.farmerId, farmer.id), gt(creditShares.createdAt, sql`now() - interval '10 minutes'`)))
    .orderBy(desc(creditShares.createdAt))
    .limit(1)
  if (recent) return { code: recent.code, expiresAt: recent.expiresAt }
  const code = randomCode(6)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  await inWorld(worldId, async (u) => {
    await u.tx.insert(creditShares).values({ code, worldId, farmerId: farmer.id, expiresAt })
    await smsFarmer(u, farmer, 'credit.shared', (w) => w.sms.shared(code, config.displayHost()))
    u.emit({ type: 'credit.shared', entityType: 'farmer', entityId: farmer.id, actor: `farmer:${farmer.phone}`, payload: { code, expiresAt: expiresAt.toISOString() } })
  })
  return { code, expiresAt }
}

/** What a lender sees for a share code: the record and its explanation, nothing more (no phone number). */
export async function lookupShare(code: string) {
  const [share] = await db.select().from(creditShares).where(eq(creditShares.code, code.toUpperCase()))
  if (!share || share.expiresAt < new Date()) return null
  const farmer = await getFarmer(db, share.worldId, share.farmerId)
  if (!farmer) return null
  await db.update(creditShares).set({ views: sql`${creditShares.views} + 1` }).where(eq(creditShares.code, share.code))
  const district = await getDistrict(db, farmer.districtId)
  const record = await creditFor(db, share.worldId, farmer)
  return {
    code: share.code,
    expiresAt: share.expiresAt,
    views: share.views + 1,
    farmer: { name: farmer.name, district: district?.name ?? farmer.districtId, province: district?.provinceName ?? '', memberSince: farmer.joinedAt },
    record,
  }
}
