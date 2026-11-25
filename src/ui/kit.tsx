import Link from 'next/link'
import * as React from 'react'
import { AlertTriangle, Check, CircleDashed, Clock, HelpCircle, Loader2, RotateCcw, Send, Truck, X } from 'lucide-react'
import { formatKwacha, formatKwachaCompact } from '@/domain/money'

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

const BUTTON = {
  primary: 'bg-maize text-maize-ink hover:brightness-[0.96] active:brightness-90 font-semibold',
  secondary: 'border border-rule bg-sheet text-ink hover:bg-sheet-2',
  quiet: 'text-ink-2 hover:bg-sheet-2 hover:text-ink',
  danger: 'bg-chili text-white hover:brightness-95 font-semibold',
  leaf: 'bg-leaf text-sheet hover:brightness-110 font-semibold',
}
const SIZE = { sm: 'h-8 px-3 text-sm gap-1.5', md: 'h-10 px-4 text-[0.95rem] gap-2', lg: 'h-12 px-5 text-base gap-2' }

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON; size?: keyof typeof SIZE; busy?: boolean }

export function Button({ variant = 'primary', size = 'md', busy, className, children, disabled, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || busy}
      className={cx('inline-flex shrink-0 items-center justify-center rounded-md whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-50', BUTTON[variant], SIZE[size], className)}
    >
      {busy && <Loader2 size={16} className="animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

export function LinkButton({ href, variant = 'primary', size = 'md', className, children }: { href: string; variant?: keyof typeof BUTTON; size?: keyof typeof SIZE; className?: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={cx('inline-flex items-center justify-center rounded-md whitespace-nowrap transition', BUTTON[variant], SIZE[size], className)}>
      {children}
    </Link>
  )
}

/** A titled block. Panels group related things; they are not the default container for everything. */
export function Panel({ title, aside, children, className, bodyClassName, id }: { title?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string; id?: string }) {
  return (
    <section id={id} className={cx('rounded-[10px] border border-rule bg-sheet', className)}>
      {(title || aside) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-3">
          {title && <h2 className="font-display text-xl font-bold tracking-wide">{title}</h2>}
          {aside}
        </header>
      )}
      <div className={cx('p-4', bodyClassName)}>{children}</div>
    </section>
  )
}

export function PageTitle({ title, children, actions }: { title: string; children?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        <h1 className="font-display text-4xl leading-none font-extrabold tracking-wide sm:text-5xl">{title}</h1>
        {children && <div className="mt-3 text-ink-2">{children}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function Money({ ngwee, compact, className }: { ngwee: number; compact?: boolean; className?: string }) {
  return <span className={cx('tabular', className)}>{compact ? formatKwachaCompact(ngwee) : formatKwacha(ngwee)}</span>
}

export function Stat({ label, value, note, className }: { label: string; value: React.ReactNode; note?: React.ReactNode; className?: string }) {
  return (
    <div className={cx('min-w-0', className)}>
      <div className="text-sm text-ink-3">{label}</div>
      <div className="font-display text-3xl leading-tight font-bold tracking-wide tabular">{value}</div>
      {note && <div className="text-sm text-ink-3">{note}</div>}
    </div>
  )
}

type Tone = 'good' | 'info' | 'wait' | 'bad' | 'muted'
const TONE: Record<Tone, string> = {
  good: 'bg-leaf-wash text-leaf',
  info: 'bg-sky-wash text-sky',
  wait: 'bg-maize-wash text-ink',
  bad: 'bg-chili-wash text-chili',
  muted: 'bg-sheet-2 text-ink-3',
}
const TONE_ICON: Record<Tone, React.ComponentType<{ size?: number; 'aria-hidden'?: boolean }>> = { good: Check, info: Send, wait: Clock, bad: AlertTriangle, muted: CircleDashed }

export function Pill({ tone, children, icon }: { tone: Tone; children: React.ReactNode; icon?: React.ComponentType<{ size?: number; 'aria-hidden'?: boolean }> }) {
  const Icon = icon ?? TONE_ICON[tone]
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap', TONE[tone])}>
      <Icon size={12} aria-hidden />
      {children}
    </span>
  )
}

/** Every status in the system, with words (colour is never the only signal). */
const STATUS: Record<string, [Tone, string, React.ComponentType<{ size?: number; 'aria-hidden'?: boolean }>?]> = {
  // payouts
  QUEUED: ['muted', 'Queued'],
  SENT: ['info', 'Sending'],
  UNKNOWN: ['wait', 'Checking', HelpCircle],
  SUCCEEDED: ['good', 'Paid'],
  RETRY_WAIT: ['wait', 'Retrying', RotateCcw],
  FAILED: ['bad', 'Needs attention'],
  // orders
  FUNDING: ['wait', 'Awaiting escrow'],
  OPEN: ['good', 'Open'],
  CLOSED: ['info', 'Closed'],
  COMPLETED: ['muted', 'Completed', Check],
  CANCELLED: ['muted', 'Cancelled', X],
  // pledges and deliveries
  PLEDGED: ['info', 'Pledged'],
  DELIVERED: ['good', 'Delivered'],
  EXPIRED: ['muted', 'Expired', X],
  RECEIVED: ['info', 'At depot'],
  REJECTED: ['bad', 'Refused', X],
  LOADED: ['info', 'On truck', Truck],
  SETTLED: ['good', 'Settled'],
  // trucks
  IN_TRANSIT: ['info', 'On the road', Truck],
  WEIGHED: ['info', 'Weighed'],
  HELD: ['bad', 'Held'],
  // invoices
  PENDING: ['wait', 'At VSDC'],
  ACCEPTED: ['good', 'Accepted'],
}

export function StatusPill({ status, label }: { status: string; label?: string }) {
  const [tone, text, icon] = STATUS[status] ?? (['muted', status] as [Tone, string])
  return (
    <Pill tone={tone} icon={icon}>
      {label ?? text}
    </Pill>
  )
}

export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-[10px] border border-dashed border-rule px-5 py-8 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-ink-3">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-ink-3" role="status">
      <Loader2 size={16} className="animate-spin" aria-hidden /> {label}…
    </div>
  )
}

export function Notice({ tone = 'info', children, className }: { tone?: 'info' | 'bad' | 'good' | 'wait'; children: React.ReactNode; className?: string }) {
  const style = { info: 'border-sky/30 bg-sky-wash', bad: 'border-chili/30 bg-chili-wash', good: 'border-leaf/30 bg-leaf-wash', wait: 'border-maize/40 bg-maize-wash' }[tone]
  return <div className={cx('rounded-md border px-3 py-2 text-sm', style, className)}>{children}</div>
}

export function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-sm font-semibold">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-ink-3">{hint}</p>}
    </div>
  )
}

export const inputClass = 'h-10 w-full rounded-md border border-rule bg-sheet px-3 text-ink placeholder:text-ink-3 focus:border-leaf focus:outline-none'

export function Hash({ value, length = 12 }: { value: string; length?: number }) {
  return (
    <code className="rounded bg-sheet-2 px-1 py-0.5 font-mono text-[0.8em] text-ink-2" title={value}>
      {value.length > length ? `${value.slice(0, length)}…` : value}
    </code>
  )
}

export function Progress({ value, max, label, tone = 'leaf' }: { value: number; max: number; label: string; tone?: 'leaf' | 'maize' | 'sky' }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  const color = { leaf: 'var(--leaf)', maize: 'var(--maize)', sky: 'var(--sky)' }[tone]
  return (
    <div>
      <div className="mb-1 flex justify-between gap-2 text-sm">
        <span className="text-ink-2">{label}</span>
        <span className="tabular text-ink-3">{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-sheet-2" role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-2 rounded-full transition-[width] duration-700" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}
