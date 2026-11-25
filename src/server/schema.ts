import { sql } from 'drizzle-orm'
import {
  bigint,
  bigserial,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import type { AccountType } from '@/domain/accounts'
import type { CropCode, Grade } from '@/domain/produce'
import type { RiskSeverity, RiskType } from '@/domain/risk'
import type { TaxBase, TaxCollection, TaxCondition, TaxKind } from '@/domain/tax'
import type { ChaosSettings } from '@/domain/chaos'

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })
const createdAt = () => ts('created_at').notNull().defaultNow()
const money = (name: string) => bigint(name, { mode: 'number' })

/**
 * A world is one sandbox: every visitor gets their own, so demos never collide and never break.
 * Reference data (farmers, depots, buyers, transporters, last season's history) is shared and read-only
 * (world_id IS NULL); everything that changes lives in the visitor's world and is deleted with it.
 */
export const worlds = pgTable('worlds', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').$type<'sandbox' | 'live'>().notNull().default('sandbox'),
  chaos: jsonb('chaos').$type<ChaosSettings>().notNull().default(sql`'{}'::jsonb`),
  /** The tamper demo remembers what it changed, so the visitor can put it back. */
  tamper: jsonb('tamper').$type<{ seq: number; original: unknown; field: string } | null>(),
  ipHash: text('ip_hash'),
  createdAt: createdAt(),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  expiresAt: ts('expires_at'),
})

export const districts = pgTable('districts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  province: text('province').notNull(),
  provinceName: text('province_name').notNull(),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
})

const worldNullable = () => uuid('world_id').references(() => worlds.id, { onDelete: 'cascade' })
const worldRequired = () =>
  uuid('world_id')
    .notNull()
    .references(() => worlds.id, { onDelete: 'cascade' })

export const depots = pgTable(
  'depots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    worldId: worldNullable(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    districtId: text('district_id').notNull().references(() => districts.id),
    operator: text('operator').notNull(),
    clerkName: text('clerk_name').notNull(),
    clerkPhone: text('clerk_phone').notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique('depots_code_uq').on(t.worldId, t.code).nullsNotDistinct()],
)

export const farmers = pgTable(
  'farmers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    worldId: worldNullable(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    districtId: text('district_id').notNull().references(() => districts.id),
    depotId: uuid('depot_id').references(() => depots.id),
    language: text('language').$type<'en' | 'bem' | 'nya'>().notNull().default('en'),
    /** Seeded demo people never receive a real SMS, even if an SMS provider is configured. */
    fictional: boolean('fictional').notNull().default(false),
    historyPledgedKg: integer('history_pledged_kg').notNull().default(0),
    historyDeliveredKg: integer('history_delivered_kg').notNull().default(0),
    joinedAt: ts('joined_at').notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('farmers_phone_uq').on(t.worldId, t.phone).nullsNotDistinct(),
    index('farmers_depot_idx').on(t.depotId),
  ],
)

/** Per-world settings for shared farmers (a visitor can switch a seeded farmer's language). */
export const farmerPrefs = pgTable(
  'farmer_prefs',
  {
    worldId: worldRequired(),
    farmerId: uuid('farmer_id').notNull().references(() => farmers.id, { onDelete: 'cascade' }),
    language: text('language').$type<'en' | 'bem' | 'nya'>().notNull(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.worldId, t.farmerId] })],
)

export const buyers = pgTable(
  'buyers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    worldId: worldNullable(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    tpin: text('tpin').notNull(),
    vatRegistered: boolean('vat_registered').notNull().default(true),
    plantName: text('plant_name').notNull(),
    districtId: text('district_id').notNull().references(() => districts.id),
    phone: text('phone').notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique('buyers_code_uq').on(t.worldId, t.code).nullsNotDistinct()],
)

export const transporters = pgTable(
  'transporters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    worldId: worldNullable(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    tpin: text('tpin'),
    vatRegistered: boolean('vat_registered').notNull(),
    truckReg: text('truck_reg').notNull(),
    capacityKg: integer('capacity_kg').notNull(),
    tareKg: integer('tare_kg').notNull(),
    rateNgweePerTonneKm: integer('rate_ngwee_per_tonne_km').notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique('transporters_code_uq').on(t.worldId, t.code).nullsNotDistinct()],
)

