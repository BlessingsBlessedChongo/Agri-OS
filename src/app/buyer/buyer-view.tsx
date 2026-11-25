'use client'

import * as React from 'react'
import { Lock, Plus, Scale, X } from 'lucide-react'
import { formatKwacha, parseKwacha } from '@/domain/money'
import { CROP_CODES, CROPS, formatWeight, type CropCode, type Grade } from '@/domain/produce'
import { api, errorText } from '@/lib/api'
import { catTime } from '@/lib/describe'
import type { Invoice, Order, OrderDetail, Reference } from '@/lib/types'
import { useApi, useWorld } from '@/lib/world'
import { Button, cx, Empty, Field, inputClass, Loading, Money, Notice, Panel, Progress, StatusPill } from '@/ui/kit'
import { SevenSegment } from '@/ui/seven-segment'

interface Signed {
  reading: { deviceId: string; consignmentId: string; kind: 'GROSS' | 'TARE'; grams: number; readAt: string; nonce: string }
  signature: string
}

export function BuyerView() {
  const { world, seq, poke } = useWorld()
  const { data: ref } = useApi<Reference>(world ? '/api/reference' : null, 1)
  const { data: list } = useApi<{ orders: Order[] }>(world ? '/api/orders' : null, seq)
  const [selected, setSelected] = React.useState<string | null>(null)
  const [creating, setCreating] = React.useState(false)
  const orders = list?.orders ?? []
  const current = selected ?? orders[0]?.id ?? null
  const showForm = creating || (list !== null && orders.length === 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="font-display text-5xl leading-none font-extrabold tracking-wide">Buyer</h1>
          <p className="mt-3 text-ink-2">
            Post what you need, fund escrow from your Zamtel Money wallet, and weigh trucks at your plant. Farmers are paid the moment a truck is accepted, and you receive an invoice
            for every purchase, issued on each farmer’s behalf and accepted by the VSDC.
          </p>
        </div>
        {orders.length > 0 && (
          <Button onClick={() => setCreating((c) => !c)} variant={creating ? 'secondary' : 'primary'}>
            {creating ? <X size={16} aria-hidden /> : <Plus size={16} aria-hidden />} {creating ? 'Cancel' : 'Post demand'}
          </Button>
        )}
      </div>

      {showForm && ref && (
        <NewOrder
          reference={ref}
          onCreated={(id) => {
            setCreating(false)
            setSelected(id)
            poke()
          }}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <nav aria-label="Orders" className="space-y-2">
          {orders.length === 0 && <Empty title="No orders yet">Post demand above, or run the guided harvest to see one from start to finish.</Empty>}
          {orders.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setSelected(o.id)}
              className={cx('block w-full rounded-[10px] border px-3 py-2.5 text-left', o.id === current ? 'border-ink bg-sheet' : 'border-rule bg-sheet hover:border-ink-3')}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{o.ref}</span>
                <StatusPill status={o.status} />
              </div>
              <div className="text-sm text-ink-2">
                {formatWeight(o.quantityKg * 1000)} {CROPS[o.crop].name.toLowerCase()} at {formatKwacha(o.priceNgweePerKg)}/kg
              </div>
              <div className="mt-1 text-xs text-ink-3">
                {formatWeight(o.deliveredGrams ?? 0)} delivered, {formatWeight(o.settledGrams ?? 0)} settled
              </div>
            </button>
          ))}
        </nav>
        {current ? <OrderPanel key={current} orderId={current} /> : null}
      </div>
    </div>
  )
}

