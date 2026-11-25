import { formatKwacha } from '@/domain/money'
import { LANG_NAMES, shortDate, words, type Lang, type Words } from './i18n'

/**
 * USSD as a replay interpreter. Africa's Talking sends the whole input path on every request ("1*2*8*1"), so the
 * engine rebuilds the screen from scratch each time: no session state to lose. Navigation: 0 goes back, 00 goes home.
 * Side effects (register, pledge, share) happen only on a final confirmation and are idempotent per session.
 */
export interface Screen {
  type: 'CON' | 'END'
  text: string
}

/** Characters a USSD screen can show; longer screens are cut by the network. */
export const MAX_SCREEN = 182

export interface FarmerView {
  id: string
  name: string
  depotId: string | null
  depotName: string | null
}
export interface DepotView {
  id: string
  name: string
}
export interface OfferView {
  orderId: string
  crop: string
  minGrade: string
  priceNgweePerKg: number
  bagKg: number
  buyerName: string
  depotId: string
  depotName: string
  deliverBy: Date
  remainingBags: number
}
export interface PledgeView {
  ref: string
  crop: string
  bags: number
  status: 'PLEDGED' | 'DELIVERED' | 'CANCELLED' | 'EXPIRED'
}
export interface PaymentView {
  at: Date
  amountNgwee: number
  status: 'PAID' | 'SENDING' | 'RETRYING'
}
export interface RecordView {
  score: number
  band: 'BUILDING' | 'FAIR' | 'GOOD' | 'STRONG'
  salesCount: number
  yearAmountNgwee: number
  reliabilityPct: number | null
}

export interface UssdServices {
  serviceCode: string
  host: string
  farmer: FarmerView | null
  depots(): Promise<DepotView[]>
  offers(depotId: string): Promise<OfferView[]>
  pledges(): Promise<PledgeView[]>
  payments(): Promise<PaymentView[]>
  record(): Promise<RecordView>
  register(name: string, depotId: string, lang: Lang): Promise<FarmerView>
  pledge(offer: OfferView, bags: number): Promise<{ ok: true; ref: string } | { ok: false }>
  setLanguage(lang: Lang): Promise<void>
  share(): Promise<{ code: string }>
}

interface Ctx {
  lang: Lang
  w: Words
  s: UssdServices
}

type Transition = { go: Node } | { error: string } | { end: string } | { home: true; notice: string } | null

interface Node {
  render(ctx: Ctx): Promise<Screen> | Screen
  next?(ctx: Ctx, input: string): Promise<Transition> | Transition
}

