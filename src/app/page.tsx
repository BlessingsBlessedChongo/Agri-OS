import Link from 'next/link'
import { LinkButton } from '@/ui/kit'
import { PhoneShell } from '@/ui/phone-shell'
import { SevenSegment } from '@/ui/seven-segment'

const GUARANTEES: Array<[string, string]> = [
  [
    'Nobody is paid twice',
    'Every payout attempt has its own idempotency key. A timeout counts as unknown, never as failed: Agri-OS asks the provider or re-sends with the same key, and only a definite failure starts a new attempt.',
  ],
  [
    'Every kwacha is accounted for',
    'A double-entry ledger in integer ngwee. The database itself refuses an entry that doesn’t balance, an account that would go below zero, and any edit to a posted line.',
  ],
  [
    'Nothing is lost when the network drops',
    'Payouts and invoices are written to an outbox in the same transaction as the settlement and sent by a job queue. Lost confirmations are found by polling; duplicates and stale ones are ignored.',
  ],
  [
    'Farmers aren’t cheated on weight',
    'Farmers are paid for what the depot weighed. Weighbridge readings are signed by the device, so they can’t be typed in, and loss beyond 0.5% in transit comes out of the haulage fee.',
  ],
  [
    'The record can’t be quietly rewritten',
    'Every event is hash-chained. Change one amount directly in the database and verification names the exact event. Signed checkpoints let anyone hold the system to its history.',
  ],
  [
    'It works where farmers are',
    'USSD menus on any phone, in English, Bemba and Nyanja, built as a replay engine with no session state to lose. The depot app keeps recording offline and syncs each delivery exactly once.',
  ],
]

const ROLES: Array<{ href: string; name: string; who: string; does: string }> = [
  { href: '/farmer', name: 'Farmer', who: 'A basic phone, no internet', does: 'Sees buyer offers on *384*123#, pledges bags, gets SMS receipts and payment, shares a trade record with a lender.' },
  { href: '/depot', name: 'Depot', who: 'A clerk with a scale and patchy signal', does: 'Weighs and grades each farmer’s bags, keeps working offline, loads the truck.' },
  { href: '/buyer', name: 'Buyer', who: 'A miller or exporter', does: 'Posts demand, funds escrow from Zamtel Money, weighs trucks at the plant, gets a compliant invoice for every purchase.' },
  { href: '/zra', name: 'ZRA', who: 'The tax authority', does: 'Sees trade that used to be invisible, district by district, with fair-price indexes and explained risk flags.' },
]