export const counters = pgTable(
  'counters',
  {
    worldId: worldRequired(),
    name: text('name').notNull(),
    value: integer('value').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.worldId, t.name] })],
)

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    worldId: worldRequired(),
    ref: text('ref').notNull(),
    buyerId: uuid('buyer_id').notNull().references(() => buyers.id),
    crop: text('crop').$type<CropCode>().notNull(),
    minGrade: text('min_grade').$type<Grade>().notNull(),
    quantityKg: integer('quantity_kg').notNull(),
    priceNgweePerKg: integer('price_ngwee_per_kg').notNull(),
    feeBp: integer('fee_bp').notNull().default(100),
    status: text('status').$type<'FUNDING' | 'OPEN' | 'CLOSED' | 'COMPLETED' | 'CANCELLED'>().notNull().default('FUNDING'),
    escrowTargetNgwee: money('escrow_target_ngwee').notNull(),
    deliverBy: ts('deliver_by').notNull(),
    createdAt: createdAt(),
    fundedAt: ts('funded_at'),
    closedAt: ts('closed_at'),
    completedAt: ts('completed_at'),
  },
  (t) => [unique('orders_ref_uq').on(t.worldId, t.ref), index('orders_world_idx').on(t.worldId, t.createdAt)],
)

export const orderDepots = pgTable(
  'order_depots',
  {
    worldId: worldRequired(),
    orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    depotId: uuid('depot_id').notNull().references(() => depots.id),
    distanceKm: integer('distance_km').notNull(),
  },
  (t) => [primaryKey({ columns: [t.orderId, t.depotId] })],
)

export const pledges = pgTable(
  'pledges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    worldId: worldRequired(),
    ref: text('ref').notNull(),
    orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    farmerId: uuid('farmer_id').notNull().references(() => farmers.id, { onDelete: 'cascade' }),
    depotId: uuid('depot_id').notNull().references(() => depots.id),
    bags: integer('bags').notNull(),
    kgPledged: integer('kg_pledged').notNull(),
    kgDelivered: integer('kg_delivered').notNull().default(0),
    status: text('status').$type<'PLEDGED' | 'DELIVERED' | 'CANCELLED' | 'EXPIRED'>().notNull().default('PLEDGED'),
    channel: text('channel').$type<'USSD' | 'APP'>().notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('pledges_ref_uq').on(t.worldId, t.ref),
    unique('pledges_idem_uq').on(t.worldId, t.idempotencyKey),
    index('pledges_order_idx').on(t.orderId),
    index('pledges_farmer_idx').on(t.worldId, t.farmerId),
  ],
)

export const consignments = pgTable(
  'consignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    worldId: worldRequired(),
    ref: text('ref').notNull(),
    orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    depotId: uuid('depot_id').notNull().references(() => depots.id),
    transporterId: uuid('transporter_id').notNull().references(() => transporters.id),
    truckReg: text('truck_reg').notNull(),
    depotGrams: integer('depot_grams').notNull(),
    distanceKm: integer('distance_km').notNull(),
    transportFeeNgwee: money('transport_fee_ngwee').notNull(),
    status: text('status').$type<'IN_TRANSIT' | 'WEIGHED' | 'SETTLED' | 'HELD'>().notNull().default('IN_TRANSIT'),
    arrivedGrams: integer('arrived_grams'),
    varianceGrams: integer('variance_grams'),
    holdReason: text('hold_reason'),
    dispatchedAt: ts('dispatched_at').notNull().defaultNow(),
    weighedAt: ts('weighed_at'),
    settledAt: ts('settled_at'),
  },
  (t) => [unique('consignments_ref_uq').on(t.worldId, t.ref), index('consignments_order_idx').on(t.orderId)],
)

