'use client'

import { describe, TONE_COLOR, timeAgo } from '@/lib/describe'
import type { FeedEvent } from '@/lib/types'
import { useNow } from '@/lib/world'
import { cx } from './kit'

/** The sandbox's audit trail as plain sentences, newest first. Colour marks who the event is about. */
export function EventFeed({ events, limit = 30, className, empty = 'Nothing has happened yet.' }: { events: FeedEvent[]; limit?: number; className?: string; empty?: string }) {
  const now = useNow()
  const shown = events.filter((e) => e.type !== 'payout.sent' || events.length < 40).slice(0, limit)
  if (shown.length === 0) return <p className={cx('text-sm text-ink-3', className)}>{empty}</p>
  return (
    <ol className={cx('space-y-2', className)}>
      {shown.map((e) => {
        const { text, tone } = describe(e)
        return (
          <li key={e.seq} className="grid grid-cols-[0.5rem_1fr] gap-x-2.5 text-sm leading-snug">
            <span className="mt-1.5 h-2 w-2 rounded-full" style={{ background: TONE_COLOR[tone] }} aria-hidden />
            <span>
              {text}
              <span className="ml-1.5 text-xs whitespace-nowrap text-ink-3">
                #{e.seq} {timeAgo(e.occurredAt, now)}
              </span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
