CREATE TABLE "buyers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"world_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"tpin" text NOT NULL,
	"vat_registered" boolean DEFAULT true NOT NULL,
	"plant_name" text NOT NULL,
	"district_id" text NOT NULL,
	"phone" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buyers_code_uq" UNIQUE NULLS NOT DISTINCT("world_id","code")
);
--> statement-breakpoint
CREATE TABLE "chain_heads" (
	"world_id" uuid PRIMARY KEY NOT NULL,
	"seq" integer NOT NULL,
	"hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"world_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"msisdn" text NOT NULL,
	"amount_ngwee" bigint NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"provider_txn_id" text,
	"idempotency_key" text NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"succeeded_at" timestamp with time zone,
	CONSTRAINT "collections_idem_uq" UNIQUE("world_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "consignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"world_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"order_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"transporter_id" uuid NOT NULL,
	"truck_reg" text NOT NULL,
	"depot_grams" integer NOT NULL,
	"distance_km" integer NOT NULL,
	"transport_fee_ngwee" bigint NOT NULL,
	"status" text DEFAULT 'IN_TRANSIT' NOT NULL,
	"arrived_grams" integer,
	"variance_grams" integer,
	"hold_reason" text,
	"dispatched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"weighed_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	CONSTRAINT "consignments_ref_uq" UNIQUE("world_id","ref")
);
--> statement-breakpoint
CREATE TABLE "counters" (
	"world_id" uuid NOT NULL,
	"name" text NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "counters_world_id_name_pk" PRIMARY KEY("world_id","name")
);
--> statement-breakpoint
CREATE TABLE "credit_shares" (
	"code" text PRIMARY KEY NOT NULL,
	"world_id" uuid NOT NULL,
	"farmer_id" uuid NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"world_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"order_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"farmer_id" uuid NOT NULL,
	"pledge_id" uuid,
	"consignment_id" uuid,
	"bags" integer NOT NULL,
	"net_grams" integer NOT NULL,
	"moisture10" integer NOT NULL,
	"grade" text NOT NULL,
	"grade_factor_bp" integer NOT NULL,
	"payable_grams" integer NOT NULL,
	"price_ngwee_per_kg" integer NOT NULL,
	"amount_ngwee" bigint NOT NULL,
	"status" text NOT NULL,
	"reject_reason" text,
	"scale_mode" text NOT NULL,
	"recorded_offline" boolean DEFAULT false NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliveries_ref_uq" UNIQUE("world_id","ref")
);
--> statement-breakpoint
CREATE TABLE "depots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"world_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"district_id" text NOT NULL,
	"operator" text NOT NULL,
	"clerk_name" text NOT NULL,
	"clerk_phone" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "depots_code_uq" UNIQUE NULLS NOT DISTINCT("world_id","code")
);
--> statement-breakpoint
CREATE TABLE "districts" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"province" text NOT NULL,
	"province_name" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"world_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"actor" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	CONSTRAINT "events_seq_uq" UNIQUE("world_id","seq")
);
--> statement-breakpoint
CREATE TABLE "farmer_prefs" (
	"world_id" uuid NOT NULL,
	"farmer_id" uuid NOT NULL,
	"language" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "farmer_prefs_world_id_farmer_id_pk" PRIMARY KEY("world_id","farmer_id")
);
--> statement-breakpoint
CREATE TABLE "farmers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"world_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"district_id" text NOT NULL,
	"depot_id" uuid,
	"language" text DEFAULT 'en' NOT NULL,
	"fictional" boolean DEFAULT false NOT NULL,
	"history_pledged_kg" integer DEFAULT 0 NOT NULL,
	"history_delivered_kg" integer DEFAULT 0 NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "farmers_phone_uq" UNIQUE NULLS NOT DISTINCT("world_id","phone")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"world_id" uuid,
	"number" text NOT NULL,
	"kind" text NOT NULL,
	"source" text DEFAULT 'live' NOT NULL,
	"order_id" uuid,
	"settlement_id" uuid,
	"delivery_id" uuid,
	"seller_kind" text NOT NULL,
	"seller_id" text,
	"seller_name" text NOT NULL,
	"seller_tpin" text,
	"buyer_id" uuid,
	"buyer_name" text NOT NULL,
	"buyer_tpin" text NOT NULL,
	"district_id" text NOT NULL,
	"crop" text,
	"grade" text,
	"quantity_grams" integer,
	"unit_price_ngwee" integer,
	"subtotal_ngwee" bigint NOT NULL,
	"vat_ngwee" bigint DEFAULT 0 NOT NULL,
	"withholding_ngwee" bigint DEFAULT 0 NOT NULL,
	"total_ngwee" bigint NOT NULL,
	"tax_lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"vsdc_status" text DEFAULT 'PENDING' NOT NULL,
	"vsdc_receipt_no" integer,
	"vsdc_internal_data" text,
	"vsdc_signature" text,
	"vsdc_attempts" integer DEFAULT 0 NOT NULL,
	"vsdc_accepted_at" timestamp with time zone,
	"signature" text,
	"key_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_number_uq" UNIQUE NULLS NOT DISTINCT("world_id","number")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"world_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"locked_until" timestamp with time zone,
	"done_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"last_error" text,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_dedupe_uq" UNIQUE("world_id","dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"world_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"memo" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"ref_type" text,
	"ref_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_idem_uq" UNIQUE("world_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"world_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"balance_ngwee" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_accounts_code_uq" UNIQUE("world_id","code"),
	CONSTRAINT "ledger_accounts_sign_ck" CHECK (("ledger_accounts"."type" = 'ASSET' and "ledger_accounts"."balance_ngwee" >= 0) or ("ledger_accounts"."type" <> 'ASSET' and "ledger_accounts"."balance_ngwee" <= 0))
);
--> statement-breakpoint
CREATE TABLE "ledger_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"world_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"amount_ngwee" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_lines_nonzero_ck" CHECK ("ledger_lines"."amount_ngwee" <> 0)
);
--> statement-breakpoint
CREATE TABLE "order_depots" (
	"world_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"distance_km" integer NOT NULL,
	CONSTRAINT "order_depots_order_id_depot_id_pk" PRIMARY KEY("order_id","depot_id")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"world_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"buyer_id" uuid NOT NULL,
	"crop" text NOT NULL,
	"min_grade" text NOT NULL,
	"quantity_kg" integer NOT NULL,
	"price_ngwee_per_kg" integer NOT NULL,
	"fee_bp" integer DEFAULT 100 NOT NULL,
	"status" text DEFAULT 'FUNDING' NOT NULL,
	"escrow_target_ngwee" bigint NOT NULL,
	"deliver_by" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"funded_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "orders_ref_uq" UNIQUE("world_id","ref")
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"world_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"settlement_id" uuid,
	"kind" text NOT NULL,
	"party_id" text NOT NULL,
	"party_name" text NOT NULL,
	"msisdn" text NOT NULL,
	"account_code" text NOT NULL,
	"amount_ngwee" bigint NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"provider_txn_id" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"succeeded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pledges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"world_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"order_id" uuid NOT NULL,
	"farmer_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"bags" integer NOT NULL,
	"kg_pledged" integer NOT NULL,
	"kg_delivered" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'PLEDGED' NOT NULL,
	"channel" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pledges_ref_uq" UNIQUE("world_id","ref"),
	CONSTRAINT "pledges_idem_uq" UNIQUE("world_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "risk_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"world_id" uuid,
	"type" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"explanation" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"district_id" text,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risk_flags_dedupe_uq" UNIQUE NULLS NOT DISTINCT("world_id","dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"world_id" uuid NOT NULL,
	"consignment_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"produce_ngwee" bigint NOT NULL,
	"transport_ngwee" bigint NOT NULL,
	"deduction_ngwee" bigint NOT NULL,
	"fee_ngwee" bigint NOT NULL,
	"tax_to_zra_ngwee" bigint NOT NULL,
	"buyer_total_ngwee" bigint NOT NULL,
	"breakdown" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlements_consignment_uq" UNIQUE("consignment_id")
);
--> statement-breakpoint
CREATE TABLE "sim_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"world_id" uuid NOT NULL,
	"transaction_id" text NOT NULL,
	"msisdn" text NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"wrong_pins" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sim_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"world_id" uuid NOT NULL,
	"type" text NOT NULL,
	"amount_ngwee" bigint NOT NULL,
	"from_msisdn" text NOT NULL,
	"to_msisdn" text NOT NULL,
	"reference" text NOT NULL,
	"description" text NOT NULL,
	"client_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text NOT NULL,
	"failure_reason" text,
	"callback_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "sim_txn_key_uq" UNIQUE("world_id","client_key")
);
--> statement-breakpoint
CREATE TABLE "sim_vsdc_receipts" (
	"world_id" uuid NOT NULL,
	"receipt_no" integer NOT NULL,
	"invoice_number" text NOT NULL,
	"tpin" text NOT NULL,
	"payload" jsonb NOT NULL,
	"internal_data" text NOT NULL,
	"signature" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sim_vsdc_receipts_world_id_receipt_no_pk" PRIMARY KEY("world_id","receipt_no"),
	CONSTRAINT "sim_vsdc_invoice_uq" UNIQUE("world_id","invoice_number")
);
--> statement-breakpoint
CREATE TABLE "sim_wallets" (
	"world_id" uuid NOT NULL,
	"msisdn" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"balance_ngwee" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sim_wallets_world_id_msisdn_pk" PRIMARY KEY("world_id","msisdn"),
	CONSTRAINT "sim_wallets_nonneg_ck" CHECK ("sim_wallets"."balance_ngwee" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sms_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"world_id" uuid NOT NULL,
	"to_phone" text NOT NULL,
	"body" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"provider_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tax_rules" (
	"world_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"base" text NOT NULL,
	"rate_bp" integer NOT NULL,
	"collection" text NOT NULL,
	"applies_when" text NOT NULL,
	"enabled" boolean NOT NULL,
	"note" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_rules_world_id_code_pk" PRIMARY KEY("world_id","code")
);
--> statement-breakpoint
CREATE TABLE "transporters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"world_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"tpin" text,
	"vat_registered" boolean NOT NULL,
	"truck_reg" text NOT NULL,
	"capacity_kg" integer NOT NULL,
	"tare_kg" integer NOT NULL,
	"rate_ngwee_per_tonne_km" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transporters_code_uq" UNIQUE NULLS NOT DISTINCT("world_id","code")
);
--> statement-breakpoint
CREATE TABLE "ussd_sessions" (
	"world_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"phone" text NOT NULL,
	"service_code" text NOT NULL,
	"last_input" text DEFAULT '' NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"ended" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ussd_sessions_world_id_session_id_pk" PRIMARY KEY("world_id","session_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_receipts" (
	"world_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"outcome" text NOT NULL,
	"duplicates" integer DEFAULT 0 NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_receipts_world_id_provider_event_id_pk" PRIMARY KEY("world_id","provider","event_id")
);
--> statement-breakpoint
CREATE TABLE "weighbridge_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"world_id" uuid NOT NULL,
	"consignment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"grams" integer NOT NULL,
	"device_id" text NOT NULL,
	"nonce" text NOT NULL,
	"signature" text NOT NULL,
	"read_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weighbridge_reading_uq" UNIQUE("consignment_id","kind")
);
--> statement-breakpoint
CREATE TABLE "worlds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text DEFAULT 'sandbox' NOT NULL,
	"chaos" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "buyers" ADD CONSTRAINT "buyers_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyers" ADD CONSTRAINT "buyers_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chain_heads" ADD CONSTRAINT "chain_heads_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_buyer_id_buyers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."buyers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consignments" ADD CONSTRAINT "consignments_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consignments" ADD CONSTRAINT "consignments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consignments" ADD CONSTRAINT "consignments_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consignments" ADD CONSTRAINT "consignments_transporter_id_transporters_id_fk" FOREIGN KEY ("transporter_id") REFERENCES "public"."transporters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counters" ADD CONSTRAINT "counters_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_shares" ADD CONSTRAINT "credit_shares_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_shares" ADD CONSTRAINT "credit_shares_farmer_id_farmers_id_fk" FOREIGN KEY ("farmer_id") REFERENCES "public"."farmers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_farmer_id_farmers_id_fk" FOREIGN KEY ("farmer_id") REFERENCES "public"."farmers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_pledge_id_pledges_id_fk" FOREIGN KEY ("pledge_id") REFERENCES "public"."pledges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_consignment_id_consignments_id_fk" FOREIGN KEY ("consignment_id") REFERENCES "public"."consignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depots" ADD CONSTRAINT "depots_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depots" ADD CONSTRAINT "depots_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farmer_prefs" ADD CONSTRAINT "farmer_prefs_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farmer_prefs" ADD CONSTRAINT "farmer_prefs_farmer_id_farmers_id_fk" FOREIGN KEY ("farmer_id") REFERENCES "public"."farmers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farmers" ADD CONSTRAINT "farmers_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farmers" ADD CONSTRAINT "farmers_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farmers" ADD CONSTRAINT "farmers_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_buyer_id_buyers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."buyers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_depots" ADD CONSTRAINT "order_depots_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_depots" ADD CONSTRAINT "order_depots_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_depots" ADD CONSTRAINT "order_depots_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_id_buyers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."buyers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pledges" ADD CONSTRAINT "pledges_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pledges" ADD CONSTRAINT "pledges_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pledges" ADD CONSTRAINT "pledges_farmer_id_farmers_id_fk" FOREIGN KEY ("farmer_id") REFERENCES "public"."farmers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pledges" ADD CONSTRAINT "pledges_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_flags" ADD CONSTRAINT "risk_flags_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_consignment_id_consignments_id_fk" FOREIGN KEY ("consignment_id") REFERENCES "public"."consignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_prompts" ADD CONSTRAINT "sim_prompts_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_prompts" ADD CONSTRAINT "sim_prompts_transaction_id_sim_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."sim_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_transactions" ADD CONSTRAINT "sim_transactions_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_vsdc_receipts" ADD CONSTRAINT "sim_vsdc_receipts_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_wallets" ADD CONSTRAINT "sim_wallets_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rules" ADD CONSTRAINT "tax_rules_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transporters" ADD CONSTRAINT "transporters_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ussd_sessions" ADD CONSTRAINT "ussd_sessions_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_receipts" ADD CONSTRAINT "webhook_receipts_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weighbridge_readings" ADD CONSTRAINT "weighbridge_readings_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weighbridge_readings" ADD CONSTRAINT "weighbridge_readings_consignment_id_consignments_id_fk" FOREIGN KEY ("consignment_id") REFERENCES "public"."consignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collections_order_idx" ON "collections" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "consignments_order_idx" ON "consignments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "deliveries_order_depot_idx" ON "deliveries" USING btree ("order_id","depot_id");--> statement-breakpoint
