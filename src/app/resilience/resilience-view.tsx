'use client'

import * as React from 'react'
import { CheckCircle2, CloudLightning, Scale, XCircle } from 'lucide-react'
import type { ChaosSettings } from '@/domain/chaos'
import { formatKwacha } from '@/domain/money'
import { api, errorText } from '@/lib/api'
import { catTime } from '@/lib/describe'
import type { ResilienceData } from '@/lib/types'
import { useApi, useWorld } from '@/lib/world'
import { Button, cx, LinkButton, Loading, Notice, Panel, Stat } from '@/ui/kit'

const PRESETS: Array<{ key: 'calm' | 'rough' | 'storm' | 'theft'; label: string; text: string }> = [
  { key: 'calm', label: 'Calm', text: 'Everything answers quickly and correctly.' },
  { key: 'rough', label: 'Bad network day', text: 'Slow answers, refusals, timeouts, duplicated and lost confirmations, a few failed payouts.' },
  { key: 'storm', label: 'Storm', text: 'A third of everything goes wrong. The books must still balance.' },
  { key: 'theft', label: 'Theft in transit', text: 'Payments behave, but 3% of every load disappears on the road.' },
]

const SLIDERS: Array<{ key: keyof ChaosSettings; label: string; max: number; step: number; unit: 'pct' | 'ms' | 'bp' }> = [
  { key: 'errorRate', label: 'Payment requests refused (503)', max: 0.6, step: 0.05, unit: 'pct' },
  { key: 'timeoutRate', label: 'Answered too late to know', max: 0.6, step: 0.05, unit: 'pct' },
  { key: 'failureRate', label: 'Payouts that fail at the provider', max: 0.6, step: 0.05, unit: 'pct' },
  { key: 'duplicateCallbackRate', label: 'Confirmations sent twice', max: 1, step: 0.05, unit: 'pct' },
  { key: 'outOfOrderRate', label: 'Stale “processing” after the result', max: 1, step: 0.05, unit: 'pct' },
  { key: 'lostCallbackRate', label: 'Confirmations never sent', max: 0.6, step: 0.05, unit: 'pct' },
  { key: 'vsdcErrorRate', label: 'Invoice submissions refused', max: 0.6, step: 0.05, unit: 'pct' },
  { key: 'latencyMs', label: 'Extra delay on every answer', max: 1500, step: 50, unit: 'ms' },
  { key: 'transitLossBp', label: 'Produce lost in transit', max: 1000, step: 10, unit: 'bp' },
]

const show = (unit: 'pct' | 'ms' | 'bp', v: number) => (unit === 'pct' ? `${Math.round(v * 100)}%` : unit === 'ms' ? `${v} ms` : `${(v / 100).toFixed(1)}%`)

