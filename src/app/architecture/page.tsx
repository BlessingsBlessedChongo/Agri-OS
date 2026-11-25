import type { Metadata } from 'next'
import { LinkButton } from '@/ui/kit'

export const metadata: Metadata = { title: 'How it’s built' }

const DECISIONS: Array<[string, string]> = [
  [
    'Money is integer ngwee in a double-entry ledger, guarded by the database',
    'Every amount is a whole number of ngwee, multiplied and rounded in BigInt. Each movement is a journal entry whose signed lines must sum to zero; a deferred constraint trigger re-checks that at commit, a check constraint refuses an account balance with the wrong sign, and triggers make ledger rows append-only.',
  ],
  [
    '“Unknown” is a first-class payment outcome',
    'A timeout or a 5xx from the payment provider never becomes “failed”. The payout stays in flight; Agri-OS asks the provider by reference, or re-sends with the same idempotency key. Only a definite failure returns the money to “owed” and starts a new attempt with a new key, so nothing can be paid twice.',
  ],
  [
    'A transactional outbox instead of calling providers inline',
    'Settlement writes the ledger entry, every payout and every invoice in one transaction, plus jobs to send them. A small Postgres queue (FOR UPDATE SKIP LOCKED) runs the jobs. No database transaction is ever held open while waiting on the network.',
  ],
  [
    'Serverless-friendly background work',
    'There is no long-running worker. Due jobs run after each API response (Next’s after()), on a tick from any open page, and from a cron route. Jobs are idempotent and safe to run concurrently, so where they run doesn’t matter.',
  ],
  [
    'Farmers are paid on the depot’s weight',
    'Responsibility passes to the transporter at the depot. The plant’s weighbridge, whose readings are signed by the device, checks the truck; a loss beyond 0.5% is valued at the load’s average price and taken off the haulage fee.',
  ],
  [
    'Reverse invoicing, because smallholders can’t invoice',
    'Farmers have no TPIN or invoicing device, so the registered buyer issues each purchase invoice on the farmer’s behalf and submits it to the VSDC. Tax is a table of rules, not code: illustrative rates that ZRA would confirm.',
  ],
  [
    'USSD as a replay engine',
    'Africa’s Talking sends the whole input path on every request, so the menu engine rebuilds the screen from scratch: no session store to lose. Side effects happen only on a final confirmation, keyed to the session, so a retried request can’t pledge twice. Every screen in all three languages is tested to fit 182 characters.',
  ],
  [
    'A sandbox per visitor over shared reference data',
    'Farmers, depots, buyers and last season’s history are shared and read-only; everything a visitor changes lives in their own world and is deleted with it. A new sandbox costs one insert, so a public demo can’t be broken by the last person who used it.',
  ],
  [
    'A tamper-evident audit trail',
    'Every event hashes its contents together with the previous event’s hash, inside the same transaction as the change it describes. Verification recomputes the chain and names the first event that doesn’t match; signed checkpoints let outsiders pin the history.',
  ],
]

function Box({ x, y, w, h, title, lines = [], tone = 'sheet' }: { x: number; y: number; w: number; h: number; title: string; lines?: string[]; tone?: 'sheet' | 'leaf' | 'maize' | 'sky' }) {
  const fill = { sheet: 'var(--sheet)', leaf: 'var(--leaf-wash)', maize: 'var(--maize-wash)', sky: 'var(--sky-wash)' }[tone]
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={8} fill={fill} stroke="var(--rule)" strokeWidth={1.5} />
      <text x={x + 12} y={y + 22} fontSize={15} fontWeight={700} fill="var(--ink)">
        {title}
      </text>
      {lines.map((l, i) => (
        <text key={l} x={x + 12} y={y + 42 + i * 17} fontSize={12.5} fill="var(--ink-2)">
          {l}
        </text>
      ))}
    </g>
  )
}

