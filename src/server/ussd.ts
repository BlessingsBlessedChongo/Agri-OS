import { and, desc, eq, sql } from 'drizzle-orm'
import { normalizeMsisdn } from '@/domain/ids'
import { CROPS } from '@/domain/produce'
import { runUssd, toAfricasTalking, type UssdServices } from '@/ussd/engine'
import { words, type Lang } from '@/ussd/i18n'
import { config } from './config'
import { nextRef } from './counters'
import { creditFor, shareRecord } from './credit'
import { db } from './db'
import { DomainError, notFound } from './errors'
import { offersAtDepot, pledgesOfFarmer, createPledge } from './pledges'
import { farmerByPhone, getDepot, languageOf, listDepots, type Farmer } from './reference'
import { farmerPrefs, farmers, payouts, ussdSessions } from './schema'
import { smsFarmer } from './sms'
import { inWorld } from './uow'

export const USSD_CODE = process.env.USSD_CODE ?? '*384*123#'

export interface UssdRequest {
  sessionId: string
  serviceCode: string
  phoneNumber: string
  text: string
}

/** One USSD request in Africa's Talking's format → the "CON …" / "END …" reply. */
export async function handleUssd(worldId: string, request: UssdRequest): Promise<string> {
  const phone = normalizeMsisdn(request.phoneNumber) ?? request.phoneNumber
  const inputs = request.text ? request.text.split('*') : []
  let farmer = await farmerByPhone(db, worldId, phone)
  const lang: Lang = farmer ? await languageOf(db, worldId, farmer) : 'en'
  const depot = farmer?.depotId ? await getDepot(db, worldId, farmer.depotId) : null
  const sessionKey = `ussd:${request.sessionId}`

  let depotCache: Array<{ id: string; name: string }> | null = null
  const services: UssdServices = {
    serviceCode: request.serviceCode || USSD_CODE,
    host: config.displayHost(),
    farmer: farmer ? { id: farmer.id, name: farmer.name, depotId: farmer.depotId, depotName: depot?.name ?? null } : null,
    async depots() {
      depotCache ??= (await listDepots(db, worldId)).map((r) => ({ id: r.depot.id, name: r.depot.name }))
      return depotCache
    },
    async offers(depotId) {
      return (await offersAtDepot(worldId, depotId)).map((o) => ({
        orderId: o.order.id,
        crop: o.order.crop,
        minGrade: o.order.minGrade,
        priceNgweePerKg: o.order.priceNgweePerKg,
        bagKg: o.bagKg,
        buyerName: o.buyerName,
        depotId,
        depotName: o.depotName,
        deliverBy: o.order.deliverBy,
        remainingBags: o.remainingBags,
      }))
    },
    async pledges() {
      return (await pledgesOfFarmer(worldId, farmer!.id)).map((p) => ({ ref: p.pledge.ref, crop: p.crop, bags: p.pledge.bags, status: p.pledge.status }))
    },
    async payments() {
      const list = await db
        .select()
        .from(payouts)
        .where(and(eq(payouts.worldId, worldId), eq(payouts.partyId, farmer!.id), eq(payouts.kind, 'FARMER')))
        .orderBy(desc(payouts.createdAt))
        .limit(4)
      return list.map((p) => ({ at: p.succeededAt ?? p.createdAt, amountNgwee: p.amountNgwee, status: p.status === 'SUCCEEDED' ? 'PAID' : p.status === 'RETRY_WAIT' || p.status === 'FAILED' ? 'RETRYING' : 'SENDING' }))
    },
    async record() {
      const r = await creditFor(db, worldId, farmer!)
      return { score: r.score, band: r.band, salesCount: r.salesCount, yearAmountNgwee: r.yearAmount, reliabilityPct: r.reliabilityPct }
    },
    async register(name, depotId, chosenLang) {
      farmer = await registerFarmer(worldId, { phone, name, depotId, lang: chosenLang })
      return { id: farmer.id, name: farmer.name, depotId: farmer.depotId, depotName: null }
    },
    async pledge(offer, bags) {
      try {
        const { pledge } = await createPledge(worldId, { farmerId: farmer!.id, orderId: offer.orderId, depotId: offer.depotId, bags, channel: 'USSD', idempotencyKey: `${sessionKey}:${offer.orderId}:${bags}` })
        return { ok: true, ref: pledge.ref }
      } catch (error) {
        if (error instanceof DomainError) return { ok: false }
        throw error
      }
    },
    async setLanguage(next) {
      await setFarmerLanguage(worldId, farmer!, next)
    },
    async share() {
      return shareRecord(worldId, farmer!)
    },
  }

  const screen = await runUssd(services, inputs, lang)
  await db
    .insert(ussdSessions)
    .values({ worldId, sessionId: request.sessionId, phone, serviceCode: services.serviceCode, lastInput: request.text, requests: 1, ended: screen.type === 'END' })
    .onConflictDoUpdate({
      target: [ussdSessions.worldId, ussdSessions.sessionId],
      set: { lastInput: request.text, requests: sql`${ussdSessions.requests} + 1`, ended: screen.type === 'END', updatedAt: new Date() },
    })
  return toAfricasTalking(screen)
}

/** A new farmer registering from their own phone. Idempotent by phone number. */
export async function registerFarmer(worldId: string, input: { phone: string; name: string; depotId: string; lang: Lang }): Promise<Farmer> {
  const existing = await farmerByPhone(db, worldId, input.phone)
  if (existing) return existing
  const depot = await getDepot(db, worldId, input.depotId)
  if (!depot) throw notFound('Depot')
  return inWorld(worldId, async (u) => {
    const code = await nextRef(u.tx, worldId, 'F')
    const [farmer] = await u.tx
      .insert(farmers)
      .values({ worldId, code, name: input.name, phone: input.phone, districtId: depot.districtId, depotId: depot.id, language: input.lang, fictional: false, joinedAt: new Date() })
      .onConflictDoNothing()
      .returning()
    const created = farmer ?? (await farmerByPhone(u.tx, worldId, input.phone))!
    if (farmer) {
      await smsFarmer(u, created, 'farmer.registered', (w) => w.sms.welcome(created.name.split(' ')[0], USSD_CODE))
      u.emit({ type: 'farmer.registered', entityType: 'farmer', entityId: created.id, actor: `farmer:${input.phone}`, payload: { name: input.name, depot: depot.name, language: input.lang } })
    }
    return created
  })
}

export async function setFarmerLanguage(worldId: string, farmer: Farmer, lang: Lang) {
  if (farmer.worldId === worldId) {
    await db.update(farmers).set({ language: lang }).where(eq(farmers.id, farmer.id))
    return
  }
  await db
    .insert(farmerPrefs)
    .values({ worldId, farmerId: farmer.id, language: lang })
    .onConflictDoUpdate({ target: [farmerPrefs.worldId, farmerPrefs.farmerId], set: { language: lang, updatedAt: new Date() } })
}

export function cropName(crop: keyof typeof CROPS, lang: Lang) {
  return words(lang).crop[crop] ?? CROPS[crop].name
}
