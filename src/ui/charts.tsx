'use client'

import * as React from 'react'
import { formatKwacha, formatKwachaCompact } from '@/domain/money'
import { formatWeight } from '@/domain/produce'
import type { PriceWeek } from '@/lib/types'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Clean y ticks: 3–5 round numbers covering the range. */
function ticks(min: number, max: number): number[] {
  const span = Math.max(1, max - min)
  const raw = span / 4
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw
  const start = Math.floor(min / step) * step
  const out: number[] = []
  for (let v = start; v <= max + step * 0.01; v += step) out.push(Math.round(v))
  return out
}

/**
 * Weekly median price per kg (the line) and the middle half of prices that week (the band). One series, so no
 * legend box: the title says what is plotted. Hover anywhere for that week's numbers.
 */
export function PriceChart({ weeks, label }: { weeks: PriceWeek[]; label: string }) {
  const [hover, setHover] = React.useState<number | null>(null)
  const W = 640
  const H = 230
  const pad = { l: 56, r: 64, t: 14, b: 28 }
  if (weeks.length < 2) return <p className="py-10 text-center text-sm text-ink-3">Not enough sales yet to draw a trend.</p>
  const lo = Math.min(...weeks.map((w) => w.p25Ngwee))
  const hi = Math.max(...weeks.map((w) => w.p75Ngwee))
  const yTicks = ticks(lo * 0.97, hi * 1.02)
  const yMin = yTicks[0]
  const yMax = yTicks[yTicks.length - 1]
  const x = (i: number) => pad.l + (i / (weeks.length - 1)) * (W - pad.l - pad.r)
  const y = (v: number) => pad.t + (1 - (v - yMin) / Math.max(1, yMax - yMin)) * (H - pad.t - pad.b)
  const line = weeks.map((w, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(w.medianNgwee).toFixed(1)}`).join(' ')
  const band = `${weeks.map((w, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(w.p75Ngwee).toFixed(1)}`).join(' ')} ${[...weeks]
    .map((w, i) => ({ w, i }))
    .reverse()
    .map(({ w, i }) => `L${x(i).toFixed(1)},${y(w.p25Ngwee).toFixed(1)}`)
    .join(' ')} Z`
  const last = weeks[weeks.length - 1]
  const monthTicks = weeks
    .map((w, i) => ({ i, d: new Date(`${w.week}T00:00:00Z`) }))
    .filter(({ d, i }) => i === 0 || d.getUTCDate() <= 7)
  const h = hover === null ? null : weeks[hover]

  return (
    <figure className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${label}: weekly median price per kg, now ${formatKwacha(last.medianNgwee)}`}
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect()
          const px = ((e.clientX - box.left) / box.width) * W
          const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (weeks.length - 1))
          setHover(Math.max(0, Math.min(weeks.length - 1, i)))
        }}
        onPointerLeave={() => setHover(null)}
      >
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--rule)" strokeWidth={1} />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize={12} fill="var(--ink-3)" className="tabular">
              {formatKwacha(t)}
            </text>
          </g>
        ))}
        {monthTicks.map(({ i, d }) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize={12} fill="var(--ink-3)">
            {MONTHS[d.getUTCMonth()]}
          </text>
        ))}
        <path d={band} fill="var(--leaf)" fillOpacity={0.1} />
        <path d={line} fill="none" stroke="var(--leaf)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(weeks.length - 1)} cy={y(last.medianNgwee)} r={4.5} fill="var(--leaf)" stroke="var(--sheet)" strokeWidth={2} />
        <text x={x(weeks.length - 1) + 9} y={y(last.medianNgwee) + 4} fontSize={13} fontWeight={700} fill="var(--ink)" className="tabular">
          {formatKwacha(last.medianNgwee)}
        </text>
        {h && hover !== null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--ink-3)" strokeWidth={1} />
            <circle cx={x(hover)} cy={y(h.medianNgwee)} r={4.5} fill="var(--leaf)" stroke="var(--sheet)" strokeWidth={2} />
          </g>
        )}
      </svg>
      {h && hover !== null && (
        <div
          className="pointer-events-none absolute top-2 rounded-md border border-rule bg-sheet px-3 py-2 text-sm shadow-lg"
          style={{ left: `${(x(hover) / W) * 100}%`, transform: hover > weeks.length / 2 ? 'translateX(-105%)' : 'translateX(8px)' }}
        >
          <div className="font-semibold">Week of {new Date(`${h.week}T00:00:00Z`).getUTCDate()} {MONTHS[new Date(`${h.week}T00:00:00Z`).getUTCMonth()]}</div>
          <div className="tabular">Median {formatKwacha(h.medianNgwee)}/kg</div>
          <div className="text-xs text-ink-3 tabular">
            Middle half {formatKwacha(h.p25Ngwee)}–{formatKwacha(h.p75Ngwee)}, {h.sales} sales
          </div>
        </div>
      )}
      <details className="mt-1 text-sm">
        <summary className="cursor-pointer text-ink-2">Show as a table</summary>
        <table className="mt-2 w-full text-left tabular">
          <thead className="text-xs text-ink-3">
            <tr>
              <th className="py-1 font-normal">Week of</th>
              <th className="py-1 text-right font-normal">Median /kg</th>
              <th className="py-1 text-right font-normal">Middle half</th>
              <th className="py-1 text-right font-normal">Sales</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.week} className="border-t border-rule">
                <td className="py-1">{w.week}</td>
                <td className="py-1 text-right">{formatKwacha(w.medianNgwee)}</td>
                <td className="py-1 text-right">
                  {formatKwacha(w.p25Ngwee)}–{formatKwacha(w.p75Ngwee)}
                </td>
                <td className="py-1 text-right">{w.sales}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}

/** Horizontal bars, one measure, labelled at the tip (bars are capped at 22px and grow from one baseline). */
export function Bars({ rows }: { rows: Array<{ key: string; label: string; value: number; grams?: number }> }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[6.5rem_1fr] items-center gap-3 text-sm">
          <span className="truncate text-ink-2">{r.label}</span>
          <span className="flex items-center gap-2">
            <span className="h-[18px] rounded-r-[4px] bg-leaf" style={{ width: `${Math.max(2, (r.value / max) * 78)}%` }} aria-hidden />
            <span className="tabular whitespace-nowrap">
              {formatKwachaCompact(r.value)}
              {r.grams ? <span className="text-ink-3"> · {formatWeight(r.grams)}</span> : null}
            </span>
          </span>
        </li>
      ))}
    </ul>
  )
}
