import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import QRCode from 'qrcode'
import { CheckCircle2, Clock, XCircle } from 'lucide-react'
import { formatKwacha } from '@/domain/money'
import { formatWeight } from '@/domain/produce'
import { catTime } from '@/lib/describe'
import { config } from '@/server/config'
import { db } from '@/server/db'
import { verifyInvoice } from '@/server/invoices'
import { getDistrict } from '@/server/reference'
import { keys } from '@/server/signing'
import { cx, Hash } from '@/ui/kit'

export const metadata: Metadata = { title: 'Verify an invoice' }

const KIND = { PRODUCE: 'Purchase of produce, issued by the buyer on the farmer’s behalf', TRANSPORT: 'Haulage', SERVICE: 'Agri-OS marketplace and settlement service' }

export default async function VerifyInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await verifyInvoice(id)
  if (!result) notFound()
  const inv = result.invoice
  const district = await getDistrict(db, inv.district)
  const url = `${config.appUrl()}/verify/${id}`
  const qr = await QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#16221bff', light: '#00000000' } })
  const status = result.status
  const item = inv.item as { crop?: string; grade?: string; grams?: number; unitPriceNgwee?: number; description?: string }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className={cx('flex items-start gap-3 rounded-[10px] px-5 py-4', status === 'VALID' ? 'bg-leaf-wash text-leaf' : status === 'ALTERED' ? 'bg-chili-wash text-chili' : 'bg-maize-wash text-ink')} role="status">
        {status === 'VALID' ? <CheckCircle2 size={30} aria-hidden /> : status === 'ALTERED' ? <XCircle size={30} aria-hidden /> : <Clock size={30} aria-hidden />}
        <div>
          <h1 className="font-display text-3xl leading-none font-extrabold tracking-wide">
            {status === 'VALID' ? 'Genuine invoice' : status === 'ALTERED' ? 'This invoice has been altered' : 'Not yet accepted'}
          </h1>
          <p className="mt-1 text-sm">
            {status === 'VALID'
              ? 'Signed by Agri-OS and accepted by the VSDC. Nothing on it has changed since.'
              : status === 'ALTERED'
                ? 'Its contents no longer match the signature Agri-OS put on it. Do not rely on it.'
                : 'Agri-OS has sent it to the VSDC and is waiting for a receipt number. Check again in a moment.'}
          </p>
        </div>
      </div>

      <article className="rounded-[6px] border border-rule bg-sheet px-6 py-6 shadow-sm">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-dashed border-rule pb-4">
          <div>
            <div className="font-display text-4xl leading-none font-extrabold tracking-wide">{inv.number}</div>
            <div className="mt-1 text-sm text-ink-2">{KIND[inv.kind as keyof typeof KIND]}</div>
            <div className="text-sm text-ink-3">
              Issued {catTime(inv.issuedAt)}, {district?.name ?? inv.district} District
              {inv.source === 'history' ? ', from last season’s history' : ''}
            </div>
          </div>
          <div className="h-28 w-28" aria-label="QR code linking to this page" dangerouslySetInnerHTML={{ __html: qr }} />
        </header>

        <div className="grid gap-6 border-b border-dashed border-rule py-4 sm:grid-cols-2">
          <div>
            <div className="text-xs text-ink-3">Seller</div>
            <div className="font-semibold">{inv.seller.name}</div>
            <div className="text-sm text-ink-3">{inv.seller.tpin ? `TPIN ${inv.seller.tpin}` : 'Smallholder, not VAT-registered'}</div>
          </div>
          <div>
            <div className="text-xs text-ink-3">Buyer</div>
            <div className="font-semibold">{inv.buyer.name}</div>
            <div className="text-sm text-ink-3">TPIN {inv.buyer.tpin}</div>
          </div>
        </div>

        <table className="my-4 w-full text-left text-sm tabular">
          <tbody>
            {inv.kind === 'PRODUCE' ? (
              <tr>
                <td className="py-1">
                  {item.crop?.toLowerCase()} grade {item.grade}, {formatWeight(item.grams ?? 0)} at {formatKwacha(item.unitPriceNgwee ?? 0)}/kg
                </td>
                <td className="py-1 text-right">{formatKwacha(inv.subtotalNgwee)}</td>
              </tr>
            ) : (
              <tr>
                <td className="py-1">{KIND[inv.kind as keyof typeof KIND]}</td>
                <td className="py-1 text-right">{formatKwacha(inv.subtotalNgwee)}</td>
              </tr>
            )}
            <tr className="text-ink-2">
              <td className="py-1">VAT{inv.vatNgwee === 0 && inv.kind === 'PRODUCE' ? ' (unprocessed produce, treated as exempt)' : ''}</td>
              <td className="py-1 text-right">{formatKwacha(inv.vatNgwee)}</td>
            </tr>
            {inv.withholdingNgwee > 0 && (
              <tr className="text-ink-2">
                <td className="py-1">Withheld and paid to ZRA</td>
                <td className="py-1 text-right">{formatKwacha(inv.withholdingNgwee)}</td>
              </tr>
            )}
            <tr className="border-t border-rule font-semibold">
              <td className="py-2">Total</td>
              <td className="py-2 text-right text-lg">{formatKwacha(inv.totalNgwee)}</td>
            </tr>
          </tbody>
        </table>

        <dl className="grid grid-cols-[9rem_1fr] gap-y-1.5 border-t border-dashed border-rule pt-4 text-sm">
          <dt className="text-ink-3">VSDC receipt</dt>
          <dd className="tabular">{inv.vsdc.receiptNo ? `No. ${inv.vsdc.receiptNo}` : 'Waiting'}</dd>
          <dt className="text-ink-3">VSDC internal data</dt>
          <dd>{inv.vsdc.internalData ? <Hash value={inv.vsdc.internalData} length={26} /> : '—'}</dd>
          <dt className="text-ink-3">VSDC signature</dt>
          <dd>{inv.vsdc.signature ? <Hash value={inv.vsdc.signature} length={24} /> : '—'}</dd>
          <dt className="text-ink-3">Agri-OS signature</dt>
          <dd>{result.signature ? <Hash value={result.signature} length={24} /> : '—'}</dd>
          <dt className="text-ink-3">Signing key</dt>
          <dd>
            Ed25519 <Hash value={result.keyId ?? keys().keyId} />,{' '}
            <a className="text-leaf underline-offset-2 hover:underline" href="/api/public/keys">
              public key
            </a>
          </dd>
        </dl>
      </article>

      <p className="text-sm text-ink-3">
        A demonstration: the VSDC here is a simulator and the parties are fictional. The signature check is real: it uses Agri-OS’s Ed25519 public key over the invoice’s exact
        contents.
      </p>
    </div>
  )
}
