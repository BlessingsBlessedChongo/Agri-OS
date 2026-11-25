import { z } from 'zod'
import { dispatchInput } from './consignments'
import { deliveryInput } from './deliveries'
import { createOrderInput } from './orders'
import { readingInput } from './weighbridge'

const schema = (s: z.ZodType) => z.toJSONSchema(s, { unrepresentable: 'any', io: 'input' })

type Op = { summary: string; description?: string; body?: z.ZodType | Record<string, unknown>; public?: boolean; form?: boolean; produces?: string }

const ops: Record<string, Partial<Record<'get' | 'post' | 'put' | 'delete', Op>>> = {
  '/api/world': {
    get: { summary: 'Current sandbox', public: true },
    post: { summary: 'Create a sandbox (or ?reset=1 for a fresh one); sets the agrios_world cookie', public: true },
  },
  '/api/tick': { post: { summary: 'Run due background work for the sandbox; returns the audit head sequence' } },
  '/api/events': { get: { summary: 'Audit events after a sequence number (?after=)' } },
  '/api/ussd': {
    post: {
      summary: "USSD callback in Africa's Talking format",
      description: 'Form fields sessionId, serviceCode, phoneNumber, text (inputs joined by *). Replies "CON …" or "END …" as text/plain.',
      form: true,
      produces: 'text/plain',
      public: true,
    },
  },
  '/api/reference': { get: { summary: 'Depots, buyers, transporters and farmers visible to the sandbox' } },
  '/api/orders': { get: { summary: 'Orders' }, post: { summary: 'Post demand', body: createOrderInput } },
  '/api/orders/{id}': { get: { summary: 'Order detail: escrow, pledges, deliveries, trucks, payouts' } },
  '/api/orders/{id}/fund': { post: { summary: "Request escrow from the buyer's Zamtel Money wallet (PIN prompt)" } },
  '/api/orders/{id}/close': { post: { summary: 'Close the order; unused escrow is refunded once every truck is settled' } },
  '/api/depots/{id}': { get: { summary: 'Depot board: open orders, expected pledges, received deliveries' } },
  '/api/deliveries/sync': { post: { summary: 'Sync deliveries recorded on a depot device (idempotent by device-generated id)', body: z.object({ deliveries: z.array(deliveryInput) }) } },
  '/api/consignments': { get: { summary: 'Trucks heading to weighbridges' }, post: { summary: 'Load received deliveries onto a truck', body: dispatchInput } },
  '/api/weighbridge/readings': { post: { summary: 'Submit a signed weighbridge reading (gross, then tare settles the truck)', body: readingInput } },
  '/api/sim/weighbridge': { post: { summary: 'Simulated weighbridge device: returns a signed reading' } },
  '/api/sim/zamtel/{worldId}/v1/collections': { post: { summary: 'Simulated Zamtel Money: request to pay (Idempotency-Key header required)' } },
  '/api/sim/zamtel/{worldId}/v1/disbursements': { post: { summary: 'Simulated Zamtel Money: pay out (Idempotency-Key header required)' } },
  '/api/sim/zamtel/{worldId}/v1/transactions': { get: { summary: 'Simulated Zamtel Money: find by ?reference=' } },
  '/api/sim/zamtel/{worldId}/v1/statement': { get: { summary: 'Simulated Zamtel Money: merchant statement for reconciliation' } },
  '/api/sim/vsdc/{worldId}/trnsSales/saveSales': { post: { summary: 'Simulated VSDC: submit an invoice, receive a receipt number and signature' } },
  '/api/webhooks/zamtel/{worldId}': { post: { summary: 'Zamtel Money callbacks (X-Zamtel-Signature: t=…,v1=HMAC-SHA256)', public: true } },
  '/api/sms': { get: { summary: 'Messages sent to a phone in this sandbox (?phone=)' } },
  '/api/invoices': { get: { summary: 'Invoices (shared history + this sandbox); ?kind=&live=1' } },
  '/api/invoices/{id}': { get: { summary: 'Public invoice verification (signature + VSDC receipt)', public: true } },
  '/api/invoices/export': { get: { summary: 'Invoices as CSV', produces: 'text/csv' } },
  '/api/zra': { get: { summary: 'Tax-authority overview, live invoices and risk flags' } },
  '/api/zra/prices': { get: { summary: 'Weekly median price per kg (?crop=)' } },
  '/api/tax-rules': { get: { summary: 'Effective tax rules' }, put: { summary: 'Change a rule in this sandbox' } },
  '/api/chaos': { get: { summary: 'Chaos settings and presets' }, put: { summary: 'Set a preset or individual chaos settings' } },
  '/api/resilience': { get: { summary: 'Reconciliation with the provider statement and the resilience report' } },
  '/api/ledger': { get: { summary: 'Accounts, recent journal entries and ledger invariants' } },
  '/api/audit': { get: { summary: 'Audit trail page (?before=)' } },
  '/api/audit/verify': { get: { summary: 'Recompute every hash in the audit trail' } },
  '/api/audit/tamper': { post: { summary: 'Sandbox only: change a recorded amount directly in the database' }, delete: { summary: 'Put the original back' } },
  '/api/audit/checkpoint': { get: { summary: 'Signed statement of the audit head' } },
  '/api/farmers/{id}': { get: { summary: 'Farmer profile and explained trade record' } },
  '/api/credit/{code}': { get: { summary: 'Public lender view of a shared trade record', public: true } },
  '/api/payouts/{id}/retry': { post: { summary: 'Retry a payout that ran out of automatic attempts' } },
  '/api/demo/crowd': { post: { summary: 'Demo helper: other farmers pledge through the USSD engine' } },
  '/api/public/keys': { get: { summary: 'Agri-OS Ed25519 public key (JWK and PEM)', public: true } },
  '/api/health': { get: { summary: 'Health check', public: true } },
  '/api/cron': { get: { summary: 'Housekeeping (Bearer CRON_SECRET)', public: true } },
}

export function openApiDocument(serverUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const [path, methods] of Object.entries(ops)) {
    paths[path] = {}
    for (const [method, op] of Object.entries(methods)) {
      if (!op) continue
      const body = op.body instanceof z.ZodType ? schema(op.body) : op.body
      paths[path][method] = {
        summary: op.summary,
        ...(op.description ? { description: op.description } : {}),
        ...(op.public ? { security: [] } : {}),
        ...(op.form
          ? { requestBody: { required: true, content: { 'application/x-www-form-urlencoded': { schema: { type: 'object', properties: { sessionId: { type: 'string' }, serviceCode: { type: 'string' }, phoneNumber: { type: 'string' }, text: { type: 'string' } }, required: ['sessionId', 'phoneNumber'] } } } } }
          : body
            ? { requestBody: { required: true, content: { 'application/json': { schema: body } } } }
            : {}),
        responses: {
          '200': { description: 'OK', content: { [op.produces ?? 'application/json']: {} } },
          '4XX': { description: 'Error: { error: { code, message, details } }' },
        },
      }
    }
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Agri-OS API',
      version: '1.0.0',
      description:
        'Trade infrastructure for smallholder farmers: USSD offers, depot weighing, escrowed mobile-money settlement, reverse invoicing and a tax-authority view. Every visitor works in a private sandbox (agrios_world cookie). Zamtel Money and the VSDC are simulated behind real HTTP APIs.',
    },
    servers: [{ url: serverUrl }],
    components: { securitySchemes: { sandbox: { type: 'apiKey', in: 'cookie', name: 'agrios_world' } } },
    security: [{ sandbox: [] }],
    paths,
  }
}
