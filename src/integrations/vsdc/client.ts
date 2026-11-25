import { config } from '@/server/config'
import type { invoices } from '@/server/schema'
import { ProviderNetworkError, ProviderTimeoutError, parseJson, send } from '../transport'
import type { VsdcSaveSales } from './simulator'

type Invoice = typeof invoices.$inferSelect

export interface VsdcReceipt {
  rcptNo: number
  intrlData: string
  rcptSign: string
  vsdcRcptPbctDate: string
  sdcId: string
  mrcNo: string
}

export type VsdcOutcome = { kind: 'accepted'; receipt: VsdcReceipt } | { kind: 'rejected'; code: string; message: string } | { kind: 'unavailable'; reason: string }

const kwacha = (ngwee: number) => Math.round(ngwee) / 100
const stamp = (d: Date) => d.toISOString().replace(/[-:T]/g, '').slice(0, 14)

/**
 * Maps an Agri-OS invoice to the VSDC request. Produce invoices are issued by the buyer on the farmer's behalf
 * (reverse invoicing): smallholders have no TPIN or invoicing device, so the registered buyer records the purchase.
 */
export function toVsdcPayload(inv: Invoice): VsdcSaveSales {
  const reverse = inv.kind === 'PRODUCE'
  const qtyKg = inv.quantityGrams ? inv.quantityGrams / 1000 : 1
  const vat = kwacha(inv.vatNgwee)
  const supply = kwacha(inv.subtotalNgwee)
  return {
    tpin: reverse ? inv.buyerTpin : (inv.sellerTpin ?? inv.buyerTpin),
    bhfId: '000',
    cisInvcNo: inv.number,
    invcKind: reverse ? 'PURCHASE_ON_BEHALF' : 'SALE',
    custTpin: reverse ? null : inv.buyerTpin,
    custNm: inv.buyerName,
    sellerNm: inv.sellerName,
    salesDt: stamp(inv.issuedAt).slice(0, 8),
    cfmDt: stamp(inv.issuedAt),
    totItemCnt: 1,
    totTaxblAmt: supply,
    totTaxAmt: vat,
    totAmt: Math.round((supply + vat) * 100) / 100,
    itemList: [
      {
        itemSeq: 1,
        itemCd: inv.kind === 'PRODUCE' ? `${inv.crop}-${inv.grade}` : inv.kind,
        itemNm:
          inv.kind === 'PRODUCE'
            ? `${inv.crop?.toLowerCase()} grade ${inv.grade}`
            : inv.kind === 'TRANSPORT'
              ? 'Haulage of produce'
              : 'Agri-OS marketplace and settlement service',
        qty: inv.kind === 'PRODUCE' ? qtyKg : 1,
        qtyUnitCd: inv.kind === 'PRODUCE' ? 'KG' : 'U',
        prc: inv.kind === 'PRODUCE' ? kwacha(inv.unitPriceNgwee ?? 0) : supply,
        splyAmt: supply,
        vatCatCd: vat > 0 ? 'A' : 'E',
        vatAmt: vat,
        totAmt: Math.round((supply + vat) * 100) / 100,
      },
    ],
  }
}

export async function submitToVsdc(worldId: string, inv: Invoice): Promise<VsdcOutcome> {
  try {
    const response = await send({
      method: 'POST',
      url: `${config.appUrl()}/api/sim/vsdc/${worldId}/trnsSales/saveSales`,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(toVsdcPayload(inv)),
    })
    const json = parseJson(response.text) as { resultCd?: string; resultMsg?: string; data?: VsdcReceipt } | null
    if (response.status >= 500 || json?.resultCd === '999') return { kind: 'unavailable', reason: json?.resultMsg ?? `VSDC answered ${response.status}` }
    if (json?.resultCd === '000' && json.data) return { kind: 'accepted', receipt: json.data }
    return { kind: 'rejected', code: json?.resultCd ?? String(response.status), message: json?.resultMsg ?? 'Rejected' }
  } catch (error) {
    if (error instanceof ProviderTimeoutError || error instanceof ProviderNetworkError) return { kind: 'unavailable', reason: error.message }
    throw error
  }
}
