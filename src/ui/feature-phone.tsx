'use client'

import * as React from 'react'
import { Calendar, Clock3, Flashlight, Mail, Phone, Radio, Settings, Users, Wheat, type LucideIcon } from 'lucide-react'
import { formatMsisdn } from '@/domain/ids'
import { sleep, ussd, uuid } from '@/lib/api'
import { catTime } from '@/lib/describe'
import { useApi, useNow } from '@/lib/world'
import { cx } from './kit'
import { PhoneShell, type PhoneKey } from './phone-shell'

export interface PhoneHandle {
  /** Dials *384*123# from wherever the phone is. */
  dial(): Promise<void>
  /** Types an answer and presses Send. */
  send(input: string): Promise<void>
  showInbox(): void
  hangUp(): void
}

interface Message {
  id: string
  body: string
  kind: string
  createdAt: string
}

type View =
  | { name: 'home' }
  | { name: 'dial' }
  | { name: 'menu'; index: number }
  | { name: 'busy' }
  | { name: 'ussd'; text: string; ended: boolean }
  | { name: 'inbox'; index: number }
  | { name: 'message'; id: string; index: number }
  | { name: 'notice'; text: string }

const CODE = '*384*123#'
const MULTI_TAP: Record<string, string> = { '1': '.,?!1', '2': 'abc2', '3': 'def3', '4': 'ghi4', '5': 'jkl5', '6': 'mno6', '7': 'pqrs7', '8': 'tuv8', '9': 'wxyz9', '0': ' 0' }
const MENU: Array<{ label: string; icon: LucideIcon; color: string }> = [
  { label: 'Messages', icon: Mail, color: '#2fa36b' },
  { label: 'Agri-OS', icon: Wheat, color: '#e0a400' },
  { label: 'Contacts', icon: Users, color: '#2f7fd8' },
  { label: 'Call log', icon: Phone, color: '#1aa3a3' },
  { label: 'Clock', icon: Clock3, color: '#e2732b' },
  { label: 'Settings', icon: Settings, color: '#6b7280' },
  { label: 'Radio', icon: Radio, color: '#8b5cf6' },
  { label: 'Torch', icon: Flashlight, color: '#d4a017' },
  { label: 'Calendar', icon: Calendar, color: '#d9473b' },
]
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function catDate(ms: number) {
  const d = new Date(ms + 2 * 3600 * 1000)
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

/**
 * A basic phone, working like one: home screen, menu, dialer, USSD and SMS. It sends exactly the request Africa's
 * Talking would, to the same endpoint. Use the keypad (multi-tap letters: # switches 123/abc) or your keyboard.
 */
export function FeaturePhone({ phone, owner, seq, ref, className }: { phone: string; owner: string; seq: number; ref?: React.Ref<PhoneHandle>; className?: string }) {
  const [view, setView] = React.useState<View>({ name: 'home' })
  const [buffer, setBuffer] = React.useState('')
  const [mode, setMode] = React.useState<'123' | 'abc'>('123')
  const [pressed, setPressed] = React.useState<PhoneKey | null>(null)
  const [seenId, setSeenId] = React.useState<string | null>(null)
  const session = React.useRef<{ id: string; inputs: string[] } | null>(null)
  const lastTap = React.useRef<{ key: string; at: number; index: number } | null>(null)
  const scroller = React.useRef<HTMLDivElement>(null)
  const now = useNow(20_000)
  const { data } = useApi<{ messages: Message[] }>(`/api/sms?phone=${encodeURIComponent(phone)}`, seq)
  const messages = React.useMemo(() => data?.messages ?? [], [data])
  const seenIndex = seenId ? messages.findIndex((m) => m.id === seenId) : messages.length
  const unread = seenIndex < 0 ? messages.length : seenIndex

  const flash = (k: PhoneKey) => {
    setPressed(k)
    setTimeout(() => setPressed((p) => (p === k ? null : p)), 120)
  }

  const goHome = React.useCallback(() => {
    session.current = null
    setBuffer('')
    setMode('123')
    setView({ name: 'home' })
  }, [])

  const request = React.useCallback(
    async (inputs: string[]) => {
      setView({ name: 'busy' })
      try {
        const reply = await ussd({ sessionId: session.current!.id, phoneNumber: phone, text: inputs.join('*'), serviceCode: CODE })
        setView({ name: 'ussd', text: reply.text, ended: reply.type === 'END' })
        if (reply.type === 'END') session.current = null
      } catch {
        setView({ name: 'ussd', text: 'Connection problem. Please try again.', ended: true })
        session.current = null
      }
    },
    [phone],
  )

  const start = React.useCallback(async () => {
    session.current = { id: uuid(), inputs: [] }
    setBuffer('')
    setMode('123')
    await request([])
  }, [request])

  const submit = React.useCallback(
    async (value: string) => {
      if (!session.current || !value) return
      session.current.inputs.push(value)
      setBuffer('')
      setMode('123')
      await request([...session.current.inputs])
    },
    [request],
  )

  const openInbox = React.useCallback(() => {
    setSeenId(messages[0]?.id ?? null)
    setView({ name: 'inbox', index: 0 })
  }, [messages])

  const dialTyped = (typed: string) => {
    if (typed === CODE) void start()
    else {
      setBuffer('')
      setView({ name: 'notice', text: typed.startsWith('*') ? 'Unknown service code.\nTry *384*123#' : 'Calls are not part of this demo.\nDial *384*123#' })
    }
  }

  const openMenuItem = (index: number) => {
    const item = MENU[index]
    if (!item) return
    if (item.label === 'Messages') openInbox()
    else if (item.label === 'Agri-OS') void start()
    else setView({ name: 'notice', text: `${item.label} is not part of this demo.` })
  }

  const typeKey = (k: string) => {
    if (mode === 'abc' && MULTI_TAP[k]) {
      const letters = MULTI_TAP[k]
      const t = lastTap.current
      const at = Date.now()
      if (t && t.key === k && at - t.at < 1000) {
        const index = (t.index + 1) % letters.length
        lastTap.current = { key: k, at, index }
        setBuffer((b) => b.slice(0, -1) + letters[index])
      } else {
        lastTap.current = { key: k, at, index: 0 }
        setBuffer((b) => (b + letters[0]).slice(0, 40))
      }
      return
    }
    setBuffer((b) => (b + k).slice(0, 40))
  }

  const scroll = (dy: number) => scroller.current?.scrollBy({ top: dy, behavior: 'smooth' })

  const press = (k: PhoneKey) => {
    flash(k)
    const isPad = /^[0-9*#]$/.test(k)
    if (k === 'end') return goHome()
    switch (view.name) {
      case 'home':
        if (isPad) {
          setBuffer(k)
          setView({ name: 'dial' })
        } else if (k === 'ok') setView({ name: 'menu', index: 0 })
        else if (k === 'lsk') openInbox()
        return
      case 'dial':
        if (isPad) setBuffer((b) => (b + k).slice(0, 30))
        else if (k === 'call' || k === 'lsk' || k === 'ok') dialTyped(buffer)
        else if (k === 'rsk') {
          if (buffer.length <= 1) goHome()
          else setBuffer((b) => b.slice(0, -1))
        }
        return
      case 'menu': {
        const i = view.index
        if (k === 'rsk') goHome()
        else if (k === 'ok' || k === 'lsk') openMenuItem(i)
        else if (k === 'left') setView({ name: 'menu', index: (i + 8) % 9 })
        else if (k === 'right') setView({ name: 'menu', index: (i + 1) % 9 })
        else if (k === 'up') setView({ name: 'menu', index: (i + 6) % 9 })
        else if (k === 'down') setView({ name: 'menu', index: (i + 3) % 9 })
        else if (/^[1-9]$/.test(k)) openMenuItem(Number(k) - 1)
        return
      }
      case 'busy':
        return
      case 'ussd':
        if (view.ended) return goHome()
        if (k === 'rsk') {
          if (buffer) setBuffer((b) => b.slice(0, -1))
          else goHome()
        } else if (k === 'lsk' || k === 'ok' || k === 'call') void submit(buffer)
        else if (k === '#') setMode((m) => (m === '123' ? 'abc' : '123'))
        else if (k === 'up') scroll(-36)
        else if (k === 'down') scroll(36)
        else if (isPad) typeKey(k)
        return
      case 'inbox': {
        const i = view.index
        if (k === 'rsk') goHome()
        else if (k === 'up') setView({ name: 'inbox', index: Math.max(0, i - 1) })
        else if (k === 'down') setView({ name: 'inbox', index: Math.min(messages.length - 1, i + 1) })
        else if ((k === 'ok' || k === 'lsk') && messages[i]) setView({ name: 'message', id: messages[i].id, index: i })
        return
      }
      case 'message':
        if (k === 'rsk' || k === 'lsk') setView({ name: 'inbox', index: view.index })
        else if (k === 'up') scroll(-36)
        else if (k === 'down') scroll(36)
        return
      case 'notice':
        goHome()
        return
    }
  }

  React.useImperativeHandle(ref, () => ({
    async dial() {
      goHome()
      await sleep(250)
      setView({ name: 'dial' })
      for (const ch of CODE) {
        flash(ch as PhoneKey)
        setBuffer((b) => b + ch)
        await sleep(90)
      }
      flash('call')
      await sleep(160)
      await start()
    },
    async send(input: string) {
      for (const ch of input) {
        flash(ch as PhoneKey)
        setBuffer((b) => b + ch)
        await sleep(130)
      }
      flash('lsk')
      await sleep(160)
      await submit(input)
    },
    showInbox() {
      openInbox()
    },
    hangUp() {
      goHome()
    },
  }))

  const onKeyDown = (e: React.KeyboardEvent) => {
    const map: Record<string, PhoneKey> = { Enter: 'ok', Backspace: 'rsk', Escape: 'end', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }
    if (map[e.key]) {
      e.preventDefault()
      press(map[e.key])
    } else if (/^[0-9*#]$/.test(e.key)) {
      e.preventDefault()
      press(e.key as PhoneKey)
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && (view.name === 'ussd' || view.name === 'dial')) {
      // Letters straight from a keyboard (handy for typing a name when registering).
      e.preventDefault()
      setBuffer((b) => (b + e.key).slice(0, 40))
    }
  }

  const time = now ? catTime(new Date(now).toISOString(), false) : ''
  const message = view.name === 'message' ? messages.find((m) => m.id === view.id) : null

  const softKeys: { left?: string; center?: string; right?: string } = (() => {
    switch (view.name) {
      case 'home':
        return { left: 'Inbox', center: 'Menu' }
      case 'dial':
        return { left: 'Call', right: 'Clear' }
      case 'menu':
        return { center: 'Select', right: 'Exit' }
      case 'busy':
        return {}
      case 'ussd':
        return view.ended ? { center: 'OK' } : { left: buffer ? 'Send' : '', right: buffer ? 'Clear' : 'Exit' }
      case 'inbox':
        return { center: messages.length ? 'Open' : '', right: 'Back' }
      case 'message':
        return { right: 'Back' }
      case 'notice':
        return { center: 'OK' }
    }
  })()

  const screen = (() => {
    switch (view.name) {
      case 'home':
        return (
          <div className="absolute inset-0 flex flex-col items-center bg-[radial-gradient(120%_80%_at_70%_15%,#1d5a3a_0%,#0b2a1d_45%,#03100b_100%)] px-2 pt-6 text-center">
            <div className="text-[38px] leading-none font-light tracking-tight tabular">{time || '--:--'}</div>
            <div className="mt-1 text-[12px] text-white/80">{now ? catDate(now) : ''}</div>
            <div className="mt-auto mb-2 text-[11px] text-white/55">Dial *384*123# for buyer offers</div>
          </div>
        )
      case 'dial':
        return (
          <div className="flex h-full flex-col justify-end px-2 pb-1 text-right">
            <div className="text-[11px] text-white/55">Dialling</div>
            <div className="text-[25px] leading-tight font-light break-all tabular">
              {buffer}
              <span className="caret">|</span>
            </div>
          </div>
        )
      case 'menu': {
        const selected = MENU[view.index]
        return (
          <div className="flex h-full flex-col px-1.5">
            <div className="py-1 text-center text-[13px] font-bold">{selected.label}</div>
            <div className="grid flex-1 grid-cols-3 content-center gap-x-1 gap-y-2.5 pb-1">
              {MENU.map((item, i) => (
                <div key={item.label} className={cx('mx-auto flex h-[40px] w-[40px] items-center justify-center rounded-[11px]', i === view.index && 'ring-2 ring-white ring-offset-2 ring-offset-black')} style={{ background: item.color }}>
                  <item.icon size={21} color="white" strokeWidth={2.2} aria-hidden />
                </div>
              ))}
            </div>
          </div>
        )
      }
      case 'busy':
        return (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-[13px] text-white/85">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/25 border-t-white" aria-hidden />
            Please wait…
          </div>
        )
      case 'ussd':
        return (
          <div className="flex h-full flex-col">
            <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-2 pt-0.5 text-[12.5px] leading-[1.32] whitespace-pre-wrap">
              {view.text}
            </div>
            {!view.ended && (
              <div className="mx-1.5 mb-1 flex items-center rounded-[3px] bg-white px-1.5 py-[3px] text-[13px] leading-tight text-black">
                <span className="min-w-0 flex-1 truncate">
                  {buffer}
                  <span className="caret">|</span>
                </span>
                <span className="ml-1 text-[9.5px] font-bold text-black/55">{mode}</span>
              </div>
            )}
          </div>
        )
      case 'inbox':
        return (
          <div className="flex h-full flex-col">
            <div className="py-1 text-center text-[13px] font-bold">Inbox</div>
            {messages.length === 0 ? (
              <p className="px-2 pt-6 text-center text-[12px] text-white/70">No messages</p>
            ) : (
              <ul className="min-h-0 flex-1 overflow-hidden">
                {messages.slice(Math.max(0, view.index - 2), Math.max(0, view.index - 2) + 5).map((m) => {
                  const active = messages[view.index]?.id === m.id
                  return (
                    <li key={m.id} className={cx('border-b border-white/10 px-2 py-[3px]', active && 'bg-[#1d6fd6]')}>
                      <div className="flex justify-between text-[11.5px] font-bold">
                        <span>Agri-OS</span>
                        <span className="font-normal text-white/75">{catTime(m.createdAt, false)}</span>
                      </div>
                      <div className="truncate text-[11.5px] text-white/85">{m.body.replace(/^Agri-OS: /, '')}</div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      case 'message':
        return (
          <div className="flex h-full flex-col">
            <div className="border-b border-white/15 px-2 py-1">
              <div className="text-[12.5px] font-bold">Agri-OS</div>
              <div className="text-[10.5px] text-white/70">{message ? catTime(message.createdAt) : ''}</div>
            </div>
            <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-2 pt-1 text-[12.5px] leading-[1.32]">
              {message?.body.replace(/^Agri-OS: /, '')}
            </div>
          </div>
        )
      case 'notice':
        return <div className="flex h-full items-center justify-center px-3 text-center text-[12.5px] whitespace-pre-line">{view.text}</div>
    }
  })()

  return (
    <div className={cx('w-[236px]', className)}>
      <div
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-label={`${owner}'s phone. Type digits or letters, Enter to select or send, Backspace to clear, arrow keys to move, Escape to hang up.`}
        className="rounded-[32px] focus-visible:outline-offset-4"
      >
        <PhoneShell screen={<div aria-live="polite" className="h-full">{screen}</div>} softKeys={softKeys} time={time} unread={unread} onKey={press} pressed={pressed} />
      </div>
      <p className="mt-2 text-center text-sm text-ink-3">
        {owner}, <span className="tabular">{formatMsisdn(phone)}</span>
      </p>
    </div>
  )
}
