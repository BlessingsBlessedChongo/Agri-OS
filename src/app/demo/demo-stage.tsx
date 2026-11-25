'use client'

import * as React from 'react'
import { CheckCircle2, CircleDot, Pause, Play, RotateCcw, SkipForward, Wifi, WifiOff } from 'lucide-react'
import { formatKwacha } from '@/domain/money'
import { formatWeight } from '@/domain/produce'
import { api, errorText, sleep, uuid } from '@/lib/api'
import type { OrderDetail, Reference, ResilienceData, ZraData } from '@/lib/types'
import { useApi, useWorld } from '@/lib/world'
import { EventFeed } from '@/ui/event-feed'
import { FeaturePhone, type PhoneHandle } from '@/ui/feature-phone'
import { Button, cx, Money, Notice, Progress, StatusPill } from '@/ui/kit'
import { SevenSegment } from '@/ui/seven-segment'
import { ZambiaMap } from '@/ui/zambia-map'

interface Signed {
  reading: { deviceId: string; consignmentId: string; kind: 'GROSS' | 'TARE'; grams: number; readAt: string; nonce: string }
  signature: string
}

interface Step {
  title: string
  body: string
}

const STEPS: Step[] = [
  { title: 'A miller posts demand', body: 'Kafue Plains Milling needs 6 tonnes of maize, grade B or better, at K6.20 a kilo, collected at Chipata Depot within five days.' },
  { title: 'Escrow comes first', body: 'Before any farmer is asked to deliver, the money must exist. Agri-OS asks the buyer’s Zamtel Money wallet for escrow; the buyer approves with a PIN on their phone.' },
  { title: 'Mary dials in', body: 'Mary Banda farms near Chipata. Her phone has no internet. She dials *384*123#, reads the offer and pledges 8 bags. No app, no data bundle, no fee.' },
  { title: 'Her neighbours pledge too', body: 'Seven other farmers registered at Chipata go through the same USSD menus. Each one gets an SMS with a pledge reference.' },
  { title: 'Weighed at the depot', body: 'The clerk weighs Mary’s bags and checks moisture. Farmers are paid on this weight. Mary gets a receipt by SMS on the spot.' },
  { title: 'The signal drops', body: 'Rural depots lose signal. The depot app keeps working: deliveries are saved on the device and each one is sent exactly once when the signal returns. One load is turned away for being grade C.' },
  { title: 'On the road', body: 'Luangwa Haulage loads everything the depot received and drives it to the mill in Kafue. Haulage is priced per tonne-kilometre.' },
  { title: 'The weighbridge decides', body: 'The truck is weighed loaded, then empty. Each reading is signed by the weighbridge itself, so nobody can type a weight in. A loss beyond 0.5% would come out of the haulage fee, not the farmers’ pay.' },
  { title: 'Everyone is paid at once', body: 'One balanced ledger entry, then a payout to every farmer, the haulier and ZRA through Zamtel Money, and an invoice for every sale, issued by the buyer on each farmer’s behalf.' },
  { title: 'Unused escrow goes back', body: 'The buyer closes the order. Whatever escrow wasn’t needed returns to their wallet through the same payout machinery.' },
  { title: 'Check the books', body: 'Agri-OS reconciles its ledger with Zamtel Money’s statement, transaction by transaction, and re-verifies every hash in the audit trail.' },
]

type Status = 'idle' | 'running' | 'paused' | 'done' | 'error'

async function waitFor<T>(check: () => Promise<T | null | undefined | false>, poke: () => void, timeoutMs = 120_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error('This is taking longer than expected. The network may be set to a storm: try Continue.')
    poke()
    await sleep(800)
  }
}

