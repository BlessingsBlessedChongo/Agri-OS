'use client'

import * as React from 'react'
import { formatKwacha } from '@/domain/money'
import { formatWeight } from '@/domain/produce'
import { catTime } from '@/lib/describe'
import type { FarmerDetail, Reference } from '@/lib/types'
import { useApi, useWorld } from '@/lib/world'
import { FeaturePhone } from '@/ui/feature-phone'
import { Empty, inputClass, Loading, Money, Panel, StatusPill } from '@/ui/kit'

const BAND: Record<string, string> = { BUILDING: 'Building', FAIR: 'Fair', GOOD: 'Good', STRONG: 'Strong' }
const LANG: Record<string, string> = { en: 'English', bem: 'Ichibemba', nya: 'Chinyanja' }

export function FarmerView() {
  const { world, seq } = useWorld()
  const { data: ref } = useApi<Reference>(world ? '/api/reference' : null, seq)
  const [choice, setChoice] = React.useState<string>('guide')
  const [newNumber, setNewNumber] = React.useState<string | null>(null)

  const farmers = ref?.farmers ?? []
  const guide = world?.guide
  const selected =
    choice === 'new' ? null : choice === 'guide' ? farmers.find((f) => f.phone === guide?.phone) : farmers.find((f) => f.id === choice)
  const phone = choice === 'new' ? newNumber : (selected?.phone ?? guide?.phone ?? null)
  const owner = choice === 'new' ? 'A new farmer' : (selected?.name ?? guide?.name ?? '')
  const detail = useApi<FarmerDetail>(selected ? `/api/farmers/${selected.id}` : null, seq)

  const pickNew = () => {
    const digits = Array.from(crypto.getRandomValues(new Uint8Array(7)), (b) => String(b % 10)).join('')
    setNewNumber(`+26095${digits}`)
    setChoice('new')
  }

  const depots = new Map((ref?.depots ?? []).map((d) => [d.id, d.name]))
  const d = detail.data

  return (
    <div className="grid gap-8 lg:grid-cols-[auto_minmax(0,1fr)]">
      <div className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="sim" className="text-sm font-semibold">
            Whose phone
          </label>
          <select
            id="sim"
            className={inputClass}
            value={choice}
            onChange={(e) => (e.target.value === 'new' ? pickNew() : setChoice(e.target.value))}
          >
            <option value="guide">{guide ? `${guide.name} (Chipata)` : 'Mary Banda (Chipata)'}</option>
            {farmers
              .filter((f) => f.phone !== guide?.phone)
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} ({depots.get(f.depotId ?? '') ?? '—'}){f.registeredHere ? ', registered by you' : ''}
                </option>
              ))}
            <option value="new">A new number (try registering)</option>
          </select>
        </div>
        {phone && world ? <FeaturePhone key={phone} phone={phone} owner={owner} seq={seq} /> : <div className="h-[520px] w-[264px]" />}
      </div>

      <div className="space-y-6">
        <div className="max-w-2xl">
          <h1 className="font-display text-5xl leading-none font-extrabold tracking-wide">Farmer</h1>
          <p className="mt-3 text-ink-2">
            A basic phone is enough. Dial <strong>*384*123#</strong> and press Call, then answer with the keypad (or your keyboard). Press 1 for buyer offers, 4 for the trade record.
            0 goes back, 00 goes home. Messages arrive in the Inbox.
          </p>
          {choice === 'new' && (
            <p className="mt-2 rounded-md bg-maize-wash px-3 py-2 text-sm">
              This number isn’t registered. Dial in, choose a language, then register with your name and nearest depot. The menus follow the language you pick.
            </p>
          )}
        </div>

        {!selected ? null : detail.loading && !d ? (
          <Loading label="Loading the trade record" />
        ) : d ? (
          <>
            <Panel title={`${d.farmer.name}’s trade record`} aside={<span className="text-sm text-ink-3">{d.district?.name}, {d.district?.provinceName} · {LANG[d.farmer.language]}</span>}>
              <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
                <div>
                  <div className="font-display text-6xl leading-none font-extrabold tabular">{d.credit.score}</div>
                  <div className="text-sm text-ink-3">out of 100, {BAND[d.credit.band].toLowerCase()}</div>
                </div>
                <div className="text-sm text-ink-2">
                  <div>
                    {d.credit.salesCount} sales worth <Money ngwee={d.credit.yearAmount} /> in 12 months
                  </div>
                  <div>{formatWeight(d.credit.yearGrams)} sold</div>
                  <div>{d.credit.earlyPaymentEligible ? 'Eligible for early payment from partner lenders' : 'Not yet eligible for early payment (needs 60+ and 3 sales)'}</div>
                </div>
              </div>
              <ul className="mt-5 space-y-3">
                {d.credit.factors.map((f) => (
                  <li key={f.key} className="grid grid-cols-[9rem_1fr] items-start gap-3 text-sm sm:grid-cols-[11rem_6rem_1fr]">
                    <span className="font-semibold">{f.label}</span>
                    <span className="tabular text-ink-2">
                      {f.points} of {f.max}
                    </span>
                    <span className="col-span-2 text-ink-2 sm:col-span-1">{f.detail}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-ink-3">The score only uses what Agri-OS has seen: deliveries against pledges, volume, regularity, grades and time trading. Every point is explained.</p>
            </Panel>

            <div className="grid gap-6 md:grid-cols-2">
              <Panel title="Pledges">
                {d.pledges.length === 0 ? (
                  <p className="text-sm text-ink-3">No pledges in this sandbox yet.</p>
                ) : (
                  <ul className="divide-y divide-rule text-sm">
                    {d.pledges.map(({ pledge, crop }) => (
                      <li key={pledge.id} className="flex items-center justify-between gap-2 py-2">
                        <span>
                          {pledge.ref}: {pledge.bags} bags of {crop.toLowerCase()}
                        </span>
                        <StatusPill status={pledge.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
              <Panel title="Payments">
                {d.payouts.length === 0 ? (
                  <p className="text-sm text-ink-3">No payments in this sandbox yet.</p>
                ) : (
                  <ul className="divide-y divide-rule text-sm">
                    {d.payouts.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                        <span className="tabular">
                          {formatKwacha(p.amountNgwee)} <span className="text-ink-3">{catTime(p.succeededAt ?? p.createdAt)}</span>
                        </span>
                        <StatusPill status={p.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>

            <Panel title="Recent sales">
              {d.invoices.length === 0 ? (
                <Empty title="No sales yet" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-left text-sm tabular">
                    <thead className="text-xs text-ink-3">
                      <tr>
                        <th className="py-1 font-normal">Date</th>
                        <th className="py-1 font-normal">Crop</th>
                        <th className="py-1 text-right font-normal">Weight</th>
                        <th className="py-1 text-right font-normal">Amount</th>
                        <th className="py-1 pl-6 font-normal">Invoice</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.invoices.map((inv) => (
                        <tr key={inv.id} className="border-t border-rule">
                          <td className="py-1.5">{catTime(inv.issuedAt)}</td>
                          <td className="py-1.5">
                            {inv.crop?.toLowerCase()} {inv.grade}
                          </td>
                          <td className="py-1.5 text-right">{formatWeight(inv.quantityGrams ?? 0)}</td>
                          <td className="py-1.5 text-right">{formatKwacha(inv.subtotalNgwee)}</td>
                          <td className="py-1.5 pl-6">
                            <a className="text-leaf underline-offset-2 hover:underline" href={`/verify/${inv.id}`}>
                              {inv.number}
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </>
        ) : null}
      </div>
    </div>
  )
}
