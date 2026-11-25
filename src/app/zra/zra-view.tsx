'use client'

import * as React from 'react'
import { Download, ShieldAlert } from 'lucide-react'
import { formatKwacha, formatKwachaCompact } from '@/domain/money'
import { CROP_CODES, CROPS, formatWeight, type CropCode } from '@/domain/produce'
import { api, errorText } from '@/lib/api'
import { catTime } from '@/lib/describe'
import type { PriceWeek, Reference, TaxRule, ZraData } from '@/lib/types'
import { useApi, useWorld } from '@/lib/world'
import { Bars, PriceChart } from '@/ui/charts'
import { Button, cx, inputClass, Loading, Notice, Panel, Pill, Stat } from '@/ui/kit'
import { ZambiaMap } from '@/ui/zambia-map'

const SEVERITY: Record<string, 'bad' | 'wait' | 'muted'> = { HIGH: 'bad', MEDIUM: 'wait', LOW: 'muted' }

export function ZraView() {
  const { world, feed } = useWorld()
  const version = feed.filter((e) => ['invoice.accepted', 'settlement.completed', 'risk.flagged', 'tax.rule_changed'].includes(e.type)).length
  const { data, error } = useApi<ZraData>(world ? '/api/zra' : null, version)
  const { data: ref } = useApi<Reference>(world ? '/api/reference' : null, 1)
  const [crop, setCrop] = React.useState<CropCode>('MAIZE')
  const prices = useApi<{ weeks: PriceWeek[] }>(world ? `/api/zra/prices?crop=${crop}` : null, version)

  if (error && !data) return <Notice tone="bad">{error}</Notice>
  if (!data) return <Loading label="Loading the national picture" />
  const { season, live } = data.overview
  const pulse = data.overview.byDistrict.filter((d) => d.live > 0).map((d) => d.districtId)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="font-display text-5xl leading-none font-extrabold tracking-wide">ZRA</h1>
          <p className="mt-3 text-ink-2">
            Trade between smallholders and buyers used to happen in cash, invisible to the tax system. Here every sale arrives as an invoice the buyer issued on the farmer’s behalf and
            the VSDC accepted. The value is in the visibility: a fair-price index, traceable purchases for every registered buyer, and flags that explain themselves.
          </p>
        </div>
        {/* A file download from the API, not a page: a plain link is right here. */}
        <a href="/api/invoices/export" download className="inline-flex h-10 items-center gap-2 rounded-md border border-rule bg-sheet px-4 text-ink hover:bg-sheet-2">
          <Download size={16} aria-hidden /> Export invoices (CSV)
        </a>
      </div>

      <div className="grid gap-x-8 gap-y-5 rounded-[10px] border border-rule bg-sheet p-5 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Trade made visible, last 6 months" value={formatKwachaCompact(season.produceValueNgwee)} note={`${formatWeight(season.grams)} of produce`} />
        <Stat label="Farmers with a digital record" value={season.farmers.toLocaleString('en')} note={`selling to ${season.buyers} registered buyers`} />
        <Stat label="Invoices accepted" value={season.invoices.toLocaleString('en')} note={`${season.produceInvoices.toLocaleString('en')} for produce`} />
        <Stat label="Paid to ZRA at settlement" value={formatKwachaCompact(season.taxToZraNgwee)} note="VAT on Agri-OS fees" />
        <Stat label="From your sandbox" value={live.invoices} note={live.invoices ? `${formatKwacha(live.produceValueNgwee)} of produce${live.pendingAtVsdc ? `, ${live.pendingAtVsdc} at the VSDC` : ''}` : 'Run a harvest to add to it'} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Panel title="Produce traded per district" aside={<span className="text-sm text-ink-3">Last 6 months, {data.overview.byDistrict.length} districts</span>}>
          <ZambiaMap
            data={data.overview.byDistrict}
            pulse={pulse}
            depots={(ref?.depots ?? []).map((d) => ({ id: d.id, name: d.name, lat: d.lat, lng: d.lng }))}
            plants={(ref?.buyers ?? []).map((b) => ({ id: b.id, name: `${b.name}, ${b.plantName}`, lat: b.lat, lng: b.lng }))}
          />
        </Panel>
        <div className="space-y-6">
          <Panel
            title="Price per kg, weekly median"
            aside={
              <select aria-label="Crop" className={cx(inputClass, 'h-8 w-auto text-sm')} value={crop} onChange={(e) => setCrop(e.target.value as CropCode)}>
                {CROP_CODES.map((c) => (
                  <option key={c} value={c}>
                    {CROPS[c].name}
                  </option>
                ))}
              </select>
            }
          >
            {prices.data ? <PriceChart weeks={prices.data.weeks} label={`${CROPS[crop].name} price`} /> : <Loading />}
            <p className="mt-1 text-xs text-ink-3">The line is the median price paid each week; the band is the middle half of prices. A sale far below it is flagged.</p>
          </Panel>
          <Panel title="By crop">
            <Bars rows={data.overview.byCrop.map((c) => ({ key: c.crop, label: CROPS[c.crop].name, value: c.valueNgwee, grams: c.grams }))} />
          </Panel>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Latest invoices">
          <ul className="divide-y divide-rule text-sm">
            {data.recent.map((inv) => (
              <li key={inv.id} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 py-2">
                <a href={`/verify/${inv.id}`} className="font-semibold text-leaf underline-offset-2 hover:underline">
                  {inv.number}
                </a>
                <span className="text-right tabular">{formatKwacha(inv.totalNgwee)}</span>
                <span className="text-ink-2">
                  {inv.kind === 'PRODUCE' ? `${inv.sellerName} to ${inv.buyerName}, ${formatWeight(inv.quantityGrams ?? 0)} ${inv.crop?.toLowerCase()}` : inv.kind === 'TRANSPORT' ? `Haulage, ${inv.sellerName}` : `Agri-OS fee, VAT ${formatKwacha(inv.vatNgwee)}`}
                </span>
                <span className="flex items-center justify-end gap-2 text-xs text-ink-3">
                  {inv.worldId ? <Pill tone="info">Your sandbox</Pill> : null}
                  {catTime(inv.issuedAt)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Risk flags" aside={<ShieldAlert size={18} className="text-ink-3" aria-hidden />}>
          {data.flags.length === 0 ? (
            <p className="text-sm text-ink-3">No flags.</p>
          ) : (
            <ul className="space-y-4">
              {data.flags.map((f) => (
                <li key={f.id} className="text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={SEVERITY[f.severity]}>{f.severity === 'HIGH' ? 'High' : f.severity === 'MEDIUM' ? 'Medium' : 'Low'}</Pill>
                    <span className="font-semibold">{f.title}</span>
                    {f.worldId && <Pill tone="info">Your sandbox</Pill>}
                  </div>
                  <p className="mt-1 text-ink-2">{f.explanation}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <TaxRules />
    </div>
  )
}

function TaxRules() {
  const { world, poke } = useWorld()
  const { data, reload } = useApi<{ rules: TaxRule[]; defaults: TaxRule[] }>(world ? '/api/tax-rules' : null)
  const [drafts, setDrafts] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  if (!data) return null

  const save = async (rule: TaxRule, patch: Partial<TaxRule>) => {
    setBusy(rule.code)
    setError(null)
    try {
      await api('/api/tax-rules', { method: 'PUT', body: { code: rule.code, rateBp: patch.rateBp ?? rule.rateBp, enabled: patch.enabled ?? rule.enabled, collection: patch.collection ?? rule.collection } })
      reload()
      poke()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Panel title="Tax rules in your sandbox">
      <p className="mb-4 max-w-3xl text-sm text-ink-2">
        Tax is data, not code. These illustrative rules decide what each settlement charges and who it pays; change one and the next truck follows it. Withholding comes off what the
        seller receives and goes to ZRA; VAT is added for the buyer and either paid to ZRA now or recorded for the seller to file.
      </p>
      {error && (
        <Notice tone="bad" className="mb-3">
          {error}
        </Notice>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-xs text-ink-3">
            <tr>
              <th className="py-1 font-normal">Rule</th>
              <th className="py-1 font-normal">Rate</th>
              <th className="py-1 font-normal">Collected</th>
              <th className="py-1 font-normal">On</th>
              <th className="py-1 font-normal">Note</th>
            </tr>
          </thead>
          <tbody>
            {data.rules.map((r) => (
              <tr key={r.code} className="border-t border-rule align-top">
                <td className="py-2 pr-3">
                  <div className="font-semibold">{r.name}</div>
                  <div className="text-xs text-ink-3">{r.code}</div>
                </td>
                <td className="py-2 pr-3">
                  <form
                    className="flex items-center gap-1"
                    onSubmit={(e) => {
                      e.preventDefault()
                      const pct = Number(drafts[r.code] ?? r.rateBp / 100)
                      if (Number.isFinite(pct) && pct >= 0 && pct <= 30) void save(r, { rateBp: Math.round(pct * 100) })
                    }}
                  >
                    <input
                      aria-label={`${r.name} rate in percent`}
                      className={cx(inputClass, 'h-8 w-20')}
                      value={drafts[r.code] ?? String(r.rateBp / 100)}
                      onChange={(e) => setDrafts((d) => ({ ...d, [r.code]: e.target.value }))}
                    />
                    %
                    {drafts[r.code] !== undefined && Number(drafts[r.code]) * 100 !== r.rateBp && (
                      <Button size="sm" type="submit" busy={busy === r.code}>
                        Save
                      </Button>
                    )}
                  </form>
                </td>
                <td className="py-2 pr-3 text-ink-2">{r.kind === 'WITHHOLDING' ? 'Withheld, paid to ZRA' : r.collection === 'REMIT' ? 'Paid to ZRA at settlement' : 'Recorded for the seller'}</td>
                <td className="py-2 pr-3">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--leaf)]" checked={r.enabled} disabled={busy === r.code} onChange={(e) => void save(r, { enabled: e.target.checked })} />
                    {r.enabled ? <Pill tone="good">On</Pill> : <Pill tone="muted">Off</Pill>}
                  </label>
                </td>
                <td className="py-2 text-ink-2">{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}
