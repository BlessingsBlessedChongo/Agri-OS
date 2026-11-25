import { notFound } from '@/server/errors'
import { json, route } from '@/server/http'
import { verifyInvoice } from '@/server/invoices'
import { publicKeyInfo } from '@/server/signing'

/** Public: what the QR code on an invoice opens. Checks the Agri-OS signature and shows the VSDC receipt. */
export const GET = route<{ id: string }>(async (_request, { params }) => {
  const result = await verifyInvoice(params.id)
  if (!result) throw notFound('Invoice')
  return json({ ...result, publicKey: publicKeyInfo() })
})
