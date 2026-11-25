'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import * as React from 'react'
import { RefreshCw } from 'lucide-react'
import { useWorld } from '@/lib/world'
import { cx } from './kit'

const NAV = [
  { href: '/demo', label: 'Run a harvest' },
  { href: '/farmer', label: 'Farmer' },
  { href: '/depot', label: 'Depot' },
  { href: '/buyer', label: 'Buyer' },
  { href: '/zra', label: 'ZRA' },
  { href: '/resilience', label: 'Resilience' },
  { href: '/audit', label: 'Audit trail' },
]

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2', className)}>
      {/* A maize kernel: the mark. */}
      <svg viewBox="0 0 24 24" width={22} height={22} aria-hidden>
        <path d="M12 2c4.4 0 7 3.6 7 8.2 0 5.6-3.6 11.8-7 11.8S5 15.8 5 10.2C5 5.6 7.6 2 12 2Z" fill="var(--maize)" />
        <path d="M12 6.5c-1.6 1.7-2.4 4.3-2.4 7.2" stroke="var(--maize-ink)" strokeOpacity={0.35} strokeWidth={1.6} fill="none" strokeLinecap="round" />
      </svg>
      <span className="font-display text-2xl font-extrabold tracking-wide">Agri-OS</span>
    </span>
  )
}

export function SiteHeader() {
  const pathname = usePathname()
  const { world, reset, error } = useWorld()
  const [busy, setBusy] = React.useState(false)
  const onReset = async () => {
    if (!window.confirm('Start a fresh sandbox? Everything you did in this one is deleted.')) return
    setBusy(true)
    try {
      await reset()
    } finally {
      setBusy(false)
    }
  }
  return (
    <header className="border-b border-rule bg-sheet">
      <div className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="rounded-md">
          <Wordmark />
        </Link>
        <nav aria-label="Main" className="order-3 -mx-1 flex w-full flex-wrap gap-1 lg:order-none lg:w-auto">
          {NAV.map((item) => {
            const active = pathname === item.href || (item.href !== '/' && pathname.startsWith(`${item.href}/`))
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'rounded-md px-2.5 py-1.5 text-[0.95rem] transition',
                  active ? 'bg-ink text-sheet' : 'text-ink-2 hover:bg-sheet-2 hover:text-ink',
                  item.href === '/demo' && !active && 'font-semibold text-ink',
                )}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2 text-sm text-ink-3">
          {error ? (
            <span className="text-chili">Sandbox unavailable</span>
          ) : world ? (
            <span title={`Sandbox ${world.id}`} className="hidden sm:inline">
              Private sandbox
            </span>
          ) : (
            <span>Preparing your sandbox…</span>
          )}
          <button type="button" onClick={onReset} disabled={busy || !world} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-ink-2 hover:bg-sheet-2 disabled:opacity-50">
            <RefreshCw size={14} className={busy ? 'animate-spin' : ''} aria-hidden /> New sandbox
          </button>
        </div>
      </div>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-rule">
      <div className="mx-auto grid max-w-[1320px] gap-4 px-4 py-8 text-sm text-ink-3 sm:px-6 md:grid-cols-[1fr_auto]">
        <p className="max-w-3xl">
          A portfolio project. Zamtel Money and ZRA’s invoicing (VSDC) are simulated behind real HTTP APIs; Agri-OS is not affiliated with Zamtel or the Zambia Revenue
          Authority. Every farmer, buyer and transporter is fictional, and tax rates are illustrative. District boundaries: geoBoundaries (CC BY 4.0).
        </p>
        <nav aria-label="Project" className="flex flex-wrap gap-4">
          <Link className="hover:text-ink" href="/architecture">
            How it’s built
          </Link>
          <Link className="hover:text-ink" href="/api-docs">
            API
          </Link>
        </nav>
      </div>
    </footer>
  )
}
