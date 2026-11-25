import { formatWeight } from '@/domain/produce'
import { toDecimalString } from '@/domain/money'
import { worldRoute } from '@/server/http'
import { listInvoices } from '@/server/invoices'

/** Spreadsheet cells starting with = + - @ can run formulas when opened; prefix them so they stay text. */
function cell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Every invoice this sandbox can see, as CSV (the compliance export ZRA would pull). */
export const GET = worldRoute(async (_request, { world }) => {
  const list = await listInvoices(world.id, { limit: 10_000 })
  const header = ['number', 'issued_at', 'kind', 'source', 'seller', 'seller_tpin', 'buyer', 'buyer_tpin', 'district', 'crop', 'grade', 'quantity', 'subtotal_zmw', 'vat_zmw', 'withholding_zmw', 'total_zmw', 'vsdc_receipt', 'signature_key']
  const lines = list.map((i) =>
    [
      i.number,
      i.issuedAt.toISOString(),
      i.kind,
      i.source,
      i.sellerName,
      i.sellerTpin,
      i.buyerName,
      i.buyerTpin,
      i.districtId,
      i.crop,
      i.grade,
      i.quantityGrams ? formatWeight(i.quantityGrams) : '',
      toDecimalString(i.subtotalNgwee),
      toDecimalString(i.vatNgwee),
      toDecimalString(i.withholdingNgwee),
      toDecimalString(i.totalNgwee),
      i.vsdcReceiptNo,
      i.keyId,
    ]
      .map(cell)
      .join(','),
  )
  return new Response([header.join(','), ...lines].join('\r\n'), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="agri-os-invoices-${new Date().toISOString().slice(0, 10)}.csv"`, 'cache-control': 'no-store' },
  })
})