export const deliveries = pgTable(
  'deliveries',
  {
    /** Generated on the depot's device, so a delivery recorded offline syncs exactly once. */
    id: uuid('id').primaryKey(),
    worldId: worldRequired(),
    ref: text('ref').notNull(),
    orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    depotId: uuid('depot_id').notNull().references(() => depots.id),
    farmerId: uuid('farmer_id').notNull().references(() => farmers.id, { onDelete: 'cascade' }),
    pledgeId: uuid('pledge_id').references(() => pledges.id),
    consignmentId: uuid('consignment_id').references(() => consignments.id),
    bags: integer('bags').notNull(),
    netGrams: integer('net_grams').notNull(),
    moisture10: integer('moisture10').notNull(),
    grade: text('grade').$type<Grade>().notNull(),
    gradeFactorBp: integer('grade_factor_bp').notNull(),
    payableGrams: integer('payable_grams').notNull(),
    priceNgweePerKg: integer('price_ngwee_per_kg').notNull(),
    amountNgwee: money('amount_ngwee').notNull(),
    status: text('status').$type<'RECEIVED' | 'REJECTED' | 'LOADED' | 'SETTLED'>().notNull(),
    rejectReason: text('reject_reason'),
    scaleMode: text('scale_mode').$type<'SCALE' | 'MANUAL'>().notNull(),
    recordedOffline: boolean('recorded_offline').notNull().default(false),
    recordedAt: ts('recorded_at').notNull(),
    receivedAt: ts('received_at').notNull().defaultNow(),
  },
  (t) => [
    unique('deliveries_ref_uq').on(t.worldId, t.ref),
    index('deliveries_order_depot_idx').on(t.orderId, t.depotId),
    index('deliveries_farmer_idx').on(t.worldId, t.farmerId),
    index('deliveries_consignment_idx').on(t.consignmentId),
  ],
)

export const weighbridgeReadings = pgTable(
  'weighbridge_readings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    worldId: worldRequired(),
    consignmentId: uuid('consignment_id').notNull().references(() => consignments.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'GROSS' | 'TARE'>().notNull(),
    grams: integer('grams').notNull(),
    deviceId: text('device_id').notNull(),
    nonce: text('nonce').notNull(),
    signature: text('signature').notNull(),
    readAt: ts('read_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique('weighbridge_reading_uq').on(t.consignmentId, t.kind)],
)

export const ledgerAccounts = pgTable(
  'ledger_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    worldId: worldRequired(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: text('type').$type<AccountType>().notNull(),
    /** Signed: debit positive. Kept in step with the lines inside the same transaction. */
    balanceNgwee: money('balance_ngwee').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique('ledger_accounts_code_uq').on(t.worldId, t.code),
    check('ledger_accounts_sign_ck', sql`(${t.type} = 'ASSET' and ${t.balanceNgwee} >= 0) or (${t.type} <> 'ASSET' and ${t.balanceNgwee} <= 0)`),
  ],
)

export const journalEntries = pgTable(
  'journal_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    worldId: worldRequired(),
    kind: text('kind').notNull(),
    memo: text('memo').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    refType: text('ref_type'),
    refId: text('ref_id'),
    createdAt: createdAt(),
  },
  (t) => [unique('journal_entries_idem_uq').on(t.worldId, t.idempotencyKey), index('journal_entries_world_idx').on(t.worldId, t.createdAt)],
)

export const ledgerLines = pgTable(
  'ledger_lines',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    worldId: worldRequired(),
    entryId: uuid('entry_id').notNull().references(() => journalEntries.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id').notNull().references(() => ledgerAccounts.id, { onDelete: 'cascade' }),
    amountNgwee: money('amount_ngwee').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('ledger_lines_entry_idx').on(t.entryId),
    index('ledger_lines_account_idx').on(t.accountId),
    check('ledger_lines_nonzero_ck', sql`${t.amountNgwee} <> 0`),
  ],
)

export const collections = pgTable(
  'collections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    worldId: worldRequired(),
    orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    buyerId: uuid('buyer_id').notNull().references(() => buyers.id),
    msisdn: text('msisdn').notNull(),
    amountNgwee: money('amount_ngwee').notNull(),
    status: text('status').$type<'PENDING' | 'UNKNOWN' | 'SUCCEEDED' | 'FAILED'>().notNull().default('PENDING'),
    providerTxnId: text('provider_txn_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    succeededAt: ts('succeeded_at'),
  },
  (t) => [unique('collections_idem_uq').on(t.worldId, t.idempotencyKey), index('collections_order_idx').on(t.orderId)],
)

