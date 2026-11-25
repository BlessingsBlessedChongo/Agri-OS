import { and, desc, eq, isNull, or } from 'drizzle-orm'
import { creditFor } from '@/server/credit'
import { db } from '@/server/db'
import { notFound } from '@/server/errors'
import { json, worldRoute } from '@/server/http'
import { payoutsOfParty } from '@/server/payouts'
import { pledgesOfFarmer } from '@/server/pledges'
import { getDepot, getDistrict, getFarmer, languageOf } from '@/server/reference'
import { invoices } from '@/server/schema'

/** One farmer: trade record (with every point explained), pledges, payments and recent invoices. */
export const GET = worldRoute<{ id: string }>(async (_request, { params, world }) => {
  const farmer = await getFarmer(db, world.id, params.id)
  if (!farmer) throw notFound('Farmer')
  const [district, depot, credit, pledgeList, payoutList, language, sales] = await Promise.all([
    getDistrict(db, farmer.districtId),
    farmer.depotId ? getDepot(db, world.id, farmer.depotId) : null,
    creditFor(db, world.id, farmer),
    pledgesOfFarmer(world.id, farmer.id),
    payoutsOfParty(world.id, farmer.id),
    languageOf(db, world.id, farmer),
    db
      .select()
      .from(invoices)
      .where(and(eq(invoices.sellerId, farmer.id), eq(invoices.kind, 'PRODUCE'), or(isNull(invoices.worldId), eq(invoices.worldId, world.id))))
      .orderBy(desc(invoices.issuedAt))
      .limit(12),
  ])
  return json({ farmer: { ...farmer, language }, district, depot, credit, pledges: pledgeList, payouts: payoutList, invoices: sales })
})