CREATE INDEX "deliveries_farmer_idx" ON "deliveries" USING btree ("world_id","farmer_id");--> statement-breakpoint
CREATE INDEX "deliveries_consignment_idx" ON "deliveries" USING btree ("consignment_id");--> statement-breakpoint
CREATE INDEX "events_type_idx" ON "events" USING btree ("world_id","type");--> statement-breakpoint
CREATE INDEX "farmers_depot_idx" ON "farmers" USING btree ("depot_id");--> statement-breakpoint
CREATE INDEX "invoices_world_issued_idx" ON "invoices" USING btree ("world_id","issued_at");--> statement-breakpoint
CREATE INDEX "invoices_seller_idx" ON "invoices" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "invoices_district_idx" ON "invoices" USING btree ("district_id","crop");--> statement-breakpoint
CREATE INDEX "jobs_due_idx" ON "jobs" USING btree ("run_at") WHERE "jobs"."done_at" is null and "jobs"."failed_at" is null;--> statement-breakpoint
CREATE INDEX "jobs_world_idx" ON "jobs" USING btree ("world_id");--> statement-breakpoint
CREATE INDEX "journal_entries_world_idx" ON "journal_entries" USING btree ("world_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_lines_entry_idx" ON "ledger_lines" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "ledger_lines_account_idx" ON "ledger_lines" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "orders_world_idx" ON "orders" USING btree ("world_id","created_at");--> statement-breakpoint
CREATE INDEX "payouts_world_idx" ON "payouts" USING btree ("world_id","created_at");--> statement-breakpoint
CREATE INDEX "payouts_party_idx" ON "payouts" USING btree ("world_id","party_id");--> statement-breakpoint
CREATE INDEX "pledges_order_idx" ON "pledges" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "pledges_farmer_idx" ON "pledges" USING btree ("world_id","farmer_id");--> statement-breakpoint
CREATE INDEX "risk_flags_world_idx" ON "risk_flags" USING btree ("world_id","created_at");--> statement-breakpoint
CREATE INDEX "sim_prompts_msisdn_idx" ON "sim_prompts" USING btree ("world_id","msisdn","status");--> statement-breakpoint
CREATE INDEX "sim_txn_ref_idx" ON "sim_transactions" USING btree ("world_id","reference");--> statement-breakpoint
CREATE INDEX "sms_phone_idx" ON "sms_messages" USING btree ("world_id","to_phone","created_at");