export default function Home() {
  return (
    <div className="space-y-20">
      <section className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="max-w-2xl">
          <h1 className="font-display text-6xl leading-[0.9] font-extrabold tracking-wide sm:text-7xl">A harvest, settled to the ngwee.</h1>
          <p className="mt-5 text-lg text-ink-2">
            Agri-OS connects smallholder farmers on basic phones to buyers, holds the buyer’s money in escrow, weighs every bag, pays everyone at once through mobile money and issues
            the tax invoices. It is built for Zambia, with Zamtel Money and ZRA’s invoicing simulated end to end.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <LinkButton href="/demo" size="lg">
              Run a harvest
            </LinkButton>
            <LinkButton href="/architecture" variant="secondary" size="lg">
              How it’s built
            </LinkButton>
          </div>
          <p className="mt-4 text-sm text-ink-3">Takes about two minutes. You get a private sandbox; nothing you do affects anyone else.</p>
        </div>

        <div className="flex flex-wrap items-end justify-center gap-5" aria-label="What the harvest looks like on each device">
          <figure>
            <PhoneShell
              time="09:41"
              softKeys={{ left: 'Send', right: 'Clear' }}
              screen={
                <div className="flex h-full flex-col">
                  <div className="flex-1 px-2 pt-0.5 text-[12.5px] leading-[1.32] whitespace-pre-wrap">
                    {'Pledge 8 bags (400kg) of Maize at K310/bag = K2,480 to Kafue Plains Milling?\n1. Yes\n2. No'}
                  </div>
                  <div className="mx-1.5 mb-1 flex items-center rounded-[3px] bg-white px-1.5 py-[3px] text-[13px] leading-tight text-black">
                    <span className="flex-1">
                      1<span className="caret">|</span>
                    </span>
                    <span className="text-[9.5px] font-bold text-black/55">123</span>
                  </div>
                </div>
              }
            />
            <figcaption className="mt-2 text-center text-xs text-ink-3">Mary’s phone, after dialling *384*123#</figcaption>
          </figure>
          <div className="space-y-4">
            <div className="w-[250px] rounded-[14px] bg-led-bg px-3 pt-3 pb-2">
              <SevenSegment value="21460" width={6} height={50} label="Weighbridge reads 21,460 kilograms" className="w-full" />
              <div className="mt-1 flex justify-between text-xs text-led/70">
                <span>Kafue mill, loaded truck</span>
                <span>kg, signed</span>
              </div>
            </div>
            <div className="w-[250px] rounded-[6px] border border-rule bg-sheet px-4 py-3 text-sm shadow-sm">
              <div className="text-xs text-ink-3">SMS to Mary Banda</div>
              <p className="mt-1">K2,480.00 paid to your Zamtel Money. Invoice INV-2026-000003 recorded with ZRA.</p>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="who">
        <h2 id="who" className="font-display text-4xl font-extrabold tracking-wide">
          One truck, four people
        </h2>
        <p className="mt-2 max-w-2xl text-ink-2">Each of them has their own screen. Open any of them in your sandbox, or run the harvest and watch all four at once.</p>
        <div className="mt-6 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
          {ROLES.map((r) => (
            <Link key={r.href} href={r.href} className="group block border-t-4 border-ink pt-3">
              <h3 className="font-display text-3xl font-bold tracking-wide group-hover:text-leaf">{r.name}</h3>
              <p className="text-sm font-semibold text-ink-2">{r.who}</p>
              <p className="mt-2 text-sm text-ink-2">{r.does}</p>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="guarantees" className="grid gap-8 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <div>
          <h2 id="guarantees" className="font-display text-4xl font-extrabold tracking-wide">
            What keeps the money right
          </h2>
          <p className="mt-2 text-ink-2">
            Payments fail in boring, predictable ways: timeouts, duplicates, lost confirmations, a depot with no signal. Each promise here is enforced in code or in the database, and
            tested by throwing those failures at it.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <LinkButton href="/resilience" variant="secondary">
              Turn the network bad
            </LinkButton>
            <LinkButton href="/audit" variant="quiet">
              Try to tamper with the record
            </LinkButton>
          </div>
        </div>
        <dl className="divide-y divide-rule border-y border-rule">
          {GUARANTEES.map(([promise, how]) => (
            <div key={promise} className="grid gap-1 py-4 sm:grid-cols-[14rem_1fr] sm:gap-6">
              <dt className="font-semibold">{promise}</dt>
              <dd className="text-ink-2">{how}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="simulated" className="max-w-3xl border-l-4 border-maize pl-5">
        <h2 id="simulated" className="font-display text-3xl font-extrabold tracking-wide">
          What’s real and what’s simulated
        </h2>
        <p className="mt-2 text-ink-2">
          Agri-OS itself is real: the ledger, the settlement rules, the job queue, the USSD engine, the depot sync, the signatures, the reconciliation. Zamtel Money and ZRA’s VSDC are
          stand-ins that behave like the real services behind real HTTP APIs, with API keys, idempotency keys, asynchronous results and signed callbacks, so swapping in the real ones
          changes one adapter each. The USSD endpoint speaks Africa’s Talking’s format, and SMS can go out through their API when a key is configured.
        </p>
      </section>
    </div>
  )
}