export function DemoStage() {
  const { world, seq, feed, poke, reset } = useWorld()
  const { data: ref } = useApi<Reference>(world ? '/api/reference' : null, world ? 1 : 0)
  const phone = React.useRef<PhoneHandle>(null)
  const [step, setStep] = React.useState(-1)
  const [status, setStatus] = React.useState<Status>('idle')
  const [error, setError] = React.useState<string | null>(null)
  const [orderId, setOrderId] = React.useState<string | null>(null)
  const [prompt, setPrompt] = React.useState<{ message: string; pin: string } | null>(null)
  const [scale, setScale] = React.useState<{ grams: number; who: string } | null>(null)
  const [offline, setOffline] = React.useState(false)
  const [outbox, setOutbox] = React.useState(0)
  const [bridge, setBridge] = React.useState<{ grams: number; kind: 'GROSS' | 'TARE' | 'NET' } | null>(null)
  const [books, setBooks] = React.useState<{ reconciliation: string; events: number; chainOk: boolean } | null>(null)
  const [network, setNetwork] = React.useState<'calm' | 'rough' | 'storm'>('calm')
  const pauseRequested = React.useRef(false)
  const consignmentRef = React.useRef<string | null>(null)
  // The script runs across a sandbox reset, so it reads the current sandbox from a ref, not from a stale render.
  const worldRef = React.useRef(world)
  React.useEffect(() => {
    worldRef.current = world
  }, [world])

  const order = useApi<OrderDetail>(orderId ? `/api/orders/${orderId}` : null, seq)
  const zraVersion = feed.filter((e) => e.type === 'invoice.accepted' || e.type === 'settlement.completed').length
  const zra = useApi<ZraData>(world ? '/api/zra' : null, zraVersion)

  const depot = ref?.depots.find((d) => d.code === 'DEP-CHP')
  const buyer = ref?.buyers.find((b) => b.code === 'BUY-KPM')
  const truck = ref?.transporters.find((t) => t.code === 'TRN-LUA')
  const mary = world?.guide ?? null
  const ready = Boolean(world && depot && buyer && truck && mary)

  const animate = async (from: number, to: number, set: (v: number) => void, ms = 1100) => {
    const start = performance.now()
    for (;;) {
      const t = Math.min(1, (performance.now() - start) / ms)
      const eased = 1 - (1 - t) ** 3
      set(Math.round(from + (to - from) * eased))
      if (t >= 1) return
      await sleep(40)
    }
  }

  const runStep = async (i: number, ctx: { orderId: string | null }) => {
    const world = worldRef.current
    const mary = world?.guide ?? null
    if (!world || !depot || !buyer || !truck || !mary) throw new Error('The sandbox is still loading')
    const id = () => {
      if (!ctx.orderId) throw new Error('Start from the first step')
      return ctx.orderId
    }
    switch (i) {
      case 0: {
        const deliverBy = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString()
        const { order: created } = await api<{ order: { id: string } }>('/api/orders', {
          body: { buyerId: buyer.id, crop: 'MAIZE', minGrade: 'B', quantityKg: 6000, priceNgweePerKg: 620, depotIds: [depot.id], deliverBy },
        })
        ctx.orderId = created.id
        setOrderId(created.id)
        await sleep(600)
        return
      }
      case 1: {
        await api(`/api/orders/${id()}/fund`, { method: 'POST' })
        const p = await waitFor(
          async () => (await api<{ prompts: Array<{ id: string; message: string }> }>(`/api/sim/zamtel/${world.id}/v1/customer/prompts?msisdn=${encodeURIComponent(buyer.phone)}`)).prompts[0],
          poke,
        )
        setPrompt({ message: p.message, pin: '' })
        await sleep(900)
        for (let k = 0; k < 4; k++) {
          await sleep(260)
          setPrompt((cur) => (cur ? { ...cur, pin: `${cur.pin}•` } : cur))
        }
        await sleep(400)
        await api(`/api/sim/zamtel/${world.id}/v1/customer/prompts/${p.id}/approve`, { body: { pin: '2580' } })
        setPrompt(null)
        await waitFor(async () => (await api<OrderDetail>(`/api/orders/${id()}`)).order.status === 'OPEN', poke)
        return
      }
      case 2: {
        const h = phone.current!
        await h.dial()
        await sleep(1300)
        await h.send('1')
        await sleep(1400)
        await h.send('1')
        await sleep(2200)
        await h.send('8')
        await sleep(2000)
        await h.send('1')
        await sleep(2200)
        return
      }
      case 3: {
        await api('/api/demo/crowd', { body: { orderId: id(), depotId: depot.id, count: 7, exclude: [mary.phone] } })
        await sleep(1200)
        return
      }
      case 4: {
        const d = await api<OrderDetail>(`/api/orders/${id()}`)
        const pledge = d.pledges.find((p) => p.farmerId === mary.id)
        if (!pledge) throw new Error('Mary’s pledge is missing')
        const grams = pledge.bags * 50_000 + 180
        setScale({ grams: 0, who: mary.name })
        await animate(0, grams, (g) => setScale({ grams: g, who: mary.name }))
        await api('/api/deliveries/sync', {
          body: { deliveries: [{ id: uuid(), orderId: id(), depotId: depot.id, farmerId: mary.id, pledgeId: pledge.id, bags: pledge.bags, netGrams: grams, moisture10: 128, grade: 'A', scaleMode: 'SCALE', recordedAt: new Date().toISOString(), recordedOffline: false }] },
        })
        await sleep(1800)
        return
      }
      case 5: {
        const d = await api<OrderDetail>(`/api/orders/${id()}`)
        const names = new Map(ref!.farmers.map((f) => [f.id, f.name]))
        const others = d.pledges.filter((p) => p.farmerId !== mary.id && p.status === 'PLEDGED')
        setOffline(true)
        await sleep(700)
        const queued: unknown[] = []
        for (const [n, p] of others.entries()) {
          const grams = p.bags * 50_000 - 400 + Math.round(Math.random() * 1600)
          const who = names.get(p.farmerId) ?? 'Farmer'
          setScale({ grams: 0, who })
          await animate(0, grams, (g) => setScale({ grams: g, who }), 520)
          queued.push({
            id: uuid(),
            orderId: id(),
            depotId: depot.id,
            farmerId: p.farmerId,
            pledgeId: p.id,
            bags: p.bags,
            netGrams: grams,
            moisture10: 118 + Math.round(Math.random() * 22),
            grade: n === 3 ? 'C' : n % 3 === 0 ? 'B' : 'A',
            scaleMode: 'SCALE',
            recordedAt: new Date().toISOString(),
            recordedOffline: true,
          })
          setOutbox(queued.length)
          await sleep(250)
        }
        await sleep(1600)
        setOffline(false)
        await sleep(500)
        if (queued.length) await api('/api/deliveries/sync', { body: { deliveries: queued } })
        setOutbox(0)
        setScale(null)
        await sleep(1200)
        return
      }
      case 6: {
        const { consignment } = await api<{ consignment: { id: string } }>('/api/consignments', { body: { orderId: id(), depotId: depot.id, transporterId: truck.id } })
        consignmentRef.current = consignment.id
        await sleep(1600)
        return
      }
      case 7: {
        const consignmentId = consignmentRef.current ?? (await api<OrderDetail>(`/api/orders/${id()}`)).consignments[0]?.id
        if (!consignmentId) throw new Error('No truck to weigh')
        const gross = await api<Signed>('/api/sim/weighbridge', { body: { consignmentId, kind: 'GROSS' } })
        await animate(0, gross.reading.grams, (g) => setBridge({ grams: g, kind: 'GROSS' }), 1400)
        await api('/api/weighbridge/readings', { body: gross })
        await sleep(1500)
        const tare = await api<Signed>('/api/sim/weighbridge', { body: { consignmentId, kind: 'TARE' } })
        await animate(gross.reading.grams, tare.reading.grams, (g) => setBridge({ grams: g, kind: 'TARE' }), 1400)
        await api('/api/weighbridge/readings', { body: tare })
        await sleep(900)
        setBridge({ grams: gross.reading.grams - tare.reading.grams, kind: 'NET' })
        await sleep(1200)
        return
      }
      case 8: {
        await waitFor(async () => {
          const d = await api<OrderDetail>(`/api/orders/${id()}`)
          return d.payouts.length > 0 && d.payouts.every((p) => p.status === 'SUCCEEDED' || p.status === 'FAILED')
        }, poke, 240_000)
        phone.current?.showInbox()
        await sleep(1800)
        return
      }
      case 9: {
        await api(`/api/orders/${id()}/close`, { method: 'POST' })
        await waitFor(async () => {
          const d = await api<OrderDetail>(`/api/orders/${id()}`)
          const refund = d.payouts.find((p) => p.kind === 'REFUND')
          return d.order.status === 'COMPLETED' && (!refund || refund.status === 'SUCCEEDED' || refund.status === 'FAILED')
        }, poke, 240_000)
        return
      }
      case 10: {
        await waitFor(async () => {
          const r = await api<ResilienceData>('/api/resilience')
          return r.reconciliation.status === 'BALANCED' ? r : null
        }, poke, 120_000)
        const verify = await api<{ ok: boolean; checked: number }>('/api/audit/verify')
        setBooks({ reconciliation: 'BALANCED', events: verify.checked, chainOk: verify.ok })
        return
      }
    }
  }

  const ctxRef = React.useRef<{ orderId: string | null }>({ orderId: null })

  const play = async (single: boolean) => {
    setError(null)
    setStatus('running')
    pauseRequested.current = false
    try {
      let i = step + 1
      while (i < STEPS.length) {
        setStep(i)
        await runStep(i, ctxRef.current)
        i++
        if (single || pauseRequested.current) break
        await sleep(700)
      }
      setStatus(i >= STEPS.length ? 'done' : 'paused')
    } catch (e) {
      setError(errorText(e))
      setStatus('error')
    }
  }

  const start = async () => {
    if (seq > 1 && step === -1) {
      if (!window.confirm('This sandbox already has activity. Run the harvest in a fresh one?')) return
      worldRef.current = await reset()
    }
    void play(false)
  }

  const startOver = async () => {
    pauseRequested.current = true
    worldRef.current = await reset()
    ctxRef.current = { orderId: null }
    consignmentRef.current = null
    setOrderId(null)
    setStep(-1)
    setStatus('idle')
    setError(null)
    setPrompt(null)
    setScale(null)
    setBridge(null)
    setOffline(false)
    setOutbox(0)
    setBooks(null)
    setNetwork('calm')
    phone.current?.hangUp()
  }

  const setChaos = async (preset: 'calm' | 'rough' | 'storm') => {
    setNetwork(preset)
    await api('/api/chaos', { method: 'PUT', body: { preset } })
  }

  const o = order.data
  const live = zra.data?.overview.live
  const pulse = zra.data ? zra.data.overview.byDistrict.filter((d) => d.live > 0).map((d) => d.districtId) : []
  const receipts = o ? o.deliveries.slice(0, 4) : []
  const paid = o ? o.payouts.filter((p) => p.status === 'SUCCEEDED').length : 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="font-display text-5xl leading-none font-extrabold tracking-wide">Run a harvest</h1>
          <p className="mt-3 text-ink-2">
            One truck of maize, from a pledge on a basic phone to tax invoices accepted by the VSDC. Every step is the real system answering real API calls in your own sandbox; nothing
            here is animation over fake data.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-ink-2">
            Network
            <select
              value={network}
              onChange={(e) => void setChaos(e.target.value as 'calm' | 'rough' | 'storm')}
              className="h-10 rounded-md border border-rule bg-sheet px-2 text-ink"
              disabled={!world}
            >
              <option value="calm">Calm</option>
              <option value="rough">Bad network day</option>
              <option value="storm">Storm</option>
            </select>
          </label>
          {status === 'running' ? (
            <Button
              variant="secondary"
              onClick={() => {
                pauseRequested.current = true
              }}
            >
              <Pause size={16} aria-hidden /> Pause after this step
            </Button>
          ) : status === 'done' ? (
            <Button onClick={() => void startOver()}>
              <RotateCcw size={16} aria-hidden /> Run it again
            </Button>
          ) : (
            <>
              <Button onClick={() => void (step === -1 ? start() : play(false))} disabled={!ready} size="lg">
                <Play size={18} aria-hidden /> {step === -1 ? 'Run the harvest' : 'Continue'}
              </Button>
              <Button variant="secondary" onClick={() => void play(true)} disabled={!ready || step === -1}>
                <SkipForward size={16} aria-hidden /> Next step
              </Button>
            </>
          )}
          {step >= 0 && status !== 'running' && (
            <Button variant="quiet" onClick={() => void startOver()}>
              Start over
            </Button>
          )}
        </div>
      </div>

      {network !== 'calm' && (
        <Notice tone="wait">
          {network === 'storm' ? 'Storm: about a third of payment requests fail, time out or lose their confirmation.' : 'Bad network day: slow answers, some refusals, duplicated and lost confirmations.'}{' '}
          Watch the feed: Agri-OS retries safely and asks the provider when it isn’t sure. It may take longer; it won’t pay anyone twice.
        </Notice>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {/* Farmer */}
        <Pane title="Farmer" where="Mary’s basic phone" active={step === 2 || step === 8}>
          {mary ? <FeaturePhone ref={phone} phone={mary.phone} owner={mary.name} seq={seq} className="mx-auto" /> : <div className="h-[520px]" />}
        </Pane>

        {/* Depot */}
        <Pane title="Depot" where="Chipata Depot scale" active={step === 4 || step === 5}>
          <div className="space-y-4">
            <div className={cx('flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-semibold', offline ? 'bg-chili-wash text-chili' : 'bg-leaf-wash text-leaf')}>
              {offline ? <WifiOff size={16} aria-hidden /> : <Wifi size={16} aria-hidden />}
              {offline ? `No signal: ${outbox} saved on this device` : 'Online: deliveries sync as they’re recorded'}
            </div>
            <div className="rounded-[12px] bg-led-bg px-3 pt-3 pb-2">
              <SevenSegment value={scale ? (scale.grams / 1000).toFixed(1) : '----'} width={6} height={52} label={scale ? `Scale reads ${(scale.grams / 1000).toFixed(1)} kilograms` : 'Scale idle'} className="w-full" />
              <div className="mt-1 flex justify-between text-xs text-led/70">
                <span>{scale?.who ?? 'Waiting'}</span>
                <span>kg</span>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-ink-3">Pledged here</dt>
                <dd className="font-display text-2xl font-bold tabular">{o ? o.pledges.length : 0}</dd>
              </div>
              <div>
                <dt className="text-ink-3">Received</dt>
                <dd className="font-display text-2xl font-bold tabular">{o ? formatWeight(o.progress.deliveredGrams) : '0 kg'}</dd>
              </div>
            </dl>
            <ul className="space-y-1.5 text-sm">
              {receipts.length === 0 && <li className="text-ink-3">Receipts appear here as bags are weighed.</li>}
              {receipts.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    {ref?.farmers.find((f) => f.id === d.farmerId)?.name ?? d.ref} <span className="text-ink-3">{formatWeight(d.netGrams)}</span>
                  </span>
                  <StatusPill status={d.status} />
                </li>
              ))}
            </ul>
          </div>
        </Pane>

        {/* Buyer */}
        <Pane title="Buyer" where="Kafue Plains Milling" active={step === 0 || step === 1 || step === 6 || step === 7 || step === 9}>
          <div className="space-y-4">
            {o ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{o.order.ref}: 6 t maize at K6.20/kg</span>
                  <StatusPill status={o.order.status} />
                </div>
                {o.order.status === 'COMPLETED' ? (
                  <p className="text-sm text-ink-2">
                    Escrow closed:{' '}
                    {o.payouts.find((p) => p.kind === 'REFUND') ? `${formatKwacha(o.payouts.find((p) => p.kind === 'REFUND')!.amountNgwee)} returned to the buyer.` : 'all of it used.'}
                  </p>
                ) : (
                  <Progress value={o.escrow.fundedNgwee} max={o.escrow.targetNgwee} label={`Escrow ${formatKwacha(o.escrow.fundedNgwee)} of ${formatKwacha(o.escrow.targetNgwee)}`} tone="sky" />
                )}
              </>
            ) : (
              <p className="text-sm text-ink-3">No order yet.</p>
            )}
            {prompt && (
              <div className="rounded-[14px] border border-rule bg-sheet-2 p-3 shadow-md" role="alert">
                <div className="text-xs text-ink-3">Payment request on the buyer’s phone</div>
                <p className="mt-1 text-sm font-semibold">{prompt.message}</p>
                <div className="mt-2 flex items-center gap-2 text-sm">
                  Enter PIN <span className="min-w-16 rounded border border-rule bg-sheet px-2 py-0.5 tracking-[0.3em]">{prompt.pin || ' '}</span>
                </div>
              </div>
            )}
            <div className="rounded-[12px] bg-led-bg px-3 pt-3 pb-2">
              <SevenSegment value={bridge ? String(Math.round(bridge.grams / 1000)) : '-----'} width={6} height={52} label={bridge ? `Weighbridge reads ${Math.round(bridge.grams / 1000)} kilograms` : 'Weighbridge idle'} className="w-full" />
              <div className="mt-1 flex justify-between text-xs text-led/70">
                <span>{bridge ? (bridge.kind === 'GROSS' ? 'Loaded truck' : bridge.kind === 'TARE' ? 'Empty truck' : 'Net load') : 'Weighbridge'}</span>
                <span>kg · signed</span>
              </div>
            </div>
            {o && o.consignments[0] && (
              <div className="flex items-center justify-between gap-2 text-sm">
                <span>
                  Truck {o.consignments[0].truckReg}, {formatWeight(o.consignments[0].depotGrams)}
                </span>
                <StatusPill status={o.consignments[0].status} />
              </div>
            )}
            {o && o.payouts.length > 0 && <Progress value={paid} max={o.payouts.length} label={`Payouts ${paid} of ${o.payouts.length}`} />}
          </div>
        </Pane>

        {/* ZRA */}
        <Pane title="ZRA" where="Tax authority view" active={step === 8 || step === 10}>
          <div className="space-y-3">
            {zra.data ? <ZambiaMap compact data={zra.data.overview.byDistrict} pulse={pulse} caption="Produce traded per district, with live trades from your sandbox" /> : <div className="aspect-[1000/860] rounded-md bg-sheet-2" />}
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-ink-3">Invoices from your sandbox</dt>
                <dd className="font-display text-2xl font-bold tabular">{live?.invoices ?? 0}</dd>
              </div>
              <div>
                <dt className="text-ink-3">Paid to ZRA</dt>
                <dd className="font-display text-2xl font-bold">
                  <Money ngwee={live?.taxToZraNgwee ?? 0} />
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-ink-3">Trade made visible</dt>
                <dd className="font-display text-2xl font-bold">
                  <Money ngwee={live?.produceValueNgwee ?? 0} />
                </dd>
              </div>
            </dl>
          </div>
        </Pane>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <section aria-labelledby="steps" className="rounded-[10px] border border-rule bg-sheet p-4">
          <h2 id="steps" className="font-display text-2xl font-bold tracking-wide">
            The harvest, step by step
          </h2>
          {error && (
            <Notice tone="bad" className="mt-3">
              {error}
            </Notice>
          )}
          {books && (
            <Notice tone="good" className="mt-3">
              Reconciled with Zamtel Money’s statement: balanced to the ngwee. Audit trail: {books.events} events, every hash {books.chainOk ? 'verified' : 'NOT verified'}.
            </Notice>
          )}
          <ol className="mt-3 space-y-1">
            {STEPS.map((s, i) => {
              const state = i < step || (i === step && status === 'done') ? 'done' : i === step ? 'now' : 'later'
              return (
                <li key={s.title} className={cx('rounded-md px-3 py-2', state === 'now' && 'bg-maize-wash')}>
                  <div className="flex items-center gap-2">
                    {state === 'done' ? (
                      <CheckCircle2 size={18} className="shrink-0 text-leaf" aria-label="Done" />
                    ) : (
                      <CircleDot size={18} className={cx('shrink-0', state === 'now' ? 'text-ink' : 'text-ink-3')} aria-label={state === 'now' ? 'In progress' : 'Not started'} />
                    )}
                    <span className={cx('font-semibold', state === 'later' && 'text-ink-3')}>
                      {i + 1}. {s.title}
                    </span>
                  </div>
                  {(state === 'now' || (step === -1 && i === 0)) && <p className="mt-1 pl-[26px] text-sm text-ink-2">{s.body}</p>}
                </li>
              )
            })}
          </ol>
        </section>
        <section aria-labelledby="feed" className="rounded-[10px] border border-rule bg-sheet p-4">
          <h2 id="feed" className="font-display text-2xl font-bold tracking-wide">
            What the system recorded
          </h2>
          <p className="mb-3 text-sm text-ink-3">The audit trail, live. Each line is a hash-chained event.</p>
          <EventFeed events={feed} limit={18} empty="Events appear here as the harvest runs." />
        </section>
      </div>
    </div>
  )
}

function Pane({ title, where, active, children }: { title: string; where: string; active: boolean; children: React.ReactNode }) {
  return (
    <section className={cx('rounded-[14px] border bg-sheet p-4 transition-colors', active ? 'border-maize shadow-[0_0_0_3px_var(--maize-wash)]' : 'border-rule')} aria-label={`${title}: ${where}`}>
      <header className="mb-3">
        <h2 className="font-display text-2xl leading-none font-bold tracking-wide">{title}</h2>
        <p className="text-sm text-ink-3">{where}</p>
      </header>
      {children}
    </section>
  )
}
