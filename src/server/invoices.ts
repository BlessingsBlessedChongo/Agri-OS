import { and, desc, eq, isNull, or, sql } from 'drizzle-orm'
import { canonicalJson } from '@/domain/chain'
import { submitToVsdc } from '@/integrations/vsdc/client'
import { db, rows } from './db'
import { invoices } from './schema'
import { keys, signText, verifyText } from './signing'
import { inWorld } from './uow'

type Invoice = typeof invoices.$inferSelect

/** The fields an invoice signature covers. Anything shown as "the invoice" must be in here. */
export function invoiceDocument(inv: Invoice) {
  return {
    number: inv.number,
    kind: inv.kind,
    seller: { kind: inv.sellerKind, name: inv.sellerName, tpin: inv.sellerTpin },
    buyer: { name: inv.buyerName, tpin: inv.buyerTpin },
    district: inv.districtId,
    item: inv.kind === 'PRODUCE' ? { crop: inv.crop, grade: inv.grade, grams: inv.quantityGrams, unitPriceNgwee: inv.unitPriceNgwee } : { description: inv.kind },
    subtotalNgwee: inv.subtotalNgwee,
    vatNgwee: inv.vatNgwee,
    withholdingNgwee: inv.withholdingNgwee,
    totalNgwee: inv.totalNgwee,
    issuedAt: inv.issuedAt.toISOString(),
    vsdc: { receiptNo: inv.vsdcReceiptNo, internalData: inv.vsdcInternalData, signature: inv.vsdcSignature },
  }
}

export function signInvoice(inv: Invoice): { signature: string; keyId: string } {
  return { signature: signText(`agri-os/invoice/v1\n${canonicalJson(invoiceDocument(inv))}`), keyId: keys().keyId }
}

/** Job: send an invoice to the VSDC; on acceptance, sign it (the signature covers the receipt number). */
export async function submitInvoice(worldId: string, invoiceId: string): Promise<void> {
  const [inv] = await db.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.worldId, worldId)))
  if (!inv || inv.vsdcStatus !== 'PENDING') return
  await db.update(invoices).set({ vsdcAttempts: sql`${invoices.vsdcAttempts} + 1` }).where(eq(invoices.id, invoiceId))
  const outcome = await submitToVsdc(worldId, inv)
  if (outcome.kind === 'unavailable') throw new Error(`VSDC unavailable: ${outcome.reason}`)
  await inWorld(worldId, async (u) => {
    const [current] = await rows<{ vsdc_status: string }>(u.tx, sql`select vsdc_status from invoices where id = ${invoiceId} for update`)
    if (current?.vsdc_status !== 'PENDING') return
    if (outcome.kind === 'rejected') {
      await u.tx.update(invoices).set({ vsdcStatus: 'FAILED' }).where(eq(invoices.id, invoiceId))
      u.emit({ type: 'invoice.rejected', entityType: 'invoice', entityId: invoiceId, actor: 'vsdc', payload: { number: inv.number, code: outcome.code, message: outcome.message } })
      return
    }
    const accepted: Invoice = {
      ...inv,
      vsdcStatus: 'ACCEPTED',
      vsdcReceiptNo: outcome.receipt.rcptNo,
      vsdcInternalData: outcome.receipt.intrlData,
      vsdcSignature: outcome.receipt.rcptSign,
    }
    const { signature, keyId } = signInvoice(accepted)
    await u.tx
      .update(invoices)
      .set({ vsdcStatus: 'ACCEPTED', vsdcReceiptNo: accepted.vsdcReceiptNo, vsdcInternalData: accepted.vsdcInternalData, vsdcSignature: accepted.vsdcSignature, vsdcAcceptedAt: new Date(), signature, keyId })
      .where(eq(invoices.id, invoiceId))
    u.emit({
      type: 'invoice.accepted',
      entityType: 'invoice',
      entityId: invoiceId,
      actor: 'vsdc',
      payload: { number: inv.number, kind: inv.kind, seller: inv.sellerName, totalNgwee: inv.totalNgwee, vatNgwee: inv.vatNgwee, receiptNo: outcome.receipt.rcptNo, attempts: inv.vsdcAttempts + 1 },
    })
  })
}

/** Public verification: anyone with the QR code can check an invoice was issued and has not been altered. */
export async function verifyInvoice(invoiceId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) return null
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId))
  if (!inv) return null
  const statement = `agri-os/invoice/v1\n${canonicalJson(invoiceDocument(inv))}`
  const signatureValid = inv.signature ? verifyText(statement, inv.signature) : false
  return {
    invoice: { ...invoiceDocument(inv), id: inv.id, source: inv.source, vsdcStatus: inv.vsdcStatus, taxLines: inv.taxLines },
    signature: inv.signature,
    keyId: inv.keyId,
    signatureValid,
    status: inv.vsdcStatus !== 'ACCEPTED' ? ('PENDING' as const) : signatureValid ? ('VALID' as const) : ('ALTERED' as const),
  }
}

export async function listInvoices(worldId: string, options: { limit?: number; kind?: Invoice['kind']; liveOnly?: boolean } = {}) {
  const scope = options.liveOnly ? eq(invoices.worldId, worldId) : or(isNull(invoices.worldId), eq(invoices.worldId, worldId))!
  return db
    .select()
    .from(invoices)
    .where(options.kind ? and(scope, eq(invoices.kind, options.kind)) : scope)
    .orderBy(desc(invoices.issuedAt), desc(invoices.number))
    .limit(options.limit ?? 50)
}
