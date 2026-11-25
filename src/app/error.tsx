'use client'

import { Button } from '@/ui/kit'

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <h1 className="font-display text-5xl font-extrabold tracking-wide">This page hit a problem</h1>
      <p className="mt-3 text-ink-2">Nothing in your sandbox was lost: the ledger and audit trail only change inside transactions. Try loading the page again.</p>
      {error.digest && <p className="mt-2 text-xs text-ink-3">Reference {error.digest}</p>}
      <Button className="mt-6" onClick={reset}>
        Try again
      </Button>
    </div>
  )
}
