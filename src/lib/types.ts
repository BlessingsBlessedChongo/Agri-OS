/** Shapes the browser receives from the API (dates arrive as ISO strings). */
import type { ChaosSettings } from '@/domain/chaos'
import type { CreditResult } from '@/domain/credit'
import type { CropCode, Grade } from '@/domain/produce'
import type { TaxRule } from '@/domain/tax'

export interface World {
  id: string
  kind: 'sandbox' | 'live'
  chaos: ChaosSettings
  createdAt: string
  events: number
  guide: { id: string; name: string; phone: string } | null
}

export interface FeedEvent {
  seq: number
  type: string
  entityType: string
  entityId: string
  actor: string
  payload: Record<string, unknown>
  occurredAt: string
}

export interface Depot {
  id: string
  code: string
  name: string
  districtId: string
  districtName: string
  provinceName: string
  operator: string
  clerkName: string
  clerkPhone: string
  lat: number
  lng: number
}

export interface Buyer {
  id: string
  code: string
  name: string
  tpin: string
  plantName: string
  districtId: string
  phone: string
  lat: number
  lng: number
}

export interface Transporter {
  id: string
  code: string
  name: string
  phone: string
  vatRegistered: boolean
  truckReg: string
  capacityKg: number
  tareKg: number
  rateNgweePerTonneKm: number
}

export interface FarmerSummary {
  id: string
  code: string
  name: string
  phone: string
  depotId: string | null
  districtId: string
  language: 'en' | 'bem' | 'nya'
  registeredHere: boolean
}

export interface Reference {
  depots: Depot[]
  buyers: Buyer[]
  transporters: Transporter[]
  farmers: FarmerSummary[]
}

export type OrderStatus = 'FUNDING' | 'OPEN' | 'CLOSED' | 'COMPLETED' | 'CANCELLED'

export interface Order {
  id: string
  ref: string
  buyerId: string
  crop: CropCode
  minGrade: Grade
  quantityKg: number
  priceNgweePerKg: number
  feeBp: number
  status: OrderStatus
  escrowTargetNgwee: number
  deliverBy: string
  createdAt: string
  fundedAt: string | null
  closedAt: string | null
  completedAt: string | null
  pledgedKg?: number
  deliveredGrams?: number
  settledGrams?: number
}

export interface Pledge {
  id: string
  ref: string
  orderId: string
  farmerId: string
  depotId: string
  bags: number
  kgPledged: number
  kgDelivered: number
  status: 'PLEDGED' | 'DELIVERED' | 'CANCELLED' | 'EXPIRED'
  channel: 'USSD' | 'APP'
  createdAt: string
}

export interface Delivery {
  id: string
  ref: string
  orderId: string
  depotId: string
  farmerId: string
  pledgeId: string | null
  consignmentId: string | null
  bags: number
  netGrams: number
  moisture10: number
  grade: Grade
  payableGrams: number
  amountNgwee: number
  status: 'RECEIVED' | 'REJECTED' | 'LOADED' | 'SETTLED'
  rejectReason: string | null
  scaleMode: 'SCALE' | 'MANUAL'
  recordedOffline: boolean
  recordedAt: string
  receivedAt: string
}

export interface Consignment {
  id: string
  ref: string
  orderId: string
  depotId: string
  transporterId: string
  truckReg: string
  depotGrams: number
  distanceKm: number
  transportFeeNgwee: number
  status: 'IN_TRANSIT' | 'WEIGHED' | 'SETTLED' | 'HELD'
  arrivedGrams: number | null
  varianceGrams: number | null
  holdReason: string | null
  dispatchedAt: string
  weighedAt: string | null
  settledAt: string | null
}

export interface Payout {
  id: string
  kind: 'FARMER' | 'TRANSPORTER' | 'TAX' | 'REFUND'
  partyId: string
  partyName: string
  msisdn: string
  amountNgwee: number
  status: 'QUEUED' | 'SENT' | 'UNKNOWN' | 'SUCCEEDED' | 'RETRY_WAIT' | 'FAILED'
  attempt: number
  providerTxnId: string | null
  lastError: string | null
  createdAt: string
  succeededAt: string | null
}

