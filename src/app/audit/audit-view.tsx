'use client'

import * as React from 'react'
import { CheckCircle2, KeyRound, ShieldAlert, Undo2, XCircle } from 'lucide-react'
import { api, errorText } from '@/lib/api'
import { catTime, describe } from '@/lib/describe'
import { useApi, useWorld } from '@/lib/world'
import { Button, cx, Hash, Loading, Notice, Panel } from '@/ui/kit'

interface AuditEvent {
  id: number
  seq: number
  type: string
  entityType: string
  entityId: string
  actor: string
  payload: Record<string, unknown>
  occurredAt: string
  prevHash: string
  hash: string
}

interface Verification {
  ok: boolean
  checked: number
  headSeq: number
  problem: { seq: number; kind: string; message: string } | null
  tookMs: number
}

export function AuditView() {
  const { world, seq, poke } = useWorld()
  const { data, reload } = useApi<{ events: AuditEvent[]; head: { seq: number; hash: string } | null; tampered: { seq: number; field: string } | null }>(world ? '/api/audit' : null, seq)
  const checkpoint = useApi<{ checkpoint: { seq: number; hash: string; signedAt: string; statement: string; signature: string }; publicKey: { keyId: string; spkiPem: string } }>(world ? '/api/audit/checkpoint' : null, seq)
  const [result, setResult] = React.useState<Verification | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [message, setMessage] = React.useState<{ tone: 'bad' | 'info'; text: string } | null>(null)
  const [open, setOpen] = React.useState<number | null>(null)

  const verify = async () => {
    setBusy('verify')
    try {
      setResult(await api<Verification>('/api/audit/verify'))
    } catch (e) {
      setMessage({ tone: 'bad', text: errorText(e) })
    } finally {
      setBusy(null)
    }
  }

  const tamper = async () => {
    setBusy('tamper')
    setMessage(null)
    try {
      const { tampered } = await api<{ tampered: { seq: number; type: string; field: string; before: number; after: number } }>('/api/audit/tamper', { method: 'POST' })
      setMessage({ tone: 'info', text: `Done: event #${tampered.seq} (${tampered.type}) now says ${tampered.field} = ${tampered.after.toLocaleString('en')} instead of ${tampered.before.toLocaleString('en')}. The application was bypassed entirely. Now verify the trail.` })
      setResult(null)
      reload()
    } catch (e) {
      setMessage({ tone: 'bad', text: errorText(e) })
    } finally {
      setBusy(null)
    }
  }

  const undo = async () => {
    setBusy('undo')
    try {
      await api('/api/audit/tamper', { method: 'DELETE' })
      setMessage({ tone: 'info', text: 'The original was put back. Verify again: the chain is whole.' })
      setResult(null)
      reload()
      poke()
    } finally {
      setBusy(null)
    }
  }

  if (!data) return <Loading label="Loading the audit trail" />
  const broken = result && !result.ok ? result.problem?.seq : null

  return (
    <div className="space-y-6">
      <div className="max-w-3xl">
        <h1 className="font-display text-5xl leading-none font-extrabold tracking-wide">Audit trail</h1>
        <p className="mt-3 text-ink-2">
          Everything that happens in your sandbox is recorded as an event whose hash covers its contents and the hash of the event before. Rewrite any of it, even directly in the
          database, and verification points at the exact event. Try it: play an insider with database access.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Verify and tamper">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void verify()} busy={busy === 'verify'}>
              Verify every hash
            </Button>
            {data.tampered ? (
              <Button variant="secondary" onClick={() => void undo()} busy={busy === 'undo'}>
                <Undo2 size={16} aria-hidden /> Put it back
              </Button>
            ) : (
              <Button variant="danger" onClick={() => void tamper()} busy={busy === 'tamper'}>
                <ShieldAlert size={16} aria-hidden /> Change a payment in the database
              </Button>
            )}
          </div>
          {message && (
            <Notice tone={message.tone === 'bad' ? 'bad' : 'wait'} className="mt-3">
              {message.text}
            </Notice>
          )}
          {result && (
            <div className={cx('mt-4 flex items-start gap-3 rounded-[10px] px-4 py-3', result.ok ? 'bg-leaf-wash text-leaf' : 'bg-chili-wash text-chili')} role="status">
              {result.ok ? <CheckCircle2 size={26} aria-hidden /> : <XCircle size={26} aria-hidden />}
              <div>
                <div className="font-display text-2xl leading-none font-extrabold tracking-wide">{result.ok ? 'Intact' : 'Tampered'}</div>
                <p className="mt-1 text-sm">{result.ok ? `All ${result.checked} events check out (${result.tookMs} ms).` : result.problem?.message}</p>
              </div>
            </div>
          )}
          <p className="mt-4 text-xs text-ink-3">
            The tamper button sets a maintenance flag that switches off the database’s append-only guard for one transaction, as someone with direct database access could. Normal code
            paths can’t edit events at all.
          </p>
        </Panel>

        <Panel title="Signed checkpoint" aside={<KeyRound size={18} className="text-ink-3" aria-hidden />}>
          {checkpoint.data ? (
            <div className="space-y-2 text-sm">
              <p className="text-ink-2">
                A signed statement of the trail’s latest event. Anyone who keeps one can later prove the history up to it hasn’t been rewritten, using Agri-OS’s public key.
              </p>
              <dl className="grid grid-cols-[7rem_1fr] gap-y-1">
                <dt className="text-ink-3">Event</dt>
                <dd>#{checkpoint.data.checkpoint.seq}</dd>
                <dt className="text-ink-3">Hash</dt>
                <dd>
                  <Hash value={checkpoint.data.checkpoint.hash} length={24} />
                </dd>
                <dt className="text-ink-3">Signed</dt>
                <dd>{catTime(checkpoint.data.checkpoint.signedAt)}</dd>
                <dt className="text-ink-3">Signature</dt>
                <dd>
                  <Hash value={checkpoint.data.checkpoint.signature} length={24} />
                </dd>
                <dt className="text-ink-3">Key</dt>
                <dd>
                  Ed25519 <Hash value={checkpoint.data.publicKey.keyId} /> (
                  <a className="text-leaf underline-offset-2 hover:underline" href="/api/public/keys">
                    public key
                  </a>
                  )
                </dd>
              </dl>
            </div>
          ) : (
            <Loading />
          )}
        </Panel>
      </div>

      <Panel title={`Events (${data.head?.seq ?? 0})`}>
        <ol className="divide-y divide-rule">
          {data.events.map((e) => {
            const { text } = describe({ ...e, payload: e.payload })
            const isBroken = broken === e.seq
            return (
              <li key={e.id} className={cx('py-2.5', isBroken && 'bg-chili-wash')}>
                <button type="button" className="grid w-full grid-cols-[3.5rem_1fr_auto] gap-3 text-left text-sm" onClick={() => setOpen(open === e.seq ? null : e.seq)} aria-expanded={open === e.seq}>
                  <span className="tabular text-ink-3">#{e.seq}</span>
                  <span>
                    {text}
                    {data.tampered?.seq === e.seq && <span className="ml-2 font-semibold text-chili">(edited behind the app’s back)</span>}
                  </span>
                  <span className="hidden text-xs text-ink-3 sm:block">{catTime(e.occurredAt)}</span>
                </button>
                {open === e.seq && (
                  <div className="mt-2 ml-[4.25rem] space-y-1 text-xs">
                    <div>
                      <span className="text-ink-3">Type</span> {e.type} <span className="ml-3 text-ink-3">By</span> {e.actor}
                    </div>
                    <div>
                      <span className="text-ink-3">Hash</span> <Hash value={e.hash} length={64} />
                    </div>
                    <div>
                      <span className="text-ink-3">Previous</span> <Hash value={e.prevHash} length={64} />
                    </div>
                    <pre className="overflow-x-auto rounded bg-sheet-2 p-2 text-[11px] leading-snug">{JSON.stringify(e.payload, null, 2)}</pre>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      </Panel>
    </div>
  )
}
