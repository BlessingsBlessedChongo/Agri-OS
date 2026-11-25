'use client'

import * as React from 'react'
import { CloudOff, Gauge, Scale, Truck, Wifi, WifiOff } from 'lucide-react'
import { formatKwacha } from '@/domain/money'
import { CROPS, formatWeight, type Grade } from '@/domain/produce'
import { api, errorText, sleep, uuid } from '@/lib/api'
import { catTime } from '@/lib/describe'
import { dropFromOutbox, markRefused, readOutbox, saveToOutbox, type OutboxItem } from '@/lib/outbox'
import type { Delivery, Order, Pledge, Reference } from '@/lib/types'
import { useApi, useWorld } from '@/lib/world'
import { Button, cx, Empty, Field, inputClass, Notice, Panel, StatusPill } from '@/ui/kit'
import { SevenSegment } from '@/ui/seven-segment'

interface Board {
  depot: { id: string; name: string; operator: string; clerkName: string }
  orders: Order[]
  expected: Array<{ pledge: Pledge; farmerName: string; farmerPhone: string; farmerCode: string }>
  received: Array<{ delivery: Delivery; farmerName: string }>
}

type SyncResult = { id: string; status: 'created' | 'duplicate'; ref: string; accepted: boolean; amountNgwee: number; reason: string | null } | { id: string; status: 'refused'; message: string }

