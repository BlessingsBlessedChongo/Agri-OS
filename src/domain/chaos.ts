/**
 * How badly the outside world behaves in a sandbox. The simulated Zamtel Money and VSDC read these settings, so a
 * visitor can turn the network bad and watch Agri-OS recover without losing or duplicating a single ngwee.
 */
export interface ChaosSettings {
  /** Extra time before the payment provider answers. */
  latencyMs: number
  /** Share of payment requests refused with 503 before anything happens. */
  errorRate: number
  /** Share of requests that are processed but answered too late, so Agri-OS can't tell whether they worked. */
  timeoutRate: number
  /** Share of payouts that end in failure at the provider. */
  failureRate: number
  /** Share of confirmations delivered twice. */
  duplicateCallbackRate: number
  /** Share of transactions that also get a stale "still processing" message after the final one. */
  outOfOrderRate: number
  /** Share of confirmations never delivered; Agri-OS has to ask for the status itself. */
  lostCallbackRate: number
  /** How long the provider takes to send a confirmation. */
  callbackDelayMs: number
  /** Share of invoice submissions the tax authority's system refuses with 503. */
  vsdcErrorRate: number
  /** Produce that disappears between depot and weighbridge, in basis points of the load. */
  transitLossBp: number
}

export const CALM: ChaosSettings = {
  latencyMs: 120,
  errorRate: 0,
  timeoutRate: 0,
  failureRate: 0,
  duplicateCallbackRate: 0,
  outOfOrderRate: 0,
  lostCallbackRate: 0,
  callbackDelayMs: 600,
  vsdcErrorRate: 0,
  transitLossBp: 20,
}

export const CHAOS_PRESETS: Record<'calm' | 'rough' | 'storm' | 'theft', { label: string; description: string; settings: ChaosSettings }> = {
  calm: { label: 'Calm', description: 'Everything answers quickly and correctly.', settings: CALM },
  rough: {
    label: 'Bad network day',
    description: 'Slow answers, some refusals and timeouts, duplicated and lost confirmations, a few failed payouts.',
    settings: { latencyMs: 600, errorRate: 0.15, timeoutRate: 0.1, failureRate: 0.1, duplicateCallbackRate: 0.3, outOfOrderRate: 0.2, lostCallbackRate: 0.2, callbackDelayMs: 1500, vsdcErrorRate: 0.2, transitLossBp: 20 },
  },
  storm: {
    label: 'Storm',
    description: 'Half of everything goes wrong. The books must still balance.',
    settings: { latencyMs: 900, errorRate: 0.3, timeoutRate: 0.25, failureRate: 0.25, duplicateCallbackRate: 0.5, outOfOrderRate: 0.4, lostCallbackRate: 0.4, callbackDelayMs: 2000, vsdcErrorRate: 0.4, transitLossBp: 20 },
  },
  theft: {
    label: 'Theft in transit',
    description: 'Payments behave, but 3% of each load goes missing on the road.',
    settings: { ...CALM, transitLossBp: 300 },
  },
}

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(max, Math.max(min, n))
}

/** Fills gaps with calm values and keeps everything in safe ranges (rates ≤ 0.6, delays ≤ 3 s). */
export function normalizeChaos(input: Partial<ChaosSettings> | null | undefined): ChaosSettings {
  const v = input ?? {}
  return {
    latencyMs: Math.round(clamp(v.latencyMs, 0, 1500, CALM.latencyMs)),
    errorRate: clamp(v.errorRate, 0, 0.6, CALM.errorRate),
    timeoutRate: clamp(v.timeoutRate, 0, 0.6, CALM.timeoutRate),
    failureRate: clamp(v.failureRate, 0, 0.6, CALM.failureRate),
    duplicateCallbackRate: clamp(v.duplicateCallbackRate, 0, 1, CALM.duplicateCallbackRate),
    outOfOrderRate: clamp(v.outOfOrderRate, 0, 1, CALM.outOfOrderRate),
    lostCallbackRate: clamp(v.lostCallbackRate, 0, 0.6, CALM.lostCallbackRate),
    callbackDelayMs: Math.round(clamp(v.callbackDelayMs, 100, 3000, CALM.callbackDelayMs)),
    vsdcErrorRate: clamp(v.vsdcErrorRate, 0, 0.6, CALM.vsdcErrorRate),
    transitLossBp: Math.round(clamp(v.transitLossBp, 0, 1000, CALM.transitLossBp)),
  }
}

export function chaosLevel(s: ChaosSettings): 'calm' | 'rough' | 'storm' {
  const worst = Math.max(s.errorRate, s.timeoutRate, s.failureRate, s.lostCallbackRate, s.vsdcErrorRate)
  if (worst >= 0.25) return 'storm'
  if (worst > 0 || s.duplicateCallbackRate > 0 || s.outOfOrderRate > 0) return 'rough'
  return 'calm'
}