const lines = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join('\n')
const con = (...parts: Array<string | false | null | undefined>): Screen => ({ type: 'CON', text: lines(...parts) })
/** USSD money: whole kwacha without decimals ("K310"), otherwise to the ngwee ("K6.20"). */
export const k = (ngwee: number) => (ngwee % 100 === 0 ? formatKwacha(ngwee, { decimals: false }) : formatKwacha(ngwee))
const short = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`)
const firstName = (name: string) => name.split(' ')[0]
const LANG_BY_KEY: Record<string, Lang> = { '1': 'en', '2': 'bem', '3': 'nya' }

function setLang(ctx: Ctx, lang: Lang) {
  ctx.lang = lang
  ctx.w = words(lang)
}

/** Keeps the first line and the last lines (the question and options); drops middle lines until the screen fits. */
export function fit(text: string, max = MAX_SCREEN): string {
  if (text.length <= max) return text
  const all = text.split('\n')
  const kept = [...all]
  while (kept.join('\n').length > max && kept.length > 2) kept.splice(1, 1)
  const joined = kept.join('\n')
  return joined.length <= max ? joined : `${joined.slice(0, max - 1)}…`
}

export function cleanName(input: string): string | null {
  const name = decodeURIComponent(input.replace(/\+/g, ' ')).replace(/\s+/g, ' ').trim()
  if (!/^[\p{L}][\p{L}' -]{1,39}$/u.test(name) || !/\p{L}{2}/u.test(name)) return null
  return name
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function languageFirst(): Node {
  return {
    render: () => con('Agri-OS', `1. ${LANG_NAMES.en}`, `2. ${LANG_NAMES.bem}`, `3. ${LANG_NAMES.nya}`),
    next: (ctx, input) => {
      const lang = LANG_BY_KEY[input]
      if (!lang) return null
      setLang(ctx, lang)
      return { go: welcome() }
    },
  }
}

function welcome(): Node {
  return {
    render: (ctx) => con('Agri-OS', ctx.w.welcomeNew, `1. ${ctx.w.register}`, ctx.w.back),
    next: (_ctx, input) => (input === '1' ? { go: enterName() } : null),
  }
}

function enterName(): Node {
  return {
    render: (ctx) => con(ctx.w.enterName, ctx.w.back),
    next: (ctx, input) => {
      const name = cleanName(input)
      return name ? { go: chooseDepot(name) } : { error: ctx.w.nameInvalid }
    },
  }
}

function chooseDepot(name: string): Node {
  return {
    render: async (ctx) => {
      const depots = (await ctx.s.depots()).slice(0, 8)
      return con(ctx.w.chooseDepot, ...depots.map((d, i) => `${i + 1}. ${d.name}`), ctx.w.back)
    },
    next: async (_ctx, input) => {
      if (!/^\d$/.test(input)) return null
      const depot = (await _ctx.s.depots()).slice(0, 8)[Number(input) - 1]
      return depot ? { go: confirmRegister(name, depot) } : null
    },
  }
}

function confirmRegister(name: string, depot: DepotView): Node {
  return {
    render: (ctx) => con(ctx.w.confirmRegister(name, depot.name), ctx.w.yes, ctx.w.no),
    next: async (ctx, input) => {
      if (input === '2') return { end: ctx.w.cancelled(ctx.s.serviceCode) }
      if (input !== '1') return null
      const farmer = await ctx.s.register(name, depot.id, ctx.lang)
      return { end: ctx.w.registered(firstName(farmer.name), ctx.s.serviceCode) }
    },
  }
}

function mainMenu(): Node {
  return {
    render: (ctx) =>
      con(`Agri-OS · ${firstName(ctx.s.farmer!.name)}`, `1. ${ctx.w.menuOffers}`, `2. ${ctx.w.menuPledges}`, `3. ${ctx.w.menuPayments}`, `4. ${ctx.w.menuRecord}`, `5. ${ctx.w.menuLanguage}`),
    next: (_ctx, input) => {
      switch (input) {
        case '1':
          return { go: offers(0) }
        case '2':
          return { go: pledgeList() }
        case '3':
          return { go: paymentList() }
        case '4':
          return { go: tradeRecord() }
        case '5':
          return { go: language() }
        default:
          return null
      }
    },
  }
}

const PAGE = 3

function offers(page: number): Node {
  const load = async (ctx: Ctx) => (ctx.s.farmer?.depotId ? ctx.s.offers(ctx.s.farmer.depotId) : [])
  return {
    render: async (ctx) => {
      const all = await load(ctx)
      const depotName = ctx.s.farmer?.depotName ?? ''
      if (all.length === 0) return con(ctx.w.noOffers(depotName), ctx.w.back)
      const items = all.slice(page * PAGE, page * PAGE + PAGE)
      return con(
        ctx.w.offersAt(depotName),
        ...items.map((o, i) => `${i + 1}. ${ctx.w.crop[o.crop] ?? o.crop} ${k(o.priceNgweePerKg)}/kg ${short(o.buyerName, 18)}`),
        all.length > (page + 1) * PAGE && ctx.w.more,
        ctx.w.back,
      )
    },
    next: async (ctx, input) => {
      const all = await load(ctx)
      if (input === '9') return all.length > (page + 1) * PAGE ? { go: offers(page + 1) } : null
      if (!/^[1-3]$/.test(input)) return null
      const offer = all[page * PAGE + Number(input) - 1]
      return offer ? { go: offerDetail(offer) } : null
    },
  }
}

function maxBags(offer: OfferView) {
  return Math.max(0, Math.min(offer.remainingBags, 200))
}

function offerDetail(offer: OfferView): Node {
  return {
    render: (ctx) => {
      const crop = ctx.w.crop[offer.crop] ?? offer.crop
      return con(
        `${crop} ${ctx.w.gradeOrBetter(offer.minGrade)}`,
        `${k(offer.priceNgweePerKg)}/kg = ${ctx.w.perBag(k(offer.priceNgweePerKg * offer.bagKg))}`,
        ctx.w.buyer(short(offer.buyerName, 22)),
        ctx.w.deliverTo(offer.depotName, shortDate(offer.deliverBy)),
        ctx.w.noFees,
        ctx.w.howManyBags(maxBags(offer)),
        ctx.w.back,
      )
    },
    next: (ctx, input) => {
      const bags = /^\d{1,3}$/.test(input) ? Number(input) : NaN
      if (!(bags >= 1 && bags <= maxBags(offer))) return { error: ctx.w.bagsInvalid(maxBags(offer)) }
      return { go: confirmPledge(offer, bags) }
    },
  }
}

function confirmPledge(offer: OfferView, bags: number): Node {
  return {
    render: (ctx) => {
      const bagPrice = offer.priceNgweePerKg * offer.bagKg
      return con(
        ctx.w.confirmPledge(bags, bags * offer.bagKg, ctx.w.crop[offer.crop] ?? offer.crop, k(bagPrice), k(bagPrice * bags), short(offer.buyerName, 22)),
        ctx.w.yes,
        ctx.w.no,
      )
    },
    next: async (ctx, input) => {
      if (input === '2') return { end: ctx.w.cancelled(ctx.s.serviceCode) }
      if (input !== '1') return null
      const result = await ctx.s.pledge(offer, bags)
      return { end: result.ok ? ctx.w.pledged(result.ref, bags, offer.depotName, shortDate(offer.deliverBy)) : ctx.w.offerClosed }
    },
  }
}

function pledgeList(): Node {
  return {
    render: async (ctx) => {
      const items = (await ctx.s.pledges()).slice(0, 4)
      if (items.length === 0) return con(ctx.w.pledgesTitle, ctx.w.noPledges, ctx.w.back)
      return con(ctx.w.pledgesTitle, ...items.map((p) => `${p.ref} ${ctx.w.crop[p.crop] ?? p.crop} ${p.bags} ${ctx.w.bags} - ${ctx.w.pledgeStatus[p.status]}`), ctx.w.back)
    },
  }
}

function paymentList(): Node {
  return {
    render: async (ctx) => {
      const items = (await ctx.s.payments()).slice(0, 4)
      if (items.length === 0) return con(ctx.w.paymentsTitle, ctx.w.noPayments, ctx.w.back)
      return con(ctx.w.paymentsTitle, ...items.map((p) => `${shortDate(p.at)} ${k(p.amountNgwee)} ${ctx.w.paymentStatus[p.status]}`), ctx.w.back)
    },
  }
}

function tradeRecord(): Node {
  return {
    render: async (ctx) => {
      const r = await ctx.s.record()
      return con(
        ctx.w.recordTitle(r.score, ctx.w.band[r.band]),
        ctx.w.recordSales(r.salesCount, k(r.yearAmountNgwee)),
        r.reliabilityPct !== null && ctx.w.recordReliability(r.reliabilityPct),
        ctx.w.shareWithLender,
        ctx.w.back,
      )
    },
    next: async (ctx, input) => {
      if (input !== '1') return null
      const { code } = await ctx.s.share()
      return { end: ctx.w.shared(code, ctx.s.host) }
    },
  }
}

function language(): Node {
  return {
    render: (ctx) => con(ctx.w.chooseLanguage, `1. ${LANG_NAMES.en}`, `2. ${LANG_NAMES.bem}`, `3. ${LANG_NAMES.nya}`, ctx.w.back),
    next: async (ctx, input) => {
      const lang = LANG_BY_KEY[input]
      if (!lang) return null
      await ctx.s.setLanguage(lang)
      setLang(ctx, lang)
      return { home: true, notice: ctx.w.languageSaved }
    },
  }
}

/** Replays the inputs from the first screen and returns the screen to show now. */
export async function runUssd(services: UssdServices, inputs: string[], initialLang: Lang): Promise<Screen> {
  const ctx: Ctx = { lang: initialLang, w: words(initialLang), s: services }
  const stack: Node[] = [services.farmer ? mainMenu() : languageFirst()]
  let notice: string | null = null
  for (const raw of inputs) {
    const input = raw.trim()
    notice = null
    if (input === '00') {
      stack.length = 1
      continue
    }
    if (input === '0' && stack.length > 1) {
      stack.pop()
      continue
    }
    const top = stack[stack.length - 1]
    const t = top.next ? await top.next(ctx, input) : null
    if (!t) {
      notice = ctx.w.invalid
      continue
    }
    if ('end' in t) return { type: 'END', text: fit(t.end) }
    if ('error' in t) {
      notice = t.error
      continue
    }
    if ('home' in t) {
      stack.length = 1
      notice = t.notice
      continue
    }
    stack.push(t.go)
  }
  const screen = await stack[stack.length - 1].render(ctx)
  return { type: screen.type, text: fit(notice ? `${notice}\n${screen.text}` : screen.text) }
}

/** The response body Africa's Talking expects. */
export function toAfricasTalking(screen: Screen): string {
  return `${screen.type} ${screen.text}`
}