function subscribeOnline(callback: () => void) {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

export function DepotView() {
  const { world, seq, poke } = useWorld()
  const { data: ref } = useApi<Reference>(world ? '/api/reference' : null, 1)
  const [depotId, setDepotId] = React.useState<string | null>(null)
  const depot = ref?.depots.find((d) => d.id === depotId) ?? ref?.depots.find((d) => d.code === 'DEP-CHP')
  const board = useApi<Board>(depot ? `/api/depots/${depot.id}` : null, seq)
  const browserOnline = React.useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true)
  const [simulateOffline, setSimulateOffline] = React.useState(false)
  const connected = browserOnline && !simulateOffline
  const [outbox, setOutbox] = React.useState<OutboxItem[]>([])
  const [message, setMessage] = React.useState<{ tone: 'good' | 'bad' | 'info'; text: string } | null>(null)
  const syncNow = React.useRef<() => void>(() => undefined)

  React.useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  }, [])

  // The sync loop: whenever there is signal, send the outbox; each record is accepted, recognised or refused on its own.
  React.useEffect(() => {
    if (!world) return
    let stopped = false
    const sync = async () => {
      if (connected) {
        const pending = (await readOutbox(world.id)).filter((i) => !i.refused)
        if (pending.length > 0) {
          try {
            const { results } = await api<{ results: SyncResult[] }>('/api/deliveries/sync', { body: { deliveries: pending.map((p) => p.payload) } })
            await dropFromOutbox(results.filter((r) => r.status !== 'refused').map((r) => r.id))
            for (const r of results) if (r.status === 'refused') await markRefused(r.id, r.message)
            const created = results.filter((r) => r.status === 'created')
            if (created.length && !stopped) setMessage({ tone: 'good', text: `Synced ${created.length} ${created.length === 1 ? 'delivery' : 'deliveries'}.` })
            poke()
          } catch {
            // Still offline as far as the server is concerned: everything stays in the outbox.
          }
        }
      }
      if (!stopped) setOutbox(await readOutbox(world.id))
    }
    syncNow.current = () => void sync()
    void sync()
    const id = setInterval(sync, 3000)
    return () => {
      stopped = true
      clearInterval(id)
    }
  }, [world, connected, poke])

  const orders = (board.data?.orders ?? []).filter((o) => o.status === 'OPEN')
  const [orderChoice, setOrderChoice] = React.useState<string>('')
  const order = orders.find((o) => o.id === orderChoice) ?? orders[0]

  const expected = (board.data?.expected ?? []).filter((e) => e.pledge.orderId === order?.id)
  const waiting = expected.filter((e) => e.pledge.status === 'PLEDGED' && !outbox.some((o) => o.payload.pledgeId === e.pledge.id))
  const localFarmers = (ref?.farmers ?? []).filter((f) => f.depotId === depot?.id)

  const [farmerChoice, setFarmerChoice] = React.useState('')
  const [bags, setBags] = React.useState('')
  const [grams, setGrams] = React.useState<number | null>(null)
  const [scaleMode, setScaleMode] = React.useState<'SCALE' | 'MANUAL'>('SCALE')
  const [moisture, setMoisture] = React.useState('12.8')
  const [grade, setGrade] = React.useState<Grade>('A')
  const [weighing, setWeighing] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [transporter, setTransporter] = React.useState('')

  const pledgeFor = (farmerId: string) => waiting.find((w) => w.pledge.farmerId === farmerId)
  const choose = (farmerId: string) => {
    setFarmerChoice(farmerId)
    const p = pledgeFor(farmerId)
    setBags(p ? String(p.pledge.bags) : '')
    setGrams(null)
  }

  const readScale = async () => {
    const n = Number(bags)
    if (!(n >= 1)) {
      setMessage({ tone: 'bad', text: 'Enter the number of bags first.' })
      return
    }
    setWeighing(true)
    setScaleMode('SCALE')
    const target = n * 50_000 - 600 + Math.round(Math.random() * 1800)
    const start = performance.now()
    for (;;) {
      const t = Math.min(1, (performance.now() - start) / 900)
      setGrams(Math.round(target * (1 - (1 - t) ** 3)))
      if (t >= 1) break
      await sleep(40)
    }
    setWeighing(false)
  }

  const save = async () => {
    if (!world || !depot || !order) return
    const farmer = localFarmers.find((f) => f.id === farmerChoice) ?? expected.find((e) => e.pledge.farmerId === farmerChoice)
    const bagCount = Number(bags)
    const m10 = Math.round(Number(moisture) * 10)
    if (!farmerChoice || !farmer) return setMessage({ tone: 'bad', text: 'Choose the farmer who is delivering.' })
    if (!(bagCount >= 1)) return setMessage({ tone: 'bad', text: 'Enter how many bags.' })
    if (!grams || grams < 1000) return setMessage({ tone: 'bad', text: 'Read the scale or type the weight.' })
    if (!(m10 >= 0 && m10 <= 400)) return setMessage({ tone: 'bad', text: 'Moisture must be a percentage, for example 12.8.' })
    setBusy(true)
    const id = uuid()
    const pledge = pledgeFor(farmerChoice)
    await saveToOutbox({
      id,
      worldId: world.id,
      depotId: depot.id,
      farmerName: 'name' in farmer ? farmer.name : farmer.farmerName,
      savedAt: new Date().toISOString(),
      payload: { id, orderId: order.id, depotId: depot.id, farmerId: farmerChoice, pledgeId: pledge?.pledge.id ?? null, bags: bagCount, netGrams: grams, moisture10: m10, grade, scaleMode, recordedAt: new Date().toISOString(), recordedOffline: !connected },
    })
    setOutbox(await readOutbox(world.id))
    setMessage({ tone: 'info', text: connected ? 'Saved. Sending now.' : 'Saved on this device. It will be sent when the signal returns.' })
    setFarmerChoice('')
    setBags('')
    setGrams(null)
    setBusy(false)
    syncNow.current()
  }

  const dispatch = async () => {
    if (!order || !depot || !transporter) return
    setBusy(true)
    try {
      const { consignment } = await api<{ consignment: { ref: string; depotGrams: number } }>('/api/consignments', { body: { orderId: order.id, depotId: depot.id, transporterId: transporter } })
      setMessage({ tone: 'good', text: `Truck ${consignment.ref} loaded with ${formatWeight(consignment.depotGrams)} and on its way.` })
      poke()
    } catch (e) {
      setMessage({ tone: 'bad', text: errorText(e) })
    } finally {
      setBusy(false)
    }
  }

  const received = (board.data?.received ?? []).filter((r) => r.delivery.orderId === order?.id)
  const readyToShip = received.filter((r) => r.delivery.status === 'RECEIVED')
  const pendingCount = outbox.filter((o) => !o.refused).length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="font-display text-5xl leading-none font-extrabold tracking-wide">Depot</h1>
          <p className="mt-3 text-ink-2">
            Where farmers hand over their bags. The clerk weighs and grades each delivery; farmers are paid for this weight. It keeps working without signal: deliveries are saved on
            the device and sent exactly once when the connection returns. Install it as an app from your browser menu to use it offline.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select aria-label="Depot" className={cx(inputClass, 'w-auto')} value={depot?.id ?? ''} onChange={(e) => setDepotId(e.target.value)}>
            {(ref?.depots ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} Depot
              </option>
            ))}
          </select>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-rule bg-sheet px-3 py-2 text-sm">
            <input type="checkbox" checked={simulateOffline} onChange={(e) => setSimulateOffline(e.target.checked)} className="h-4 w-4 accent-[var(--chili)]" />
            Pretend there’s no signal
          </label>
        </div>
      </div>

      <div className={cx('flex flex-wrap items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold', connected ? 'bg-leaf-wash text-leaf' : 'bg-chili-wash text-chili')} role="status">
        {connected ? <Wifi size={16} aria-hidden /> : <WifiOff size={16} aria-hidden />}
        {connected ? 'Online.' : 'No signal.'} {pendingCount > 0 ? `${pendingCount} ${pendingCount === 1 ? 'delivery' : 'deliveries'} waiting to send.` : 'Nothing waiting to send.'}
        {!browserOnline && <span className="font-normal">Your device is offline; the page still works.</span>}
      </div>

      {message && <Notice tone={message.tone === 'bad' ? 'bad' : message.tone === 'good' ? 'good' : 'info'}>{message.text}</Notice>}

      {!order ? (
        <Empty title={`No open orders at ${depot?.name ?? 'this'} Depot`}>
          Post one as a buyer (Buyer screen) and fund its escrow, or run the guided harvest. Farmers can only deliver against an open, funded order.
        </Empty>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <Panel title="Record a delivery" aside={orders.length > 1 ? (
            <select aria-label="Order" className={cx(inputClass, 'h-8 w-auto text-sm')} value={order.id} onChange={(e) => setOrderChoice(e.target.value)}>
              {orders.map((o) => <option key={o.id} value={o.id}>{o.ref}</option>)}
            </select>
          ) : <span className="text-sm text-ink-3">{order.ref}: {CROPS[order.crop].name.toLowerCase()}, grade {order.minGrade} or better, {formatKwacha(order.priceNgweePerKg)}/kg</span>}>
            <div className="space-y-4">
              <Field label="Farmer" htmlFor="farmer" hint={waiting.length ? `${waiting.length} pledged farmers still to deliver.` : 'Everyone who pledged has delivered; walk-ins are welcome while the order needs more.'}>
                <select id="farmer" className={inputClass} value={farmerChoice} onChange={(e) => choose(e.target.value)}>
                  <option value="">Choose…</option>
                  {waiting.length > 0 && (
                    <optgroup label="Pledged">
                      {waiting.map((w) => (
                        <option key={w.pledge.id} value={w.pledge.farmerId}>
                          {w.farmerName}, {w.pledge.bags} bags ({w.pledge.ref})
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="Registered at this depot">
                    {localFarmers
                      .filter((f) => !waiting.some((w) => w.pledge.farmerId === f.id))
                      .map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                  </optgroup>
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Bags" htmlFor="bags">
                  <input id="bags" inputMode="numeric" className={inputClass} value={bags} onChange={(e) => setBags(e.target.value.replace(/\D/g, ''))} placeholder="8" />
                </Field>
                <Field label="Grade" htmlFor="grade">
                  <select id="grade" className={inputClass} value={grade} onChange={(e) => setGrade(e.target.value as Grade)}>
                    <option value="A">A</option>
                    <option value="B">B</option>
                    <option value="C">C</option>
                  </select>
                </Field>
              </div>
              <div className="rounded-[12px] bg-led-bg px-3 pt-3 pb-2">
                <SevenSegment value={grams ? (grams / 1000).toFixed(1) : '----'} width={6} height={56} label={grams ? `Scale reads ${(grams / 1000).toFixed(1)} kilograms` : 'Scale idle'} className="w-full" />
                <div className="mt-1 flex justify-between text-xs text-led/70">
                  <span>{scaleMode === 'MANUAL' ? 'Typed by hand' : 'Platform scale'}</span>
                  <span>kg</span>
                </div>
              </div>
              <div className="grid grid-cols-[1fr_auto] items-end gap-3">
                <Field label="Weight (kg)" htmlFor="weight" hint="Read the scale, or type it if the scale is down (the receipt says so).">
                  <input
                    id="weight"
                    inputMode="decimal"
                    className={inputClass}
                    value={grams ? String(grams / 1000) : ''}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      setScaleMode('MANUAL')
                      setGrams(Number.isFinite(v) && v > 0 ? Math.round(v * 1000) : null)
                    }}
                    placeholder="400.2"
                  />
                </Field>
                <Button variant="secondary" onClick={() => void readScale()} busy={weighing}>
                  <Scale size={16} aria-hidden /> Read the scale
                </Button>
              </div>
              <div className="grid grid-cols-[1fr_auto] items-end gap-3">
                <Field label="Moisture (%)" htmlFor="moisture" hint={`Standard ${CROPS[order.crop].standardMoisture10 / 10}%. Wetter grain is paid on its dry weight; above ${CROPS[order.crop].maxMoisture10 / 10}% it’s refused.`}>
                  <input id="moisture" inputMode="decimal" className={inputClass} value={moisture} onChange={(e) => setMoisture(e.target.value)} />
                </Field>
                <Button variant="secondary" onClick={() => setMoisture((11.6 + Math.random() * 3).toFixed(1))}>
                  <Gauge size={16} aria-hidden /> Use the meter
                </Button>
              </div>
              <Button onClick={() => void save()} busy={busy} size="lg" className="w-full">
                Save delivery
              </Button>
            </div>
          </Panel>

          <div className="space-y-6">
            <Panel title="Waiting to send" aside={<CloudOff size={18} className="text-ink-3" aria-hidden />}>
              {outbox.length === 0 ? (
                <p className="text-sm text-ink-3">Nothing on this device. Every delivery has reached Agri-OS.</p>
              ) : (
                <ul className="divide-y divide-rule text-sm">
                  {outbox.map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-3 py-2">
                      <span>
                        {o.farmerName}, {formatWeight(Number(o.payload.netGrams))} <span className="text-ink-3">saved {catTime(o.savedAt, false)}</span>
                        {o.refused && <span className="block text-chili">Refused: {o.refused}</span>}
                      </span>
                      {o.refused ? (
                        <Button
                          size="sm"
                          variant="quiet"
                          onClick={async () => {
                            await dropFromOutbox([o.id])
                            setOutbox(await readOutbox(world!.id))
                          }}
                        >
                          Discard
                        </Button>
                      ) : (
                        <StatusPill status="QUEUED" label="Waiting" />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Received today">
              {received.length === 0 ? (
                <p className="text-sm text-ink-3">Deliveries appear here once they reach Agri-OS.</p>
              ) : (
                <ul className="divide-y divide-rule text-sm">
                  {received.map(({ delivery: d, farmerName }) => (
                    <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0">
                        <span className="font-semibold">{farmerName}</span> {d.bags} bags, {formatWeight(d.netGrams)}, grade {d.grade}, {(d.moisture10 / 10).toFixed(1)}%
                        <span className="block text-xs text-ink-3">
                          {d.ref} {d.status === 'REJECTED' ? d.rejectReason : `worth ${formatKwacha(d.amountNgwee)}`}
                          {d.recordedOffline ? ', recorded offline' : ''}
                          {d.scaleMode === 'MANUAL' ? ', weight typed by hand' : ''}
                        </span>
                      </span>
                      <StatusPill status={d.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Load a truck">
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Transporter" htmlFor="transporter">
                  <select id="transporter" className={inputClass} value={transporter} onChange={(e) => setTransporter(e.target.value)}>
                    <option value="">Choose…</option>
                    {(ref?.transporters ?? []).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}, {t.truckReg} ({t.capacityKg / 1000} t, K{(t.rateNgweePerTonneKm / 100).toFixed(2)}/t·km)
                      </option>
                    ))}
                  </select>
                </Field>
                <Button variant="leaf" onClick={() => void dispatch()} disabled={!transporter || readyToShip.length === 0 || !connected} busy={busy}>
                  <Truck size={16} aria-hidden /> Load {readyToShip.length ? `${formatWeight(readyToShip.reduce((a, r) => a + r.delivery.netGrams, 0))}` : 'the truck'}
                </Button>
              </div>
              {!connected && <p className="mt-2 text-xs text-ink-3">Loading a truck needs signal: the haulage contract is priced and recorded centrally.</p>}
            </Panel>
          </div>
        </div>
      )}
    </div>
  )
}
