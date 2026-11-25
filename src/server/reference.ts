import { and, asc, eq, isNull, or, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { DEFAULT_TAX_RULES, mergeRules, type TaxRule } from '@/domain/tax'
import { db, type DbOrTx } from './db'
import { buyers, depots, districts, farmerPrefs, farmers, taxRules, transporters } from './schema'

/** Shared reference rows (world_id IS NULL) plus the world's own. */
export function visibleTo(column: AnyPgColumn, worldId: string): SQL {
  return or(isNull(column), eq(column, worldId))!
}

export type Farmer = typeof farmers.$inferSelect
export type Depot = typeof depots.$inferSelect
export type Buyer = typeof buyers.$inferSelect
export type Transporter = typeof transporters.$inferSelect

export async function listDepots(runner: DbOrTx, worldId: string) {
  return runner
    .select({ depot: depots, districtName: districts.name, provinceName: districts.provinceName })
    .from(depots)
    .innerJoin(districts, eq(districts.id, depots.districtId))
    .where(visibleTo(depots.worldId, worldId))
    .orderBy(asc(depots.code))
}

export async function getDepot(runner: DbOrTx, worldId: string, id: string): Promise<Depot | null> {
  const [row] = await runner.select().from(depots).where(and(eq(depots.id, id), visibleTo(depots.worldId, worldId)))
  return row ?? null
}

export async function listBuyers(runner: DbOrTx, worldId: string) {
  return runner.select().from(buyers).where(visibleTo(buyers.worldId, worldId)).orderBy(asc(buyers.code))
}

export async function getBuyer(runner: DbOrTx, worldId: string, id: string): Promise<Buyer | null> {
  const [row] = await runner.select().from(buyers).where(and(eq(buyers.id, id), visibleTo(buyers.worldId, worldId)))
  return row ?? null
}

export async function listTransporters(runner: DbOrTx, worldId: string) {
  return runner.select().from(transporters).where(visibleTo(transporters.worldId, worldId)).orderBy(asc(transporters.code))
}

export async function getTransporter(runner: DbOrTx, worldId: string, id: string): Promise<Transporter | null> {
  const [row] = await runner.select().from(transporters).where(and(eq(transporters.id, id), visibleTo(transporters.worldId, worldId)))
  return row ?? null
}

export async function getFarmer(runner: DbOrTx, worldId: string, id: string): Promise<Farmer | null> {
  const [row] = await runner.select().from(farmers).where(and(eq(farmers.id, id), visibleTo(farmers.worldId, worldId)))
  return row ?? null
}

export async function farmerByPhone(runner: DbOrTx, worldId: string, phone: string): Promise<Farmer | null> {
  const found = await runner.select().from(farmers).where(and(eq(farmers.phone, phone), visibleTo(farmers.worldId, worldId)))
  // A world's own registration wins over a shared record with the same number (it cannot normally exist).
  return found.find((f) => f.worldId === worldId) ?? found[0] ?? null
}

export async function listFarmers(runner: DbOrTx, worldId: string, options: { depotId?: string } = {}) {
  const where = options.depotId ? and(visibleTo(farmers.worldId, worldId), eq(farmers.depotId, options.depotId)) : visibleTo(farmers.worldId, worldId)
  return runner.select().from(farmers).where(where).orderBy(asc(farmers.name))
}

export async function languageOf(runner: DbOrTx, worldId: string, farmer: Farmer): Promise<'en' | 'bem' | 'nya'> {
  if (farmer.worldId === worldId) return farmer.language
  const [pref] = await runner
    .select({ language: farmerPrefs.language })
    .from(farmerPrefs)
    .where(and(eq(farmerPrefs.worldId, worldId), eq(farmerPrefs.farmerId, farmer.id)))
  return pref?.language ?? farmer.language
}

export async function effectiveTaxRules(runner: DbOrTx, worldId: string): Promise<TaxRule[]> {
  const overrides = await runner.select().from(taxRules).where(eq(taxRules.worldId, worldId))
  return mergeRules(
    DEFAULT_TAX_RULES,
    overrides.map((r) => ({ code: r.code, name: r.name, kind: r.kind, base: r.base, rateBp: r.rateBp, collection: r.collection, appliesWhen: r.appliesWhen, enabled: r.enabled, note: r.note })),
  )
}

export async function getDistrict(runner: DbOrTx, id: string) {
  const [row] = await runner.select().from(districts).where(eq(districts.id, id))
  return row ?? null
}

export { db }