export interface Collection {
  id: string
  amountNgwee: number
  status: 'PENDING' | 'UNKNOWN' | 'SUCCEEDED' | 'FAILED'
  lastError: string | null
  createdAt: string
}

export interface OrderDetail {
  order: Order
  buyer: Buyer
  crop: { code: CropCode; name: string; bagKg: number }
  depots: Array<{ depot: Depot; distanceKm: number }>
  escrow: { targetNgwee: number; fundedNgwee: number }
  progress: { pledgedKg: number; deliveredGrams: number; settledGrams: number; paidNgwee: number }
  pledges: Pledge[]
  deliveries: Delivery[]
  consignments: Consignment[]
  collections: Collection[]
  payouts: Payout[]
}

export interface Invoice {
  id: string
  number: string
  kind: 'PRODUCE' | 'TRANSPORT' | 'SERVICE'
  source: 'live' | 'history'
  sellerKind: 'FARMER' | 'TRANSPORTER' | 'PLATFORM'
  sellerName: string
  sellerTpin: string | null
  buyerName: string
  buyerTpin: string
  districtId: string
  crop: CropCode | null
  grade: Grade | null
  quantityGrams: number | null
  unitPriceNgwee: number | null
  subtotalNgwee: number
  vatNgwee: number
  withholdingNgwee: number
  totalNgwee: number
  issuedAt: string
  vsdcStatus: 'PENDING' | 'ACCEPTED' | 'FAILED'
  vsdcReceiptNo: number | null
  vsdcAttempts: number
  worldId: string | null
  orderId: string | null
}

export interface RiskFlag {
  id: string
  worldId: string | null
  type: string
  severity: 'LOW' | 'MEDIUM' | 'HIGH'
  title: string
  explanation: string
  evidence: Record<string, unknown>
  districtId: string | null
  createdAt: string
}

export interface ZraData {
  overview: {
    season: { produceValueNgwee: number; grams: number; farmers: number; produceInvoices: number; invoices: number; taxToZraNgwee: number; vatRecordedNgwee: number; buyers: number }
    live: { produceValueNgwee: number; invoices: number; taxToZraNgwee: number; pendingAtVsdc: number }
    byDistrict: Array<{ districtId: string; valueNgwee: number; grams: number; invoices: number; live: number }>
    byCrop: Array<{ crop: CropCode; valueNgwee: number; grams: number }>
  }
  flags: RiskFlag[]
  recent: Invoice[]
}

export interface PriceWeek {
  week: string
  medianNgwee: number
  p25Ngwee: number
  p75Ngwee: number
  sales: number
}

export interface FarmerDetail {
  farmer: FarmerSummary & { joinedAt: string; districtId: string }
  district: { id: string; name: string; provinceName: string } | null
  depot: Depot | null
  credit: CreditResult
  pledges: Array<{ pledge: Pledge; crop: CropCode }>
  payouts: Payout[]
  invoices: Invoice[]
}

export interface ResilienceData {
  reconciliation:
    | { status: 'UNAVAILABLE'; message: string }
    | {
        status: 'BALANCED' | 'SETTLING' | 'MISMATCH'
        providerBalanceNgwee: number
        ledgerBalanceNgwee: number
        differenceNgwee: number
        explainedByInFlightNgwee: number
        matched: number
        awaiting: Array<{ transactionId: string; type: string; amountNgwee: number; reference: string }>
        mismatches: Array<{ transactionId: string; problem: string }>
        checkedAt: string
      }
  report: {
    callbacks: { received: number; duplicatesIgnored: number; staleIgnored: number }
    payouts: { succeeded: number; timeoutsResolved: number; retriedAfterFailure: number; recoveredByPolling: number; gaveUp: number }
    invoices: { accepted: number; pending: number; retries: number }
    doublePayments: number
    jobs: { due: number; scheduled: number; failed: number }
    ledger: { accounts: number; entries: number; lines: number; sumOfBalances: number; balancesMatchLines: boolean; unbalancedEntries: number; ok: boolean }
  }
  chaos: ChaosSettings
}

export type { ChaosSettings, CreditResult, TaxRule }
