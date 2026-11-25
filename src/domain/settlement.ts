import { ACCOUNTS, type Posting } from './accounts'
import { applyBasisPoints, divRound, sum, toSafeNumber, type Ngwee } from './money'
import { applyTaxes, type TaxedAmount, type TaxLine, type TaxRule } from './tax'
import type { TransitCheck } from './transport'

/**
 * One settlement = one truck (consignment) accepted at the buyer's weighbridge.
 *
 * Who pays what:
 * - Farmers are paid for what the depot weighed and graded. They handed the produce over there; they never pay fees.
 * - The transporter is paid per tonne-km, less the value of any loss beyond the 0.5 % transit allowance.
 * - The buyer pays produce + haulage + the Agri-OS fee (1 %) + VAT on the fee (and any other VAT the rules add).
 * - ZRA receives, at settlement, every tax the rules say Agri-OS remits.
 *
 * The result includes signed ledger postings that always balance; `computeSettlement` checks this before returning.
 */
export interface SettlementInput {
  order: { id: string; ref: string; feeBp: number }
  deliveries: ReadonlyArray<{ id: string; farmerId: string; farmerName: string; payableGrams: number; amount: Ngwee }>
  transporter: { id: string; name: string; vatRegistered: boolean }
  transportGross: Ngwee
  transit: TransitCheck
  rules: readonly TaxRule[]
}

export interface FarmerShare {
  farmerId: string
  farmerName: string
  deliveryIds: string[]
  gross: Ngwee
  withholding: Ngwee
  vatToSeller: Ngwee
  net: Ngwee
}

export interface SettlementBreakdown {
  produce: { total: Ngwee; payableGrams: number; taxes: TaxLine[]; vat: Ngwee; withholding: Ngwee; toZra: Ngwee }
  farmers: FarmerShare[]
  transport: {
    gross: Ngwee
    lossGrams: number
    lossValue: Ngwee
    deduction: Ngwee
    /** Loss value the haulage fee could not cover (an insurance matter). */
    uncovered: Ngwee
    charged: Ngwee
    taxed: TaxedAmount
    payout: Ngwee
  }
  fee: { rateBp: number; amount: Ngwee; taxed: TaxedAmount }
  toZra: Ngwee
  buyerTotal: Ngwee
  postings: Posting[]
}

export class UnbalancedSettlementError extends Error {}

export function computeSettlement(input: SettlementInput): SettlementBreakdown {
  if (input.deliveries.length === 0) throw new RangeError('A settlement needs at least one delivery')

  // Produce: each delivery is taxed on its own (a farmer could deliver twice); shares are then grouped per farmer.
  const byFarmer = new Map<string, FarmerShare>()
  const produceTaxes: TaxLine[] = []
  let produceVat = 0
  let produceWithholding = 0
  let produceToZra = 0
  for (const d of input.deliveries) {
    const taxed = applyTaxes('PRODUCE', d.amount, { vatRegistered: false }, input.rules)
    produceTaxes.push(...taxed.lines)
    produceVat += taxed.vat
    produceWithholding += taxed.withholding
    produceToZra += taxed.toZra
    const share = byFarmer.get(d.farmerId) ?? { farmerId: d.farmerId, farmerName: d.farmerName, deliveryIds: [], gross: 0, withholding: 0, vatToSeller: 0, net: 0 }
    share.deliveryIds.push(d.id)
    share.gross += d.amount
    share.withholding += taxed.withholding
    share.vatToSeller += taxed.toSeller - (d.amount - taxed.withholding)
    share.net += taxed.toSeller
    byFarmer.set(d.farmerId, share)
  }
  const produceTotal = sum(input.deliveries.map((d) => d.amount))
  const payable = input.deliveries.reduce((a, d) => a + d.payableGrams, 0)

  // Transit loss is valued at the average price of this load and comes out of the haulage fee.
  const lossGrams = input.transit.chargeableLossGrams
  const lossValue = lossGrams > 0 && payable > 0 ? toSafeNumber(divRound(BigInt(lossGrams) * BigInt(produceTotal), BigInt(payable))) : 0
  const deduction = Math.min(lossValue, input.transportGross)
  const charged = input.transportGross - deduction
  const transportTaxed = applyTaxes('TRANSPORT', charged, { vatRegistered: input.transporter.vatRegistered }, input.rules)

  // The fee is Agri-OS's own service: its VAT is always paid to ZRA.
  const feeAmount = applyBasisPoints(produceTotal, input.order.feeBp)
  const feeTaxed = applyTaxes('SERVICE_FEE', feeAmount, { vatRegistered: true }, input.rules, { forceRemit: true })

  const toZra = produceToZra + transportTaxed.toZra + feeTaxed.toZra
  const buyerTotal = produceTotal + produceVat + transportTaxed.fromBuyer + feeTaxed.fromBuyer

  const postings: Posting[] = [{ account: ACCOUNTS.escrow(input.order.id, input.order.ref), amount: buyerTotal }]
  for (const share of byFarmer.values()) {
    if (share.net !== 0) postings.push({ account: ACCOUNTS.farmer(share.farmerId, share.farmerName), amount: -share.net })
  }
  if (transportTaxed.toSeller !== 0) postings.push({ account: ACCOUNTS.transporter(input.transporter.id, input.transporter.name), amount: -transportTaxed.toSeller })
  if (feeAmount !== 0) postings.push({ account: ACCOUNTS.fees, amount: -feeAmount })
  if (toZra !== 0) postings.push({ account: ACCOUNTS.zra, amount: -toZra })

  const balance = postings.reduce((a, p) => a + p.amount, 0)
  if (balance !== 0) throw new UnbalancedSettlementError(`Settlement postings are off by ${balance} ngwee`)

  return {
    produce: { total: produceTotal, payableGrams: payable, taxes: produceTaxes, vat: produceVat, withholding: produceWithholding, toZra: produceToZra },
    farmers: [...byFarmer.values()],
    transport: { gross: input.transportGross, lossGrams, lossValue, deduction, uncovered: lossValue - deduction, charged, taxed: transportTaxed, payout: transportTaxed.toSeller },
    fee: { rateBp: input.order.feeBp, amount: feeAmount, taxed: feeTaxed },
    toZra,
    buyerTotal,
    postings,
  }
}

/**
 * What a buyer must put in escrow before an order opens: the most the order could cost
 * (every kilo at grade A, haulage from the farthest depot, fee and VAT), plus 2 % headroom.
 * Whatever is not used is refunded when the order closes.
 */
export function escrowTarget(input: {
  quantityKg: number
  pricePerKgNgwee: number
  feeBp: number
  maxTransportNgwee: Ngwee
  rules: readonly TaxRule[]
}): Ngwee {
  const produce = input.quantityKg * input.pricePerKgNgwee
  const produceTaxed = applyTaxes('PRODUCE', produce, { vatRegistered: false }, input.rules)
  const transportTaxed = applyTaxes('TRANSPORT', input.maxTransportNgwee, { vatRegistered: true }, input.rules)
  const fee = applyBasisPoints(produce, input.feeBp)
  const feeTaxed = applyTaxes('SERVICE_FEE', fee, { vatRegistered: true }, input.rules, { forceRemit: true })
  const total = produceTaxed.fromBuyer + transportTaxed.fromBuyer + feeTaxed.fromBuyer
  return Math.ceil((total + applyBasisPoints(total, 200)) / 100) * 100
}
