'use client'

import * as React from 'react'
import { api, ApiError, errorText } from './api'
import type { FeedEvent, World } from './types'

interface WorldValue {
  world: World | null
  error: string | null
  /** Latest audit-trail sequence number; bumps whenever anything happens in the sandbox. */
  seq: number
  /** Newest first. */
  feed: FeedEvent[]
  pending: { due: number; scheduled: number; failed: number }
  /** Run background work now instead of waiting for the next tick. */
  poke: () => void
  /** Throws the sandbox away and starts a fresh one; resolves with the new sandbox. */
  reset: () => Promise<World>
}

const WorldContext = React.createContext<WorldValue | null>(null)
const TICK_MS = 1100

/**
 * Every visitor works in a private sandbox. This creates it on first visit, then ticks once a second: each tick runs
 * the sandbox's due background work on the server and pulls any new audit events, which every screen refreshes from.
 */
export function WorldProvider({ children }: { children: React.ReactNode }) {
  const [world, setWorld] = React.useState<World | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [seq, setSeq] = React.useState(0)
  const [feed, setFeed] = React.useState<FeedEvent[]>([])
  const [pending, setPending] = React.useState({ due: 0, scheduled: 0, failed: 0 })
  const seqRef = React.useRef(0)
  const pokeRef = React.useRef<() => void>(() => undefined)

  const start = React.useCallback(async (fresh: boolean) => {
    const current = fresh ? null : (await api<{ world: World | null }>('/api/world')).world
    const next = current ?? (await api<{ world: World }>(fresh ? '/api/world?reset=1' : '/api/world', { method: 'POST' })).world
    seqRef.current = 0
    setFeed([])
    setSeq(0)
    setWorld(next)
    setError(null)
    return next
  }, [])

  React.useEffect(() => {
    let cancelled = false
    // Syncing with the server-side sandbox (an external system): state is only set once the network call resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    start(false).catch((e) => {
      if (!cancelled) setError(errorText(e))
    })
    return () => {
      cancelled = true
    }
  }, [start])

  React.useEffect(() => {
    if (!world) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let running = false
    const tick = async () => {
      if (stopped || running) return
      running = true
      try {
        if (document.visibilityState === 'visible') {
          const t = await api<{ seq: number; pending: WorldValue['pending'] }>('/api/tick', { method: 'POST' })
          if (stopped) return
          setPending(t.pending)
          if (t.seq > seqRef.current) {
            const { events } = await api<{ events: FeedEvent[] }>(`/api/events?after=${seqRef.current}&limit=500`)
            if (stopped) return
            seqRef.current = Math.max(seqRef.current, ...events.map((e) => e.seq), t.seq)
            setFeed((f) => [...[...events].reverse(), ...f].slice(0, 400))
            setSeq(seqRef.current)
          }
        }
      } catch (e) {
        if (e instanceof ApiError && e.code === 'NO_WORLD') {
          // The sandbox expired or was cleaned up: start a new one.
          start(true).catch((err) => setError(errorText(err)))
          return
        }
      } finally {
        running = false
      }
      if (!stopped) timer = setTimeout(tick, TICK_MS)
    }
    pokeRef.current = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(tick, 60)
    }
    void tick()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [world, start])

  const poke = React.useCallback(() => pokeRef.current(), [])
  const reset = React.useCallback(() => start(true), [start])

  const value = React.useMemo(() => ({ world, error, seq, feed, pending, poke, reset }), [world, error, seq, feed, pending, poke, reset])
  return <WorldContext.Provider value={value}>{children}</WorldContext.Provider>
}

export function useWorld(): WorldValue {
  const value = React.useContext(WorldContext)
  if (!value) throw new Error('useWorld must be used inside <WorldProvider>')
  return value
}

/**
 * Loads a JSON endpoint and reloads it whenever `version` changes (pass the world's `seq` to stay live).
 * Stale answers from an earlier request are dropped.
 */
export function useApi<T>(path: string | null, version: number = 0) {
  const [state, setState] = React.useState<{ key: string | null; data: T | null; error: string | null }>({ key: null, data: null, error: null })
  const [nonce, setNonce] = React.useState(0)
  const key = path ? `${path}#${version}#${nonce}` : null
  React.useEffect(() => {
    if (!path || !key) return
    let current = true
    api<T>(path).then(
      (data) => {
        if (current) setState({ key, data, error: null })
      },
      (e) => {
        if (current) setState((s) => ({ key, data: s.data, error: errorText(e) }))
      },
    )
    return () => {
      current = false
    }
  }, [key, path])
  const reload = React.useCallback(() => setNonce((n) => n + 1), [])
  return { data: path ? state.data : null, error: path ? state.error : null, loading: Boolean(key) && state.key !== key, reload }
}

/** A clock for "2 minutes ago" text that re-renders every 15 s (no Date.now() during render). */
export function useNow(intervalMs = 15_000) {
  const [now, setNow] = React.useState<number | null>(null)
  React.useEffect(() => {
    const update = () => setNow(Date.now())
    const first = setTimeout(update, 0)
    const id = setInterval(update, intervalMs)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [intervalMs])
  return now
}
