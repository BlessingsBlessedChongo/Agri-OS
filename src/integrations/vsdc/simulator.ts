import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { canonicalJson } from '@/domain/chain'
import { db } from '@/server/db'
import { nextNumber } from '@/server/counters'
import { pgCode } from '@/server/errors'
import { simVsdcReceipts } from '@/server/schema'
import { derivedSecret, hmacHex } from '@/server/signing'
import { getWorld } from '@/server/world'
import type { SimRequest, SimResponse } from '../zamtel/simulator'

/**
 * A stand-in for a VSDC (virtual sales data controller), the service a certified invoicing system sends each invoice
 * to before it is valid. The request is VSDC-style (seller TPIN, branch, invoice number, item lines, tax totals) and
 * the answer carries a receipt number, internal data and a signature, the way the real Smart Invoice flow does.
 * Field names are illustrative; src/integrations/vsdc/client.ts is the only place that would change for the real API.
 */
const item = z.object({
  itemSeq: z.number().int().positive(),
  itemCd: z.string().min(1),
  itemNm: z.string().min(1),
  qty: z.number().positive(),
  qtyUnitCd: z.string(),
  prc: z.number().nonnegative(),
  splyAmt: z.number().nonnegative(),
  vatCatCd: z.string(),
  vatAmt: z.number().nonnegative(),
  totAmt: z.number().nonnegative(),
})

const saveSales = z.object({
  tpin: z.string().regex(/^\d{10}$/, 'tpin must be 10 digits'),
  bhfId: z.string(),
  cisInvcNo: z.string().min(1),
  invcKind: z.enum(['SALE', 'PURCHASE_ON_BEHALF']),
  custTpin: z.string().nullable(),
  custNm: z.string().min(1),
  sellerNm: z.string().min(1),
  salesDt: z.string().regex(/^\d{8}$/),
  cfmDt: z.string().regex(/^\d{14}$/),
  totItemCnt: z.number().int().positive(),
  totTaxblAmt: z.number().nonnegative(),
  totTaxAmt: z.number().nonnegative(),
  totAmt: z.number().nonnegative(),
  itemList: z.array(item).min(1),
})

export type VsdcSaveSales = z.infer<typeof saveSales>

const stamp = (d: Date) => d.toISOString().replace(/[-:T]/g, '').slice(0, 14)
const result = (status: number, resultCd: string, resultMsg: string, data: unknown = null, delayMs = 0): SimResponse => ({
  status,
  delayMs,
  body: { resultCd, resultMsg, resultDt: stamp(new Date()), data },
})

export async function handleVsdcRequest(request: SimRequest, rng: () => number = Math.random): Promise<SimResponse> {
  const world = await getWorld(request.worldId)
  if (!world) return result(404, '894', 'Unknown taxpayer system')
  const latency = Math.round(200 + rng() * 300)
  if (request.method !== 'POST' || request.path !== '/trnsSales/saveSales') return result(404, '894', 'Unknown endpoint')
  if (rng() < world.chaos.vsdcErrorRate) return result(503, '999', 'VSDC is temporarily unavailable', null, latency)

  const parsed = saveSales.safeParse(request.body)
  if (!parsed.success) return result(200, '899', parsed.error.issues[0]?.message ?? 'Invalid invoice', null, latency)
  const inv = parsed.data
  const lines = inv.itemList.reduce((a, i) => a + i.totAmt, 0)
  if (Math.abs(lines - inv.totAmt) > 0.005 || inv.itemList.length !== inv.totItemCnt) {
    return result(200, '899', 'Totals do not match the item lines', null, latency)
  }

  const existing = await receiptFor(request.worldId, inv.cisInvcNo)
  if (existing) return result(200, '000', 'Succeeded (already received)', existing, latency)

  try {
    const data = await db.transaction(async (tx) => {
      const receiptNo = await nextNumber(tx, request.worldId, 'vsdc-receipt')
      const material = canonicalJson({ receiptNo, tpin: inv.tpin, cisInvcNo: inv.cisInvcNo, totAmt: inv.totAmt, cfmDt: inv.cfmDt })
      const mac = hmacHex(derivedSecret('vsdc'), material).toUpperCase()
      const internalData = mac.slice(0, 26)
      const signature = mac.slice(26, 42).replace(/(.{4})(?!$)/g, '$1-')
      await tx.insert(simVsdcReceipts).values({ worldId: request.worldId, receiptNo, invoiceNumber: inv.cisInvcNo, tpin: inv.tpin, payload: inv, internalData, signature })
      return { rcptNo: receiptNo, intrlData: internalData, rcptSign: signature, vsdcRcptPbctDate: stamp(new Date()), sdcId: 'SDC-SIM-0001', mrcNo: 'AGRIOS-VSDC-SIM' }
    })
    return result(200, '000', 'Succeeded', data, latency)
  } catch (error) {
    if (pgCode(error) === '23505') {
      const raced = await receiptFor(request.worldId, inv.cisInvcNo)
      if (raced) return result(200, '000', 'Succeeded (already received)', raced, latency)
    }
    throw error
  }
}

async function receiptFor(worldId: string, invoiceNumber: string) {
  const [r] = await db.select().from(simVsdcReceipts).where(and(eq(simVsdcReceipts.worldId, worldId), eq(simVsdcReceipts.invoiceNumber, invoiceNumber)))
  return r ? { rcptNo: r.receiptNo, intrlData: r.internalData, rcptSign: r.signature, vsdcRcptPbctDate: stamp(r.createdAt), sdcId: 'SDC-SIM-0001', mrcNo: 'AGRIOS-VSDC-SIM' } : null
}
