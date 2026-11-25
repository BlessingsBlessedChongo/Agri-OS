import { applyBasisPoints, type Ngwee } from './money'

/**
 * Tax is data, not code. Each rule says what it applies to, at what rate, and whether Agri-OS pays it to ZRA at
 * settlement (REMIT) or only records it on the invoice for the seller to file (RECORD).
 *
 * The defaults are illustrative, not tax advice: the standard VAT rate on Agri-OS's own service, VAT recorded for
 * VAT-registered hauliers, unprocessed produce treated as exempt, and a withholding on produce that is OFF because
 * no legal basis has been confirmed. Every rule can be changed in a sandbox to see how money would flow.
 */
export type TaxKind = 'VAT' | 'WITHHOLDING'
export type TaxBase = 'PRODUCE' | 'TRANSPORT' | 'SERVICE_FEE'
export type TaxCollection = 'REMIT' | 'RECORD'
export type TaxCondition = 'ALWAYS' | 'SELLER_VAT_REGISTERED' | 'SELLER_NOT_VAT_REGISTERED'

export interface TaxRule {
  code: string
  name: string
  kind: TaxKind
  base: TaxBase
  rateBp: number
  collection: TaxCollection
  appliesWhen: TaxCondition
  enabled: boolean
  note: string
}

export const DEFAULT_TAX_RULES: readonly TaxRule[] = [
  {
    code: 'VAT_SERVICE_FEE',
    name: 'VAT on the Agri-OS service fee',
    kind: 'VAT',
    base: 'SERVICE_FEE',
    rateBp: 1600,
    collection: 'REMIT',
    appliesWhen: 'ALWAYS',
    enabled: true,
    note: 'Standard-rated service, charged to the buyer and paid to ZRA at settlement.',
  },
  {
    code: 'VAT_TRANSPORT',
    name: 'VAT on haulage by VAT-registered transporters',
    kind: 'VAT',
    base: 'TRANSPORT',
    rateBp: 1600,
    collection: 'RECORD',
    appliesWhen: 'SELLER_VAT_REGISTERED',
    enabled: true,
    note: 'Charged to the buyer and paid to the transporter, who files it. Recorded on the transport invoice.',
  },
  {
    code: 'VAT_PRODUCE',
    name: 'VAT on unprocessed produce',
    kind: 'VAT',
    base: 'PRODUCE',
    rateBp: 0,
    collection: 'RECORD',
    appliesWhen: 'ALWAYS',
    enabled: true,
    note: 'Treated as exempt here; smallholders are not VAT-registered. To be confirmed with ZRA.',
  },
  {
    code: 'WHT_PRODUCE',
    name: 'Withholding on produce sales',
    kind: 'WITHHOLDING',
    base: 'PRODUCE',
    rateBp: 0,
    collection: 'REMIT',
    appliesWhen: 'ALWAYS',
    enabled: false,
    note: 'Off: no legal basis has been confirmed. Turn it on in a sandbox to see how a withholding would flow.',
  },
]

export interface TaxLine {
  code: string
  name: string
  kind: TaxKind
  rateBp: number
  collection: TaxCollection
  amount: Ngwee
}

function applies(condition: TaxCondition, seller: { vatRegistered: boolean }): boolean {
  if (condition === 'ALWAYS') return true
  return condition === 'SELLER_VAT_REGISTERED' ? seller.vatRegistered : !seller.vatRegistered
}

/** The taxes that apply to one amount. Withholding is always remitted; zero-rate rules produce no line. */
export function taxesFor(base: TaxBase, amount: Ngwee, seller: { vatRegistered: boolean }, rules: readonly TaxRule[]): TaxLine[] {
  return rules
    .filter((r) => r.enabled && r.base === base && r.rateBp > 0 && applies(r.appliesWhen, seller))
    .map((r) => ({
      code: r.code,
      name: r.name,
      kind: r.kind,
      rateBp: r.rateBp,
      collection: r.kind === 'WITHHOLDING' ? ('REMIT' as const) : r.collection,
      amount: applyBasisPoints(amount, r.rateBp),
    }))
}

/** How one taxed amount splits between buyer, seller and ZRA. */
export interface TaxedAmount {
  base: Ngwee
  lines: TaxLine[]
  /** VAT added on top, paid by the buyer. */
  vat: Ngwee
  withholding: Ngwee
  /** What the seller receives: base − withholding + VAT the seller files itself. */
  toSeller: Ngwee
  /** What goes to ZRA now: withholding + VAT that Agri-OS remits. */
  toZra: Ngwee
  /** What the buyer pays: base + all VAT. */
  fromBuyer: Ngwee
}

export function applyTaxes(base: TaxBase, amount: Ngwee, seller: { vatRegistered: boolean }, rules: readonly TaxRule[], options: { forceRemit?: boolean } = {}): TaxedAmount {
  const lines = taxesFor(base, amount, seller, rules).map((l) => (options.forceRemit ? { ...l, collection: 'REMIT' as const } : l))
  let vat = 0
  let withholding = 0
  let vatRecord = 0
  let toZra = 0
  for (const line of lines) {
    if (line.kind === 'VAT') {
      vat += line.amount
      if (line.collection === 'REMIT') toZra += line.amount
      else vatRecord += line.amount
    } else {
      withholding += line.amount
      toZra += line.amount
    }
  }
  return { base: amount, lines, vat, withholding, toSeller: amount - withholding + vatRecord, toZra, fromBuyer: amount + vat }
}

/** World-specific rules override the defaults by code. */
export function mergeRules(defaults: readonly TaxRule[], overrides: readonly TaxRule[]): TaxRule[] {
  const byCode = new Map(defaults.map((r) => [r.code, r]))
  for (const o of overrides) byCode.set(o.code, o)
  return [...byCode.values()]
}
