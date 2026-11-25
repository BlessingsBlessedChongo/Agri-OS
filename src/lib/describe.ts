import { formatKwacha } from '@/domain/money'
import { formatWeight } from '@/domain/produce'
import type { FeedEvent } from './types'

/** Who an event is about, for colouring the feed by actor. */
export type Tone = 'farmer' | 'depot' | 'buyer' | 'money' | 'tax' | 'risk' | 'system'

const n = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0))
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v))
const k = (v: unknown) => formatKwacha(n(v))
const kg = (v: unknown) => formatWeight(n(v))
const crop = (v: unknown) => s(v).toLowerCase()

/** One plain sentence per audit event. */
export function describe(e: FeedEvent): { text: string; tone: Tone } {
  const p = e.payload
  switch (e.type) {
    case 'world.created':
      return { text: 'Your private sandbox was created.', tone: 'system' }
    case 'order.created':
      return { text: `${s(p.buyer)} posted demand for ${n(p.quantityKg).toLocaleString('en')} kg of ${crop(p.crop)} at ${k(p.priceNgweePerKg)}/kg (${s(p.ref)}).`, tone: 'buyer' }
    case 'escrow.requested':
      return { text: `Agri-OS asked the buyer's Zamtel Money wallet for ${k(p.amountNgwee)} of escrow.`, tone: 'money' }
    case 'escrow.funded':
      return { text: `${k(p.amountNgwee)} arrived in escrow for ${s(p.ref)}${p.source === 'poll' ? ' (confirmed by asking the provider)' : ''}.`, tone: 'money' }
    case 'escrow.failed':
      return { text: `The escrow payment for ${s(p.ref)} failed: ${s(p.reason)}.`, tone: 'risk' }
    case 'order.opened':
      return { text: `${s(p.ref)} is fully funded and open to farmers.`, tone: 'buyer' }
    case 'farmer.registered':
      return { text: `${s(p.name)} registered from their phone at ${s(p.depot)} Depot.`, tone: 'farmer' }
    case 'pledge.created':
      return { text: `${s(p.farmer)} pledged ${n(p.bags)} bags at ${s(p.depot)} Depot${p.channel === 'USSD' ? ' by USSD' : ''}.`, tone: 'farmer' }
    case 'delivery.received':
      return {
        text: `${s(p.depot)} Depot weighed ${s(p.farmer)}'s ${n(p.bags)} bags: ${kg(p.netGrams)}, grade ${s(p.grade)}, worth ${k(p.amountNgwee)}${p.recordedOffline ? `. Recorded offline, synced ${n(p.syncedAfterSeconds)} s later` : ''}.`,
        tone: 'depot',
      }
    case 'delivery.rejected':
      return { text: `${s(p.depot)} Depot turned away ${s(p.farmer)}'s delivery: ${s(p.reason)}.`, tone: 'risk' }
    case 'consignment.dispatched':
      return { text: `Truck ${s(p.truck)} left ${s(p.depot)} Depot with ${kg(p.depotGrams)} from ${n(p.deliveries)} deliveries (${n(p.distanceKm)} km).`, tone: 'depot' }
    case 'weighbridge.read':
      return { text: `Weighbridge reading for ${s(p.ref)}: ${p.kind === 'GROSS' ? 'loaded' : 'empty'} truck ${kg(p.grams)}, signed by the device.`, tone: 'buyer' }
    case 'consignment.weighed':
      return { text: `${s(p.ref)}: ${s(p.summary)}${p.withinTolerance ? ', within the 0.5% allowance' : ', more missing than the 0.5% allowance'}.`, tone: p.withinTolerance ? 'buyer' : 'risk' }
    case 'consignment.held':
      return { text: `${s(p.ref)} is waiting: escrow is short by ${k(p.shortNgwee)}.`, tone: 'risk' }
    case 'settlement.completed':
      return { text: `${s(p.ref)} settled: ${n(p.farmers)} farmers owed ${k(p.produceNgwee)}, haulage ${k(p.transportNgwee)}, ZRA ${k(p.taxToZraNgwee)}.`, tone: 'money' }
    case 'payout.sent':
      return { text: `Sending ${k(p.amountNgwee)} to ${s(p.party)}${n(p.attempt) > 1 ? ` (attempt ${n(p.attempt)})` : ''}.`, tone: 'money' }
    case 'payout.unknown':
      return { text: `No answer about ${s(p.party)}'s ${k(p.amountNgwee)}. Checking with the provider instead of guessing.`, tone: 'system' }
    case 'payout.retrying':
      return { text: p.manual ? `Trying ${s(p.party)}'s payment again by hand.` : `${s(p.party)}'s payment failed (${s(p.reason)}). Trying again with a new key.`, tone: 'risk' }
    case 'payout.succeeded':
      return { text: `${k(p.amountNgwee)} reached ${s(p.party)}${p.source === 'poll' ? ' (confirmation was lost; found by asking)' : ''}.`, tone: 'money' }
    case 'payout.failed':
      return { text: `${s(p.party)}'s payment gave up after ${n(p.attempts)} attempts. The money is safe in escrow.`, tone: 'risk' }
    case 'invoice.accepted':
      return { text: `Invoice ${s(p.number)} accepted by the VSDC, receipt ${n(p.receiptNo)}${n(p.attempts) > 1 ? ` after ${n(p.attempts)} tries` : ''}.`, tone: 'tax' }
    case 'invoice.rejected':
      return { text: `Invoice ${s(p.number)} was rejected: ${s(p.message)}.`, tone: 'risk' }
    case 'risk.flagged':
      return { text: `Flag: ${s(p.title)}.`, tone: 'risk' }
    case 'chaos.changed':
      return { text: 'Network conditions for this sandbox changed.', tone: 'system' }
    case 'tax.rule_changed':
      return { text: `Tax rule ${s(p.code)} set to ${n(p.rateBp) / 100}%${p.enabled ? '' : ' (off)'}.`, tone: 'tax' }
    case 'credit.shared':
      return { text: 'A farmer shared their trade record with a lender.', tone: 'farmer' }
    case 'order.closed':
      return { text: `${s(p.ref)} closed to new pledges.`, tone: 'buyer' }
    case 'order.completed':
      return { text: `${s(p.ref)} is complete${n(p.refundNgwee) > 0 ? `; ${k(p.refundNgwee)} of unused escrow is going back to the buyer` : ''}.`, tone: 'buyer' }
    default:
      return { text: e.type, tone: 'system' }
  }
}

export const TONE_COLOR: Record<Tone, string> = {
  farmer: 'var(--leaf)',
  depot: 'var(--maize)',
  buyer: 'var(--sky)',
  money: 'var(--leaf-2)',
  tax: 'var(--ink-2)',
  risk: 'var(--chili)',
  system: 'var(--ink-3)',
}

export function timeAgo(iso: string, now: number | null): string {
  if (now === null) return ''
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (seconds < 45) return 'just now'
  if (seconds < 90) return 'a minute ago'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.round(hours / 24)} days ago`
}

/** "25 Nov, 14:03" in Zambian time, the same on server and browser. */
export function catTime(iso: string, withDate = true): string {
  const d = new Date(new Date(iso).getTime() + 2 * 3600 * 1000)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const hm = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
  return withDate ? `${d.getUTCDate()} ${months[d.getUTCMonth()]}, ${hm}` : hm
}
