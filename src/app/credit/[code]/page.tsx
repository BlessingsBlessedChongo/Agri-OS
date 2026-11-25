import type { Metadata } from 'next'
import { formatKwacha } from '@/domain/money'
import { formatWeight } from '@/domain/produce'
import { catTime } from '@/lib/describe'
import { lookupShare } from '@/server/credit'
import { Empty } from '@/ui/kit'

export const metadata: Metadata = { title: 'Shared trade record' }

const BAND: Record<string, string> = { BUILDING: 'building', FAIR: 'fair', GOOD: 'good', STRONG: 'strong' }

export default async function CreditPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const share = /^[2-9A-HJ-NP-TV-Z]{6}$/i.test(code) ? await lookupShare(code) : null
  if (!share) {
    return (
      <div className="mx-auto max-w-xl">
        <Empty title="This share code doesn’t work">It may have been typed wrongly, or it expired: codes last 7 days. Ask the farmer to share their record again from *384*123#.</Empty>
      </div>
    )
  }
  const r = share.record
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-sm text-ink-3">Shared with you by the farmer, code {share.code}, valid until {catTime(share.expiresAt.toISOString())}</p>
        <h1 className="font-display text-5xl leading-none font-extrabold tracking-wide">{share.farmer.name}</h1>
        <p className="mt-2 text-ink-2">
          {share.farmer.district}, {share.farmer.province} Province. Trading on Agri-OS since {catTime(share.farmer.memberSince.toISOString()).split(',')[0]}.
        </p>
      </div>

      <section className="rounded-[10px] border border-rule bg-sheet p-5">
        <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
          <div>
            <div className="font-display text-7xl leading-none font-extrabold tabular">{r.score}</div>
            <div className="text-sm text-ink-3">out of 100, {BAND[r.band]}</div>
          </div>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <dt className="text-ink-3">Sales, last 12 months</dt>
            <dd className="font-semibold tabular">{r.salesCount}</dd>
            <dt className="text-ink-3">Value</dt>
            <dd className="font-semibold tabular">{formatKwacha(r.yearAmount)}</dd>
            <dt className="text-ink-3">Volume</dt>
            <dd className="font-semibold tabular">{formatWeight(r.yearGrams)}</dd>
            <dt className="text-ink-3">Pledges delivered</dt>
            <dd className="font-semibold tabular">{r.reliabilityPct === null ? 'No pledges yet' : `${r.reliabilityPct}%`}</dd>
          </dl>
        </div>
        <h2 className="mt-6 font-display text-2xl font-bold tracking-wide">How the score is made</h2>
        <ul className="mt-2 divide-y divide-rule">
          {r.factors.map((f) => (
            <li key={f.key} className="grid gap-1 py-2.5 text-sm sm:grid-cols-[11rem_5rem_1fr]">
              <span className="font-semibold">{f.label}</span>
              <span className="tabular text-ink-2">
                {f.points} of {f.max}
              </span>
              <span className="text-ink-2">{f.detail}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-sm text-ink-3">
        Built only from trades Agri-OS recorded and the VSDC accepted. It contains no phone number and nothing the farmer didn’t choose to share. Viewed {share.views}{' '}
        {share.views === 1 ? 'time' : 'times'}. Demonstration data: this farmer is fictional.
      </p>
    </div>
  )
}
