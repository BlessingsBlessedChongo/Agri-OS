/**
 * A seven-segment LED readout, drawn in SVG (no font): the display a depot scale or a weighbridge indicator has.
 * Unlit segments stay faintly visible, as on the real thing.
 */
const SEGMENTS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg', '5': 'acdfg', '6': 'acdefg', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg',
  '-': 'g', ' ': '', E: 'adefg', r: 'eg', o: 'cdeg', P: 'abefg', A: 'abcefg', C: 'adef', S: 'acdfg', H: 'bcefg', t: 'defg', L: 'def', n: 'ceg', b: 'cdefg', d: 'bcdeg', U: 'bcdef', u: 'cde', G: 'acdef', F: 'aefg', y: 'bcdfg',
}

const SHAPES: Record<string, string> = {
  a: 'M5,2 L19,2 L16.5,5 L7.5,5 Z',
  b: 'M20,3 L20,18.5 L17,16.5 L17,6 Z',
  c: 'M20,21.5 L20,37 L17,34 L17,23.5 Z',
  d: 'M5,38 L19,38 L16.5,35 L7.5,35 Z',
  e: 'M4,21.5 L7,23.5 L7,34 L4,37 Z',
  f: 'M4,3 L7,6 L7,16.5 L4,18.5 Z',
  g: 'M5.5,20 L7.5,18.4 L16.5,18.4 L18.5,20 L16.5,21.6 L7.5,21.6 Z',
}

interface Props {
  value: string
  /** Digits shown even when blank, so the readout doesn't jump. */
  width?: number
  height?: number
  on?: string
  off?: string
  className?: string
  label: string
}

export function SevenSegment({ value, width, height = 44, on = 'var(--led)', off = 'var(--led-off)', className, label }: Props) {
  const cells: Array<{ ch: string; dot: boolean }> = []
  for (const ch of value) {
    if ((ch === '.' || ch === ',') && cells.length) cells[cells.length - 1].dot = true
    else cells.push({ ch, dot: false })
  }
  while (width && cells.length < width) cells.unshift({ ch: ' ', dot: false })
  const cellW = 24
  return (
    <svg className={className} viewBox={`0 0 ${cells.length * cellW} 40`} height={height} role="img" aria-label={label}>
      <g transform="skewX(-6) translate(4 0)">
        {cells.map((cell, i) => {
          const lit = SEGMENTS[cell.ch] ?? ''
          return (
            <g key={i} transform={`translate(${i * cellW} 0)`}>
              {Object.entries(SHAPES).map(([seg, d]) => (
                <path key={seg} d={d} fill={lit.includes(seg) ? on : off} />
              ))}
              <circle cx={22.5} cy={37} r={1.7} fill={cell.dot ? on : off} />
            </g>
          )
        })}
      </g>
    </svg>
  )
}

/** 401 200 g → "401.2"; 21 460 000 g → "21460" (kg, as a weighbridge shows it). */
export function kgReadout(grams: number, decimals = 1): string {
  return (grams / 1000).toFixed(decimals)
}