function NewOrder({ reference, onCreated }: { reference: Reference; onCreated: (id: string) => void }) {
  const [buyerId, setBuyerId] = React.useState(reference.buyers[0]?.id ?? '')
  const [crop, setCrop] = React.useState<CropCode>('MAIZE')
  const [grade, setGrade] = React.useState<Grade>('B')
  const [tonnes, setTonnes] = React.useState('6')
  const [price, setPrice] = React.useState('6.20')
  const [days, setDays] = React.useState('5')
  const [depotIds, setDepotIds] = React.useState<string[]>([reference.depots[0]?.id].filter(Boolean) as string[])
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    let priceNgwee: number
    try {
      priceNgwee = parseKwacha(price)
    } catch {
      setError('Price must be in kwacha, for example 6.20')
      return
    }
    setBusy(true)
    try {
      const { order } = await api<{ order: { id: string } }>('/api/orders', {
        body: { buyerId, crop, minGrade: grade, quantityKg: Math.round(Number(tonnes) * 1000), priceNgweePerKg: priceNgwee, depotIds, deliverBy: new Date(Date.now() + Number(days) * 86_400_000).toISOString() },
      })
      onCreated(order.id)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="Post demand">
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-3">
        <Field label="Buyer" htmlFor="buyer">
          <select id="buyer" className={inputClass} value={buyerId} onChange={(e) => setBuyerId(e.target.value)}>
            {reference.buyers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.plantName})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Crop" htmlFor="crop">
          <select id="crop" className={inputClass} value={crop} onChange={(e) => setCrop(e.target.value as CropCode)}>
            {CROP_CODES.map((c) => (
              <option key={c} value={c}>
                {CROPS[c].name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Lowest grade accepted" htmlFor="grade">
          <select id="grade" className={inputClass} value={grade} onChange={(e) => setGrade(e.target.value as Grade)}>
            <option value="A">A only</option>
            <option value="B">B or better</option>
            <option value="C">Any grade</option>
          </select>
        </Field>
        <Field label="Quantity (tonnes)" htmlFor="tonnes">
          <input id="tonnes" inputMode="decimal" className={inputClass} value={tonnes} onChange={(e) => setTonnes(e.target.value)} />
        </Field>
        <Field label="Price (K per kg, grade A)" htmlFor="price" hint="Grade B is paid 95%, grade C 88%.">
          <input id="price" inputMode="decimal" className={inputClass} value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
        <Field label="Deliver within (days)" htmlFor="days">
          <input id="days" inputMode="numeric" className={inputClass} value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <fieldset className="md:col-span-3">
          <legend className="text-sm font-semibold">Collect at</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {reference.depots.map((d) => (
              <label key={d.id} className={cx('flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm', depotIds.includes(d.id) ? 'border-ink bg-sheet-2' : 'border-rule')}>
                <input
                  type="checkbox"
                  className="accent-[var(--leaf)]"
                  checked={depotIds.includes(d.id)}
                  onChange={(e) => setDepotIds((ids) => (e.target.checked ? [...ids, d.id] : ids.filter((x) => x !== d.id)))}
                />
                {d.name} <span className="text-ink-3">{d.provinceName}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {error && (
          <Notice tone="bad" className="md:col-span-3">
            {error}
          </Notice>
        )}
        <div className="md:col-span-3">
          <Button type="submit" busy={busy} disabled={depotIds.length === 0}>
            Post demand
          </Button>
          <span className="ml-3 text-sm text-ink-3">Agri-OS works out the escrow needed: every kilo at grade A, haulage from the farthest depot, the 1% fee and VAT, plus 2%.</span>
        </div>
      </form>
    </Panel>
  )
}

function OrderPanel({ orderId }: { orderId: string }) {
  const { world, seq, poke } = useWorld()
  const { data: d, error } = useApi<OrderDetail>(`/api/orders/${orderId}`, seq)
  const invoices = useApi<{ invoices: Invoice[] }>(world ? '/api/invoices?live=1&limit=200' : null, seq)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [message, setMessage] = React.useState<{ tone: 'good' | 'bad' | 'info'; text: string } | null>(null)
  const [readout, setReadout] = React.useState<{ consignmentId: string; grams: number; kind: string } | null>(null)
  const [pin, setPin] = React.useState('')
  const prompts = useApi<{ prompts: Array<{ id: string; message: string }>; balance: string | null }>(
    d && world ? `/api/sim/zamtel/${world.id}/v1/customer/prompts?msisdn=${encodeURIComponent(d.buyer.phone)}` : null,
    seq,
  )

  if (error && !d) return <Notice tone="bad">{error}</Notice>
  if (!d) return <Loading label="Loading the order" />

  const act = async (label: string, work: () => Promise<string | void>) => {
    setBusy(label)
    setMessage(null)
    try {
      const text = await work()
      if (text) setMessage({ tone: 'good', text })
      poke()
      prompts.reload()
    } catch (e) {
      setMessage({ tone: 'bad', text: errorText(e) })
    } finally {
      setBusy(null)
    }
  }

  const weigh = (consignmentId: string, kind: 'GROSS' | 'TARE') =>
    act(kind, async () => {
      const signed = await api<Signed>('/api/sim/weighbridge', { body: { consignmentId, kind } })
      setReadout({ consignmentId, grams: signed.reading.grams, kind })
      await api('/api/weighbridge/readings', { body: signed })
      return kind === 'GROSS' ? 'Loaded weight recorded. Unload, then weigh the truck empty.' : 'Empty weight recorded. The truck is settled.'
    })

  const typeByHand = (consignmentId: string) =>
    act('HAND', async () => {
      const typed = window.prompt('Type the loaded weight in kg (as someone at the weighbridge might):', '20000')
      if (!typed) return
      const grams = Math.round(Number(typed) * 1000)
      const reading = { deviceId: `WB-${d.buyer.code}`, consignmentId, kind: 'GROSS' as const, grams, readAt: new Date().toISOString(), nonce: 'typedbyhand0' }
      await api('/api/weighbridge/readings', { body: { reading, signature: '0'.repeat(64) } })
    })

  const prompt = prompts.data?.prompts[0]
  const payable = d.payouts.reduce((a, p) => a + p.amountNgwee, 0)
  const paid = d.payouts.filter((p) => p.status === 'SUCCEEDED')
  const orderInvoices = (invoices.data?.invoices ?? []).filter((i) => i.orderId === orderId)

  return (
    <div className="space-y-6">
      <Panel
        title={`${d.order.ref}: ${formatWeight(d.order.quantityKg * 1000)} of ${d.crop.name.toLowerCase()}`}
        aside={
          <div className="flex items-center gap-2">
            <StatusPill status={d.order.status} />
            {(d.order.status === 'OPEN' || d.order.status === 'FUNDING') && (
              <Button size="sm" variant="secondary" busy={busy === 'close'} onClick={() => act('close', async () => {
                await api(`/api/orders/${orderId}/close`, { method: 'POST' })
                return 'Order closed. Unused escrow returns once every truck is settled.'
              })}>
                Close order
              </Button>
            )}
          </div>
        }
      >
        <div className="grid gap-5 md:grid-cols-3">
          <div className="text-sm text-ink-2">
            <div className="font-semibold text-ink">{d.buyer.name}</div>
            Grade {d.order.minGrade} or better at {formatKwacha(d.order.priceNgweePerKg)}/kg
            <div>Collect at {d.depots.map((x) => `${x.depot.name} (${x.distanceKm} km)`).join(', ')}</div>
            <div>Deliver by {catTime(d.order.deliverBy)}</div>
          </div>
          <div className="space-y-3 md:col-span-2">
            {d.order.status === 'COMPLETED' ? (
              <p className="text-sm text-ink-2">
                Escrow closed.{' '}
                {d.payouts.find((p) => p.kind === 'REFUND')
                  ? `${formatKwacha(d.payouts.find((p) => p.kind === 'REFUND')!.amountNgwee)} that wasn’t needed went back to ${d.buyer.name}.`
                  : 'Every kwacha of it was used.'}
              </p>
            ) : (
              <Progress value={d.escrow.fundedNgwee} max={d.escrow.targetNgwee} label={`Escrow ${formatKwacha(d.escrow.fundedNgwee)} of ${formatKwacha(d.escrow.targetNgwee)}`} tone="sky" />
            )}
            <Progress value={d.progress.pledgedKg} max={d.order.quantityKg} label={`Pledged ${formatWeight(d.progress.pledgedKg * 1000)}`} tone="maize" />
            <Progress value={d.progress.deliveredGrams} max={d.order.quantityKg * 1000} label={`Delivered ${formatWeight(d.progress.deliveredGrams)}`} />
          </div>
        </div>
        {message && (
          <Notice tone={message.tone === 'bad' ? 'bad' : 'good'} className="mt-4">
            {message.text}
          </Notice>
        )}
        {(d.order.status === 'FUNDING' || d.escrow.fundedNgwee < d.escrow.targetNgwee) && d.order.status !== 'COMPLETED' && d.order.status !== 'CLOSED' && (
          <div className="mt-4 flex flex-wrap items-start gap-4 rounded-[10px] border border-rule bg-sheet-2 p-4">
            {prompt ? (
              <form
                className="w-full max-w-sm space-y-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  void act('pin', async () => {
                    await api(`/api/sim/zamtel/${world!.id}/v1/customer/prompts/${prompt.id}/approve`, { body: { pin } })
                    setPin('')
                    return 'Approved. The escrow will show as soon as Zamtel Money confirms.'
                  })
                }}
              >
                <div className="text-xs text-ink-3">On {d.buyer.name}’s phone (Zamtel Money)</div>
                <p className="font-semibold">{prompt.message}</p>
                <label htmlFor="pin" className="block text-sm">
                  Enter any 4-digit PIN (0000 is treated as wrong)
                </label>
                <div className="flex gap-2">
                  <input id="pin" inputMode="numeric" maxLength={4} autoComplete="off" className={cx(inputClass, 'w-28 tracking-[0.4em]')} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
                  <Button type="submit" busy={busy === 'pin'} disabled={pin.length !== 4}>
                    <Lock size={14} aria-hidden /> Approve
                  </Button>
                  <Button
                    type="button"
                    variant="quiet"
                    onClick={() => act('decline', async () => {
                      await api(`/api/sim/zamtel/${world!.id}/v1/customer/prompts/${prompt.id}/decline`, { method: 'POST' })
                    })}
                  >
                    Decline
                  </Button>
                </div>
              </form>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-ink-2">Farmers can’t see this offer until the escrow is in place.</p>
                <Button busy={busy === 'fund'} onClick={() => act('fund', async () => {
                  await api(`/api/orders/${orderId}/fund`, { method: 'POST' })
                  return 'Payment request sent to your phone.'
                })}>
                  Fund escrow from Zamtel Money
                </Button>
                {prompts.data?.balance && <span className="text-sm text-ink-3">Wallet balance K{Number(prompts.data.balance).toLocaleString('en', { minimumFractionDigits: 2 })}</span>}
              </div>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Trucks and the weighbridge">
        {d.consignments.length === 0 ? (
          <p className="text-sm text-ink-3">No trucks yet. The depot loads one once deliveries are received.</p>
        ) : (
          <div className="space-y-4">
            {d.consignments.map((c) => (
              <div key={c.id} className="grid gap-4 rounded-[10px] border border-rule p-3 md:grid-cols-[1fr_auto]">
                <div className="space-y-1 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">
                      {c.ref}, truck {c.truckReg}
                    </span>
                    <StatusPill status={c.status} />
                  </div>
                  <div className="text-ink-2">
                    Loaded {formatWeight(c.depotGrams)} at the depot, {c.distanceKm} km, haulage {formatKwacha(c.transportFeeNgwee)}
                  </div>
                  {c.arrivedGrams !== null && (
                    <div className="text-ink-2">
                      Arrived {formatWeight(c.arrivedGrams)} ({c.varianceGrams && c.varianceGrams < 0 ? `${formatWeight(-c.varianceGrams)} short` : 'nothing missing'})
                    </div>
                  )}
                  {c.holdReason && <div className="text-chili">{c.holdReason}. Fund the escrow again to release it.</div>}
                  {c.status === 'IN_TRANSIT' && (
                    <div className="flex flex-wrap gap-2 pt-2">
                      <Button size="sm" busy={busy === 'GROSS'} onClick={() => void weigh(c.id, 'GROSS')}>
                        <Scale size={14} aria-hidden /> Weigh loaded
                      </Button>
                      <Button size="sm" variant="secondary" busy={busy === 'TARE'} onClick={() => void weigh(c.id, 'TARE')}>
                        Weigh empty
                      </Button>
                      <Button size="sm" variant="quiet" busy={busy === 'HAND'} onClick={() => void typeByHand(c.id)}>
                        Type a weight by hand
                      </Button>
                    </div>
                  )}
                </div>
                <div className="w-full rounded-[12px] bg-led-bg px-3 pt-3 pb-2 md:w-60">
                  <SevenSegment
                    value={readout?.consignmentId === c.id ? String(Math.round(readout.grams / 1000)) : c.arrivedGrams ? String(Math.round(c.arrivedGrams / 1000)) : '-----'}
                    width={6}
                    height={44}
                    label="Weighbridge readout"
                    className="w-full"
                  />
                  <div className="mt-1 flex justify-between text-xs text-led/70">
                    <span>{readout?.consignmentId === c.id ? (readout.kind === 'GROSS' ? 'Loaded' : 'Empty') : c.arrivedGrams ? 'Net load' : 'Idle'}</span>
                    <span>kg · signed</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Payouts" aside={d.payouts.length ? <span className="text-sm text-ink-3 tabular">{paid.length} of {d.payouts.length} paid, {formatKwacha(paid.reduce((a, p) => a + p.amountNgwee, 0))} of {formatKwacha(payable)}</span> : null}>
        {d.payouts.length === 0 ? (
          <p className="text-sm text-ink-3">Everyone is paid together when a truck is accepted at the weighbridge.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-xs text-ink-3">
                <tr>
                  <th className="py-1 font-normal">To</th>
                  <th className="py-1 font-normal">For</th>
                  <th className="py-1 text-right font-normal">Amount</th>
                  <th className="py-1 font-normal">Status</th>
                  <th className="py-1 font-normal">Attempts</th>
                </tr>
              </thead>
              <tbody>
                {d.payouts.map((p) => (
                  <tr key={p.id} className="border-t border-rule">
                    <td className="py-1.5">{p.partyName}</td>
                    <td className="py-1.5 text-ink-2">{{ FARMER: 'Produce', TRANSPORTER: 'Haulage', TAX: 'Tax', REFUND: 'Unused escrow' }[p.kind]}</td>
                    <td className="py-1.5 text-right tabular">
                      <Money ngwee={p.amountNgwee} />
                    </td>
                    <td className="py-1.5">
                      <StatusPill status={p.status} />
                    </td>
                    <td className="py-1.5 text-ink-3 tabular" title={p.lastError ?? undefined}>
                      {p.attempt}
                      {p.lastError && p.status !== 'SUCCEEDED' ? `: ${p.lastError}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Invoices">
        {orderInvoices.length === 0 ? (
          <p className="text-sm text-ink-3">Issued at settlement: one per farmer’s delivery (issued on the farmer’s behalf), one for haulage and one for the Agri-OS fee.</p>
        ) : (
          <ul className="divide-y divide-rule text-sm">
            {orderInvoices.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <a href={`/verify/${inv.id}`} className="text-leaf underline-offset-2 hover:underline">
                  {inv.number}
                </a>
                <span className="flex-1 text-ink-2">
                  {inv.kind === 'PRODUCE' ? `${inv.sellerName}, ${formatWeight(inv.quantityGrams ?? 0)} ${inv.crop?.toLowerCase()} grade ${inv.grade}` : inv.kind === 'TRANSPORT' ? `Haulage by ${inv.sellerName}` : 'Agri-OS service fee'}
                </span>
                <span className="tabular">{formatKwacha(inv.totalNgwee)}</span>
                <StatusPill status={inv.vsdcStatus} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
