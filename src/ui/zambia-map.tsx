'use client'

import * as React from 'react'
import { formatKwachaCompact } from '@/domain/money'
import { formatWeight } from '@/domain/produce'
import { project, PROVINCE_NAMES, ZAMBIA_MAP } from '@/domain/map'
import { cx } from './kit'

export interface DistrictValue {
  districtId: string
  valueNgwee: number
  grams: number
  invoices: number
  live: number
}

interface Marker {
  id: string
  name: string
  lat: number
  lng: number
}

const RAMP = ['var(--map-1)', 'var(--map-2)', 'var(--map-3)', 'var(--map-4)', 'var(--map-5)']

/** Quantile class breaks over districts that traded, so the ramp stays readable whatever the totals are. */
function breaks(values: number[]): number[] {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b)
  if (sorted.length === 0) return []
  return [0.2, 0.4, 0.6, 0.8].map((q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))])
}

/**
 * Produce traded per district (sequential, one hue: more trade, darker green). Depots are maize squares, buyers'
 * plants are blue circles, districts with a live trade from this sandbox pulse once.
 */
export function ZambiaMap({ data, depots = [], plants = [], pulse = [], className, caption, compact }: { data: DistrictValue[]; depots?: Marker[]; plants?: Marker[]; pulse?: string[]; className?: string; caption?: string; compact?: boolean }) {
  const [hover, setHover] = React.useState<{ id: string; x: number; y: number } | null>(null)
  const byId = React.useMemo(() => new Map(data.map((d) => [d.districtId, d])), [data])
  const cuts = React.useMemo(() => breaks(data.map((d) => d.valueNgwee)), [data])
  const fillFor = (value: number) => {
    if (!value) return 'var(--map-0)'
    const index = cuts.findIndex((c) => value <= c)
    return RAMP[index === -1 ? RAMP.length - 1 : index]
  }
  const hovered = hover ? ZAMBIA_MAP.districts.find((d) => d.id === hover.id) : null
  const hoveredData = hover ? byId.get(hover.id) : undefined
  const top = React.useMemo(() => [...data].sort((a, b) => b.valueNgwee - a.valueNgwee).slice(0, 12), [data])
  const nameOf = (id: string) => ZAMBIA_MAP.districts.find((d) => d.id === id)?.name ?? id

  return (
    <figure className={cx('relative', className)}>
      <svg viewBox={ZAMBIA_MAP.viewBox} className="h-auto w-full" role="img" aria-label={caption ?? 'Map of Zambia: produce traded per district'} onPointerLeave={() => setHover(null)}>
        <g>
          {ZAMBIA_MAP.districts.map((d) => (
            <path
              key={d.id}
              d={d.d}
              fill={fillFor(byId.get(d.id)?.valueNgwee ?? 0)}
              stroke="var(--sheet)"
              strokeWidth={1.1}
              fillRule="evenodd"
              onPointerMove={(e) => {
                const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
                setHover({ id: d.id, x: e.clientX - box.left, y: e.clientY - box.top })
              }}
              className={cx('transition-[fill] duration-500', hover?.id === d.id && 'brightness-90')}
            />
          ))}
        </g>
        <g fill="none" stroke="var(--ink-3)" strokeWidth={1.4} strokeOpacity={0.55} pointerEvents="none">
          {ZAMBIA_MAP.provinces.map((p) => (
            <path key={p.id} d={p.d} fillRule="evenodd" />
          ))}
        </g>
        <g pointerEvents="none">
          {pulse.map((id) => {
            const d = ZAMBIA_MAP.districts.find((x) => x.id === id)
            return d ? <circle key={`p-${id}`} cx={d.cx} cy={d.cy} r={4} fill="none" stroke="var(--maize)" strokeWidth={3} className="pulse-ring" /> : null
          })}
          {plants.map((m) => {
            const { x, y } = project(m.lat, m.lng)
            return <circle key={m.id} cx={x} cy={y} r={7} fill="var(--sky)" stroke="var(--sheet)" strokeWidth={2.5}><title>{m.name}</title></circle>
          })}
          {depots.map((m) => {
            const { x, y } = project(m.lat, m.lng)
            return <rect key={m.id} x={x - 6} y={y - 6} width={12} height={12} rx={2} fill="var(--maize)" stroke="var(--ink)" strokeWidth={1.5}><title>{m.name} Depot</title></rect>
          })}
        </g>
      </svg>

      {hover && hovered && (
        <div className="pointer-events-none absolute z-10 w-56 rounded-md border border-rule bg-sheet px-3 py-2 text-sm shadow-lg" style={{ left: Math.min(hover.x + 14, 9999), top: hover.y + 14 }}>
          <div className="font-semibold">{hovered.name}</div>
          <div className="text-xs text-ink-3">{PROVINCE_NAMES[hovered.province]} Province</div>
          {hoveredData ? (
            <div className="mt-1 tabular">
              {formatKwachaCompact(hoveredData.valueNgwee)} of produce, {formatWeight(hoveredData.grams)}
              <div className="text-xs text-ink-3">
                {hoveredData.invoices} invoices{hoveredData.live ? `, ${hoveredData.live} from your sandbox` : ''}
              </div>
            </div>
          ) : (
            <div className="mt-1 text-ink-3">No trade recorded</div>
          )}
        </div>
      )}

      {compact ? (
        <figcaption className="mt-2 flex items-center gap-1.5 text-xs text-ink-3">
          Less
          {['var(--map-0)', ...RAMP].map((c) => (
            <span key={c} className="inline-block h-2.5 w-3.5 rounded-sm" style={{ background: c }} />
          ))}
          More trade
        </figcaption>
      ) : (
      <figcaption className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-3">
        <span className="flex items-center gap-1.5">
          <span className="text-ink-2">Produce traded</span>
          <span className="inline-block h-3 w-4 rounded-sm" style={{ background: 'var(--map-0)' }} /> none
          {RAMP.map((c, i) => (
            <span key={c} className="flex items-center gap-1">
              <span className="inline-block h-3 w-4 rounded-sm" style={{ background: c }} />
              {i === 0 ? `≤ ${formatKwachaCompact(cuts[0] ?? 0)}` : i === RAMP.length - 1 ? `> ${formatKwachaCompact(cuts[3] ?? 0)}` : ''}
            </span>
          ))}
        </span>
        {depots.length > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-[2px] border border-ink bg-maize" /> depot
          </span>
        )}
        {plants.length > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-full bg-sky" /> buyer’s plant
          </span>
        )}
      </figcaption>
      )}

      {!compact && (
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-ink-2">Show the top districts as a table</summary>
        <table className="mt-2 w-full text-left tabular">
          <thead className="text-xs text-ink-3">
            <tr>
              <th className="py-1 font-normal">District</th>
              <th className="py-1 text-right font-normal">Produce</th>
              <th className="py-1 text-right font-normal">Weight</th>
              <th className="py-1 text-right font-normal">Invoices</th>
            </tr>
          </thead>
          <tbody>
            {top.map((d) => (
              <tr key={d.districtId} className="border-t border-rule">
                <td className="py-1">{nameOf(d.districtId)}</td>
                <td className="py-1 text-right">{formatKwachaCompact(d.valueNgwee)}</td>
                <td className="py-1 text-right">{formatWeight(d.grams)}</td>
                <td className="py-1 text-right">{d.invoices}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      )}
    </figure>
  )
}