export type PayoutStatus = 'QUEUED' | 'SENT' | 'UNKNOWN' | 'SUCCEEDED' | 'RETRY_WAIT' | 'FAILED'
export type PayoutKind = 'FARMER' | 'TRANSPORTER' | 'TAX' | 'REFUND'

export const settlements = pgTable(
  'settlements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    worldId: worldRequired(),
    consignmentId: uuid('consignment_id').notNull().references(() => consignments.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    journalEntryId: uuid('journal_entry_id').notNull().references(() => journalEntries.id),
    produceNgwee: money('produce_ngwee').notNull(),
    transportNgwee: money('transport_ngwee').notNull(),
    deductionNgwee: money('deduction_ngwee').notNull(),
    feeNgwee: money('fee_ngwee').notNull(),
    taxToZraNgwee: money('tax_to_zra_ngwee').notNull(),
    buyerTotalNgwee: money('buyer_total_ngwee').notNull(),
    breakdown: jsonb('breakdown').notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique('settlements_consignment_uq').on(t.consignmentId)],
)

export const payouts = pgTable(
  'payouts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    worldId: worldRequired(),
    orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    settlementId: uuid('settlement_id').references(() => settlements.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<PayoutKind>().notNull(),
    partyId: text('party_id').notNull(),
    partyName: text('party_name').notNull(),
    msisdn: text('msisdn').notNull(),
    accountCode: text('account_code').notNull(),
    amountNgwee: money('amount_ngwee').notNull(),
    status: text('status').$type<PayoutStatus>().notNull().default('QUEUED'),
    attempt: integer('attempt').notNull().default(1),
    providerTxnId: text('provider_txn_id'),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    succeededAt: ts('succeeded_at'),
  },
  (t) => [index('payouts_world_idx').on(t.worldId, t.createdAt), index('payouts_party_idx').on(t.worldId, t.partyId)],
)

export type InvoiceKind = 'PRODUCE' | 'TRANSPORT' | 'SERVICE'

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** NULL for last season's history, which every world shares. */
    worldId: worldNullable(),
    number: text('number').notNull(),
    kind: text('kind').$type<InvoiceKind>().notNull(),
    source: text('source').$type<'live' | 'history'>().notNull().default('live'),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'cascade' }),
    settlementId: uuid('settlement_id').references(() => settlements.id, { onDelete: 'cascade' }),
    deliveryId: uuid('delivery_id').references(() => deliveries.id, { onDelete: 'cascade' }),
    sellerKind: text('seller_kind').$type<'FARMER' | 'TRANSPORTER' | 'PLATFORM'>().notNull(),
    sellerId: text('seller_id'),
    sellerName: text('seller_name').notNull(),
    sellerTpin: text('seller_tpin'),
    buyerId: uuid('buyer_id').references(() => buyers.id),
    buyerName: text('buyer_name').notNull(),
    buyerTpin: text('buyer_tpin').notNull(),
    districtId: text('district_id').notNull().references(() => districts.id),
    crop: text('crop').$type<CropCode>(),
    grade: text('grade').$type<Grade>(),
    quantityGrams: integer('quantity_grams'),
    unitPriceNgwee: integer('unit_price_ngwee'),
    subtotalNgwee: money('subtotal_ngwee').notNull(),
    vatNgwee: money('vat_ngwee').notNull().default(0),
    withholdingNgwee: money('withholding_ngwee').notNull().default(0),
    totalNgwee: money('total_ngwee').notNull(),
    taxLines: jsonb('tax_lines').notNull().default(sql`'[]'::jsonb`),
    issuedAt: ts('issued_at').notNull(),
    vsdcStatus: text('vsdc_status').$type<'PENDING' | 'ACCEPTED' | 'FAILED'>().notNull().default('PENDING'),
    vsdcReceiptNo: integer('vsdc_receipt_no'),
    vsdcInternalData: text('vsdc_internal_data'),
    vsdcSignature: text('vsdc_signature'),
    vsdcAttempts: integer('vsdc_attempts').notNull().default(0),
    vsdcAcceptedAt: ts('vsdc_accepted_at'),
    signature: text('signature'),
    keyId: text('key_id'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('invoices_number_uq').on(t.worldId, t.number).nullsNotDistinct(),
    index('invoices_world_issued_idx').on(t.worldId, t.issuedAt),
    index('invoices_seller_idx').on(t.sellerId),
    index('invoices_district_idx').on(t.districtId, t.crop),
  ],
)