export function ResilienceView() {
  const { world, seq, poke } = useWorld()
  const { data, error } = useApi<ResilienceData>(world ? '/api/resilience' : null, seq)
  const ledger = useApi<{ accounts: Array<{ id: string; code: string; name: string; type: string; balanceNgwee: number }>; entries: Array<{ id: string; kind: string; memo: string; createdAt: string; lines: Array<{ code: string; name: string; amount: number }> }> }>(
    world ? '/api/ledger' : null,
    seq,
  )
  const [busy, setBusy] = React.useState<string | null>(null)
  const [message, setMessage] = React.useState<string | null>(null)

  const apply = async (body: unknown, label: string) => {
    setBusy(label)
    setMessage(null)
    try {
      await api('/api/chaos', { method: 'PUT', body })
      poke()
    } catch (e) {
      setMessage(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  if (error && !data) return <Notice tone="bad">{error}</Notice>
  if (!data) return <Loading label="Reconciling" />
  const rec = data.reconciliation
  const r = data.report

  return (
    <div className="space-y-6">
      <div className="max-w-3xl">
        <h1 className="font-display text-5xl leading-none font-extrabold tracking-wide">Resilience</h1>
        <p className="mt-3 text-ink-2">
          Make the outside world misbehave, then run a harvest (or keep one running) and watch Agri-OS cope. It never confuses “failed” with “don’t know”, retries only in ways that
          can’t pay twice, and proves it afterwards by reconciling its books with the provider’s statement.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="How the outside world behaves" aside={<CloudLightning size={18} className="text-ink-3" aria-hidden />}>
          <div className="grid gap-2 sm:grid-cols-2">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => void apply({ preset: p.key }, p.key)}
                disabled={busy !== null}
                className="rounded-[10px] border border-rule bg-sheet px-3 py-2 text-left hover:border-ink-3 disabled:opacity-60"
              >
                <div className="font-semibold">{p.label}</div>
                <div className="text-sm text-ink-3">{p.text}</div>
              </button>
            ))}
          </div>
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-semibold">Set each one</summary>
            <div className="mt-3 space-y-3">
              {SLIDERS.map((s) => (
                <label key={s.key} className="grid grid-cols-[1fr_auto] items-center gap-x-3 text-sm">
                  <span>{s.label}</span>
                  <span className="tabular text-ink-3">{show(s.unit, data.chaos[s.key])}</span>
                  <input
                    type="range"
                    min={0}
                    max={s.max}
                    step={s.step}
                    defaultValue={data.chaos[s.key]}
                    onPointerUp={(e) => void apply({ settings: { [s.key]: Number((e.target as HTMLInputElement).value) } }, s.key)}
                    onKeyUp={(e) => void apply({ settings: { [s.key]: Number((e.target as HTMLInputElement).value) } }, s.key)}
                    className="col-span-2 accent-[var(--leaf)]"
                  />
                </label>
              ))}
            </div>
          </details>
          {message && (
            <Notice tone="bad" className="mt-3">
              {message}
            </Notice>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <LinkButton href="/demo" variant="secondary">
              Run a harvest in this weather
            </LinkButton>
          </div>
        </Panel>

        <Panel title="Reconciliation with Zamtel Money" aside={<Scale size={18} className="text-ink-3" aria-hidden />}>
          {rec.status === 'UNAVAILABLE' ? (
            <Notice tone="wait">The provider didn’t answer ({rec.message}). Reconciliation will run on the next refresh.</Notice>
          ) : (
            <>
              <div className={cx('flex items-center gap-3 rounded-[10px] px-4 py-3', rec.status === 'MISMATCH' ? 'bg-chili-wash text-chili' : rec.status === 'SETTLING' ? 'bg-maize-wash text-ink' : 'bg-leaf-wash text-leaf')}>
                {rec.status === 'MISMATCH' ? <XCircle size={28} aria-hidden /> : <CheckCircle2 size={28} aria-hidden />}
                <div>
                  <div className="font-display text-3xl leading-none font-extrabold tracking-wide">{rec.status === 'BALANCED' ? 'Balanced' : rec.status === 'SETTLING' ? 'Settling' : 'Mismatch'}</div>
                  <div className="text-sm">
                    {rec.status === 'BALANCED'
                      ? 'Every kwacha in the provider’s statement matches the ledger.'
                      : rec.status === 'SETTLING'
                        ? `${rec.awaiting.length} confirmation${rec.awaiting.length === 1 ? ' is' : 's are'} on the way; that explains the whole difference.`
                        : 'Something doesn’t add up. This should never happen.'}
                  </div>
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-ink-3">Provider says the trust wallet holds</dt>
                  <dd className="font-semibold tabular">{formatKwacha(rec.providerBalanceNgwee)}</dd>
                </div>
                <div>
                  <dt className="text-ink-3">Agri-OS’s ledger says</dt>
                  <dd className="font-semibold tabular">{formatKwacha(rec.ledgerBalanceNgwee)}</dd>
                </div>
                <div>
                  <dt className="text-ink-3">Transactions matched</dt>
                  <dd className="font-semibold tabular">{rec.matched}</dd>
                </div>
                <div>
                  <dt className="text-ink-3">Checked</dt>
                  <dd className="font-semibold">{catTime(rec.checkedAt)}</dd>
                </div>
              </dl>
              {rec.mismatches.length > 0 && (
                <ul className="mt-3 list-disc pl-5 text-sm text-chili">
                  {rec.mismatches.map((m) => (
                    <li key={m.transactionId}>
                      {m.transactionId}: {m.problem}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Panel>
      </div>

      <Panel title="What went wrong outside, and what Agri-OS did">
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Payments sent twice" value={r.doublePayments} note="Checked against the provider’s own records" />
          <Stat label="Duplicate confirmations ignored" value={r.callbacks.duplicatesIgnored} note={`of ${r.callbacks.received} received`} />
          <Stat label="Stale or late messages ignored" value={r.callbacks.staleIgnored} note="Out-of-order “processing” after the result" />
          <Stat label="Timeouts resolved by asking" value={r.payouts.timeoutsResolved} note="Never treated as failures" />
          <Stat label="Lost confirmations recovered" value={r.payouts.recoveredByPolling} note="Found by polling the provider" />
          <Stat label="Failed payouts retried" value={r.payouts.retriedAfterFailure} note="With a new idempotency key" />
          <Stat label="Payouts that gave up" value={r.payouts.gaveUp} note="Money stays owed, safe in escrow" />
          <Stat label="Invoice resubmissions" value={r.invoices.retries} note={`${r.invoices.accepted} accepted, ${r.invoices.pending} waiting`} />
        </div>
      </Panel>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Panel title="The ledger’s invariants">
          <ul className="space-y-2 text-sm">
            <Invariant ok={r.ledger.sumOfBalances === 0} text={`All account balances sum to zero (${formatKwacha(r.ledger.sumOfBalances)}).`} />
            <Invariant ok={r.ledger.balancesMatchLines} text="Every account’s balance equals the sum of its lines." />
            <Invariant ok={r.ledger.unbalancedEntries === 0} text={`Every one of ${r.ledger.entries} journal entries balances (${r.ledger.lines} lines).`} />
            <Invariant ok={r.jobs.failed === 0} text={r.jobs.failed === 0 ? 'No background job has given up.' : `${r.jobs.failed} background jobs gave up (see the audit trail).`} />
          </ul>
          <p className="mt-3 text-xs text-ink-3">
            The database enforces the first three on every write: a constraint trigger rejects an unbalanced entry at commit, a check constraint rejects a balance with the wrong sign,
            and ledger rows can’t be edited or deleted.
          </p>
          {ledger.data && (
            <table className="mt-4 w-full text-left text-sm tabular">
              <thead className="text-xs text-ink-3">
                <tr>
                  <th className="py-1 font-normal">Account</th>
                  <th className="py-1 text-right font-normal">Balance</th>
                </tr>
              </thead>
              <tbody>
                {ledger.data.accounts.map((a) => (
                  <tr key={a.id} className="border-t border-rule">
                    <td className="py-1">{a.name}</td>
                    <td className="py-1 text-right">{formatKwacha(a.type === 'ASSET' ? a.balanceNgwee : -a.balanceNgwee)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        <Panel title="Latest journal entries">
          {!ledger.data || ledger.data.entries.length === 0 ? (
            <p className="text-sm text-ink-3">Entries appear when escrow arrives and trucks settle.</p>
          ) : (
            <ol className="space-y-3">
              {ledger.data.entries.slice(0, 12).map((e) => (
                <li key={e.id} className="rounded-md border border-rule p-2.5 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="font-semibold">{e.memo}</span>
                    <span className="text-xs whitespace-nowrap text-ink-3">{catTime(e.createdAt, false)}</span>
                  </div>
                  <table className="mt-1 w-full tabular">
                    <tbody>
                      {e.lines.map((l, i) => (
                        <tr key={i}>
                          <td className="py-0.5 text-ink-2">{l.name}</td>
                          <td className="w-28 py-0.5 text-right">{l.amount > 0 ? formatKwacha(l.amount) : ''}</td>
                          <td className="w-28 py-0.5 text-right">{l.amount < 0 ? formatKwacha(-l.amount) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-3 text-xs text-ink-3">Left column debits, right column credits.</p>
        </Panel>
      </div>
      <Button variant="quiet" onClick={() => poke()}>
        Refresh now
      </Button>
    </div>
  )
}

function Invariant({ ok, text }: { ok: boolean; text: string }) {
  return (
    <li className="flex items-start gap-2">
      {ok ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-leaf" aria-label="Holds" /> : <XCircle size={18} className="mt-0.5 shrink-0 text-chili" aria-label="Broken" />}
      <span>{text}</span>
    </li>
  )
}