function Arrow({ d, label, lx, ly, dashed }: { d: string; label?: string; lx?: number; ly?: number; dashed?: boolean }) {
  return (
    <g>
      <path d={d} fill="none" stroke="var(--ink-3)" strokeWidth={1.6} markerEnd="url(#arrow)" strokeDasharray={dashed ? '5 4' : undefined} />
      {label && (
        <text x={lx} y={ly} fontSize={11.5} fill="var(--ink-3)" textAnchor="middle">
          {label}
        </text>
      )}
    </g>
  )
}

export default function ArchitecturePage() {
  return (
    <div className="space-y-12">
      <div className="max-w-3xl">
        <h1 className="font-display text-5xl leading-none font-extrabold tracking-wide">How it’s built</h1>
        <p className="mt-3 text-ink-2">
          One TypeScript codebase: a Next.js app whose route handlers are the API, a pure domain layer with no I/O, services around a Postgres database, and adapters for the outside
          world. The outside world (Zamtel Money, ZRA’s VSDC) is simulated by separate modules that Agri-OS only reaches over HTTP.
        </p>
      </div>

      <figure className="overflow-x-auto rounded-[10px] border border-rule bg-sheet p-4">
        <svg viewBox="0 0 1000 540" className="min-w-[760px]" role="img" aria-labelledby="arch-title arch-desc">
          <title id="arch-title">Agri-OS architecture</title>
          <desc id="arch-desc">
            Farmers reach Agri-OS by USSD and SMS through Africa’s Talking; depots, buyers and ZRA use the web app. Inside Agri-OS, the API calls services built on a pure domain layer,
            which write to a double-entry ledger, an outbox job queue and a hash-chained audit trail in Postgres. Jobs call the simulated Zamtel Money and VSDC over HTTP; Zamtel Money
            calls back with signed webhooks.
          </desc>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--ink-3)" />
            </marker>
          </defs>

          <text x={20} y={24} fontSize={13} fill="var(--ink-3)">
            People and devices
          </text>
          <Box x={20} y={40} w={200} h={70} title="Farmer, basic phone" lines={['USSD *384*123#, SMS', 'English, Bemba, Nyanja']} tone="leaf" />
          <Box x={20} y={140} w={200} h={70} title="Depot device" lines={['Offline-first web app', 'IndexedDB outbox']} tone="maize" />
          <Box x={20} y={240} w={200} h={70} title="Buyer’s plant" lines={['Web app', 'Weighbridge (signs readings)']} tone="sky" />
          <Box x={20} y={340} w={200} h={70} title="ZRA analyst" lines={['National view, CSV export', 'Public invoice checks']} />
          <Box x={20} y={440} w={200} h={70} title="Lender" lines={['Opens a shared record', 'with the farmer’s code']} />

          <Box x={240} y={80} w={150} h={60} title="Africa’s Talking" lines={['USSD gateway, SMS']} />

          <rect x={450} y={40} width={330} height={480} rx={12} fill="none" stroke="var(--ink)" strokeWidth={2} />
          <text x={466} y={66} fontSize={17} fontWeight={800} fill="var(--ink)">
            Agri-OS (one Next.js app)
          </text>
          <Box x={466} y={80} w={298} h={58} title="HTTP API: route handlers" lines={['Zod-validated, sandboxed per visitor']} />
          <Box x={466} y={150} w={298} h={74} title="Services" lines={['orders, escrow, pledges, deliveries, trucks,', 'weighbridge, settlement, payouts, invoices']} />
          <Box x={466} y={236} w={298} h={74} title="Domain (pure, no I/O)" lines={['money, produce, tax rules, settlement maths,', 'credit score, risk rules, USSD engine']} tone="leaf" />
          <Box x={466} y={322} w={92} h={74} title="Ledger" lines={['double', 'entry']} />
          <Box x={569} y={322} w={92} h={74} title="Outbox" lines={['job queue,', 'SKIP LOCKED']} />
          <Box x={672} y={322} w={92} h={74} title="Audit" lines={['hash', 'chain']} />
          <Box x={466} y={410} w={298} h={58} title="Postgres" lines={['constraint triggers keep the books honest']} tone="sky" />
          <text x={466} y={492} fontSize={12} fill="var(--ink-3)">
            Signing: Ed25519 (invoices, checkpoints), HMAC (devices, webhooks)
          </text>

          <text x={830} y={88} fontSize={13} fill="var(--ink-3)">
            Outside (simulated)
          </text>
          <Box x={830} y={100} w={160} h={86} title="Zamtel Money" lines={['collections, payouts', 'idempotency keys', 'signed callbacks']} tone="maize" />
          <Box x={830} y={232} w={160} h={70} title="Chaos settings" lines={['503s, timeouts, lost and', 'duplicate callbacks']} />
          <Box x={830} y={348} w={160} h={70} title="ZRA VSDC" lines={['invoice in, receipt', 'and signature out']} />

          <Arrow d="M220,95 L237,95" />
          <Arrow d="M390,108 L463,108" label="/api/ussd" lx={420} ly={100} />
          <Arrow d="M220,175 L463,128" label="deliveries sync" lx={300} ly={146} />
          <Arrow d="M220,275 L463,131" />
          <Arrow d="M220,375 L463,134" />
          <Arrow d="M220,475 L463,137" />
          <Arrow d="M782,128 L827,128" label="HTTP" lx={804} ly={121} />
          <Arrow d="M827,165 L785,165" dashed />
          <text x={804} y={182} fontSize={10.5} fill="var(--ink-3)" textAnchor="middle">
            callback
          </text>
          <Arrow d="M782,383 L827,383" label="HTTP" lx={804} ly={376} />
          <Arrow d="M910,232 L910,189" dashed />
          <Arrow d="M910,302 L910,345" dashed />
        </svg>
        <figcaption className="mt-2 text-sm text-ink-3">Solid arrows are requests; dashed arrows are callbacks and the chaos settings that shape the simulators.</figcaption>
      </figure>

      <section aria-labelledby="decisions" className="grid gap-8 lg:grid-cols-[minmax(0,20rem)_1fr]">
        <div>
          <h2 id="decisions" className="font-display text-4xl font-extrabold tracking-wide">
            Decisions worth explaining
          </h2>
          <p className="mt-2 text-ink-2">Each has a longer write-up with the alternatives considered in the repository’s docs/adr folder.</p>
        </div>
        <dl className="divide-y divide-rule border-y border-rule">
          {DECISIONS.map(([title, body]) => (
            <div key={title} className="py-4">
              <dt className="font-semibold">{title}</dt>
              <dd className="mt-1 text-ink-2">{body}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="tests" className="grid gap-8 lg:grid-cols-[minmax(0,20rem)_1fr]">
        <div>
          <h2 id="tests" className="font-display text-4xl font-extrabold tracking-wide">
            How it’s tested
          </h2>
        </div>
        <div className="space-y-3 text-ink-2">
          <p>
            <strong className="text-ink">Property tests</strong> (fast-check) throw hundreds of random settlements at the maths, with random deliveries, transit losses and tax rules,
            and check that every entry balances and what the buyer pays is exactly what everyone else receives.
          </p>
          <p>
            <strong className="text-ink">Integration tests</strong> run whole harvests against Postgres with the simulators in-process: one calm, three in a storm of refusals,
            timeouts, failures and lost, duplicated and out-of-order callbacks. They check that no payout reaches the provider twice, every farmer’s wallet holds exactly what they
            were owed, the books reconcile with the provider’s statement and the audit trail verifies.
          </p>
          <p>
            <strong className="text-ink">USSD tests</strong> render every screen, in every language, with worst-case data, and fail if one is longer than a phone can show.
          </p>
          <p>
            <strong className="text-ink">An end-to-end script</strong> drives the running app over HTTP exactly as a browser and Africa’s Talking would, and a browser test runs the
            guided harvest from start to finish.
          </p>
          <div className="pt-2">
            <LinkButton href="/api-docs" variant="secondary">
              Read the API
            </LinkButton>
          </div>
        </div>
      </section>
    </div>
  )
}