export const events = pgTable(
  'events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    worldId: worldRequired(),
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    actor: text('actor').notNull(),
    payload: jsonb('payload').notNull(),
    occurredAt: ts('occurred_at').notNull(),
    prevHash: text('prev_hash').notNull(),
    hash: text('hash').notNull(),
  },
  (t) => [unique('events_seq_uq').on(t.worldId, t.seq), index('events_type_idx').on(t.worldId, t.type)],
)

export const chainHeads = pgTable('chain_heads', {
  worldId: uuid('world_id')
    .primaryKey()
    .references(() => worlds.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),
  hash: text('hash').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
})

export const jobs = pgTable(
  'jobs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    worldId: worldRequired(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    runAt: ts('run_at').notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(8),
    lockedUntil: ts('locked_until'),
    doneAt: ts('done_at'),
    failedAt: ts('failed_at'),
    lastError: text('last_error'),
    dedupeKey: text('dedupe_key'),
    createdAt: createdAt(),
  },
  (t) => [
    index('jobs_due_idx').on(t.runAt).where(sql`${t.doneAt} is null and ${t.failedAt} is null`),
    index('jobs_world_idx').on(t.worldId),
    unique('jobs_dedupe_uq').on(t.worldId, t.dedupeKey),
  ],
)

export const smsMessages = pgTable(
  'sms_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    worldId: worldRequired(),
    toPhone: text('to_phone').notNull(),
    body: text('body').notNull(),
    kind: text('kind').notNull(),
    status: text('status').$type<'QUEUED' | 'SENT' | 'DELIVERED_TO_SIMULATOR' | 'FAILED'>().notNull().default('QUEUED'),
    providerMessageId: text('provider_message_id'),
    createdAt: createdAt(),
    sentAt: ts('sent_at'),
  },
  (t) => [index('sms_phone_idx').on(t.worldId, t.toPhone, t.createdAt)],
)

export const webhookReceipts = pgTable(
  'webhook_receipts',
  {
    worldId: worldRequired(),
    provider: text('provider').notNull(),
    eventId: text('event_id').notNull(),
    outcome: text('outcome').notNull(),
    /** How many more times the same event arrived (and was ignored). */
    duplicates: integer('duplicates').notNull().default(0),
    receivedAt: ts('received_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.worldId, t.provider, t.eventId] })],
)

export const riskFlags = pgTable(
  'risk_flags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    worldId: worldNullable(),
    type: text('type').$type<RiskType>().notNull(),
    severity: text('severity').$type<RiskSeverity>().notNull(),
    title: text('title').notNull(),
    explanation: text('explanation').notNull(),
    evidence: jsonb('evidence').notNull(),
    districtId: text('district_id'),
    status: text('status').$type<'OPEN' | 'REVIEWED'>().notNull().default('OPEN'),
    dedupeKey: text('dedupe_key').notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique('risk_flags_dedupe_uq').on(t.worldId, t.dedupeKey).nullsNotDistinct(), index('risk_flags_world_idx').on(t.worldId, t.createdAt)],
)

/** A world's changes to the default tax rules (the defaults live in code: src/domain/tax.ts). */
export const taxRules = pgTable(
  'tax_rules',
  {
    worldId: worldRequired(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    kind: text('kind').$type<TaxKind>().notNull(),
    base: text('base').$type<TaxBase>().notNull(),
    rateBp: integer('rate_bp').notNull(),
    collection: text('collection').$type<TaxCollection>().notNull(),
    appliesWhen: text('applies_when').$type<TaxCondition>().notNull(),
    enabled: boolean('enabled').notNull(),
    note: text('note').notNull(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.worldId, t.code] })],
)

export const creditShares = pgTable('credit_shares', {
  code: text('code').primaryKey(),
  worldId: worldRequired(),
  farmerId: uuid('farmer_id').notNull().references(() => farmers.id, { onDelete: 'cascade' }),
  views: integer('views').notNull().default(0),
  createdAt: createdAt(),
  expiresAt: ts('expires_at').notNull(),
})

export const ussdSessions = pgTable(
  'ussd_sessions',
  {
    worldId: worldRequired(),
    sessionId: text('session_id').notNull(),
    phone: text('phone').notNull(),
    serviceCode: text('service_code').notNull(),
    lastInput: text('last_input').notNull().default(''),
    requests: integer('requests').notNull().default(0),
    ended: boolean('ended').notNull().default(false),
    startedAt: ts('started_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.worldId, t.sessionId] })],
)

// ── Simulated providers ───────────────────────────────────────────────────────────────────────────────────────────
// These tables belong to the stand-ins for Zamtel Money and ZRA's VSDC. In production they would be other companies'
// systems; Agri-OS only ever talks to them through their HTTP APIs.

export const simWallets = pgTable(
  'sim_wallets',
  {
    worldId: worldRequired(),
    msisdn: text('msisdn').notNull(),
    name: text('name').notNull(),
    kind: text('kind').$type<'CUSTOMER' | 'MERCHANT' | 'TRUST' | 'TAX'>().notNull(),
    balanceNgwee: money('balance_ngwee').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.worldId, t.msisdn] }), check('sim_wallets_nonneg_ck', sql`${t.balanceNgwee} >= 0`)],
)

export const simTransactions = pgTable(
  'sim_transactions',
  {
    id: text('id').primaryKey(),
    worldId: worldRequired(),
    type: text('type').$type<'COLLECTION' | 'DISBURSEMENT'>().notNull(),
    amountNgwee: money('amount_ngwee').notNull(),
    fromMsisdn: text('from_msisdn').notNull(),
    toMsisdn: text('to_msisdn').notNull(),
    reference: text('reference').notNull(),
    description: text('description').notNull(),
    clientKey: text('client_key').notNull(),
    requestHash: text('request_hash').notNull(),
    status: text('status').$type<'PENDING_APPROVAL' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED'>().notNull(),
    failureReason: text('failure_reason'),
    callbackUrl: text('callback_url').notNull(),
    createdAt: createdAt(),
    completedAt: ts('completed_at'),
  },
  (t) => [unique('sim_txn_key_uq').on(t.worldId, t.clientKey), index('sim_txn_ref_idx').on(t.worldId, t.reference)],
)

export const simPrompts = pgTable(
  'sim_prompts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    worldId: worldRequired(),
    transactionId: text('transaction_id').notNull().references(() => simTransactions.id, { onDelete: 'cascade' }),
    msisdn: text('msisdn').notNull(),
    message: text('message').notNull(),
    status: text('status').$type<'OPEN' | 'APPROVED' | 'DECLINED' | 'EXPIRED'>().notNull().default('OPEN'),
    wrongPins: integer('wrong_pins').notNull().default(0),
    createdAt: createdAt(),
    answeredAt: ts('answered_at'),
  },
  (t) => [index('sim_prompts_msisdn_idx').on(t.worldId, t.msisdn, t.status)],
)

export const simVsdcReceipts = pgTable(
  'sim_vsdc_receipts',
  {
    worldId: worldRequired(),
    receiptNo: integer('receipt_no').notNull(),
    invoiceNumber: text('invoice_number').notNull(),
    tpin: text('tpin').notNull(),
    payload: jsonb('payload').notNull(),
    internalData: text('internal_data').notNull(),
    signature: text('signature').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.worldId, t.receiptNo] }), unique('sim_vsdc_invoice_uq').on(t.worldId, t.invoiceNumber)],
)
