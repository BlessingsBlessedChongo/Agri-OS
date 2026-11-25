import * as React from 'react'

/**
 * A candybar feature phone: earpiece, a small colour screen in a glossy bezel, soft keys either side of a four-way
 * D-pad, call and end keys, and a pill-key number pad with letters beside each digit. Purely presentational: the
 * interactive phone (feature-phone.tsx) and the static picture on the home page both draw it. No maker's branding.
 */
export type PhoneKey =
  | 'lsk' | 'rsk' | 'ok' | 'up' | 'down' | 'left' | 'right' | 'call' | 'end'
  | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '*' | '0' | '#'

const PAD: Array<[PhoneKey, string]> = [
  ['1', 'oo'], ['2', 'abc'], ['3', 'def'],
  ['4', 'ghi'], ['5', 'jkl'], ['6', 'mno'],
  ['7', 'pqrs'], ['8', 'tuv'], ['9', 'wxyz'],
  ['*', '+'], ['0', '⎵'], ['#', '⇧'],
]

const KEY_LABEL: Partial<Record<PhoneKey, string>> = {
  lsk: 'Left soft key',
  rsk: 'Right soft key',
  ok: 'Select',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  call: 'Call',
  end: 'End call',
  '*': 'Star',
  '#': 'Hash',
}

const keyFace =
  'border border-black/80 bg-[linear-gradient(180deg,#2c2d30,#1a1b1d)] text-[#ededed] shadow-[inset_0_1px_0_rgba(255,255,255,0.13),0_1px_1px_rgba(0,0,0,0.55)]'

function Key({ k, onKey, pressed, className, children }: { k: PhoneKey; onKey?: (k: PhoneKey) => void; pressed?: PhoneKey | null; className?: string; children?: React.ReactNode }) {
  const style = `flex items-center justify-center select-none transition-[transform,filter] duration-75 ${pressed === k ? 'translate-y-px brightness-150' : onKey ? 'hover:brightness-125' : ''} ${className ?? ''}`
  if (!onKey) return <span className={style}>{children}</span>
  return (
    <button type="button" tabIndex={-1} onClick={() => onKey(k)} aria-label={KEY_LABEL[k] ?? k} className={style}>
      {children}
    </button>
  )
}

function SignalBars() {
  return (
    <svg viewBox="0 0 14 10" width={13} height={9} aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={i * 3.6} y={8 - i * 2.4} width={2.4} height={2 + i * 2.4} rx={0.4} fill="currentColor" />
      ))}
    </svg>
  )
}

function Battery() {
  return (
    <svg viewBox="0 0 20 10" width={18} height={9} aria-hidden>
      <rect x={0.6} y={0.6} width={16.5} height={8.8} rx={1.6} fill="none" stroke="currentColor" strokeWidth={1.2} />
      <rect x={17.6} y={3.2} width={1.8} height={3.6} rx={0.6} fill="currentColor" />
      <rect x={2.2} y={2.2} width={11} height={5.6} rx={0.6} fill="#4ade80" />
    </svg>
  )
}

function Envelope() {
  return (
    <svg viewBox="0 0 14 10" width={13} height={9} aria-hidden>
      <rect x={0.6} y={0.6} width={12.8} height={8.8} rx={1.2} fill="none" stroke="currentColor" strokeWidth={1.2} />
      <path d="M1 1.4 L7 5.8 L13 1.4" fill="none" stroke="currentColor" strokeWidth={1.2} />
    </svg>
  )
}

export interface PhoneShellProps {
  screen: React.ReactNode
  softKeys: { left?: string; center?: string; right?: string }
  time?: string
  unread?: number
  onKey?: (key: PhoneKey) => void
  pressed?: PhoneKey | null
  className?: string
}

export function PhoneShell({ screen, softKeys, time = '', unread = 0, onKey, pressed, className }: PhoneShellProps) {
  return (
    <div
      className={`w-[236px] rounded-[32px] bg-[linear-gradient(180deg,#26272a_0%,#1b1c1e_35%,#161719_100%)] px-[13px] pt-[15px] pb-3 shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.07),inset_0_4px_10px_rgba(255,255,255,0.05),0_24px_46px_-22px_rgba(0,0,0,0.78)] ${className ?? ''}`}
    >
      {/* earpiece */}
      <div className="mx-auto h-[5px] w-[46px] rounded-full bg-[#050505] shadow-[inset_0_1px_1px_rgba(255,255,255,0.14)]" aria-hidden />

      {/* glossy front panel and the screen */}
      <div className="mt-[22px] rounded-[12px] bg-[linear-gradient(160deg,#141516,#070708_55%)] p-[10px] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
        <div className="relative flex aspect-[176/226] flex-col overflow-hidden rounded-[2px] bg-black text-white shadow-[0_0_0_1px_rgba(255,255,255,0.04)]">
          <div className="relative z-10 flex items-center justify-between px-1.5 pt-[3px] pb-[2px] text-[10px] leading-none font-semibold text-white/90">
            <span className="flex items-center gap-1">
              <SignalBars /> ZM
            </span>
            <span className="flex items-center gap-1.5">
              {unread > 0 && (
                <span className="flex items-center gap-0.5" aria-label={`${unread} unread messages`}>
                  <Envelope />
                  {unread}
                </span>
              )}
              <span className="tabular">{time}</span>
              <Battery />
            </span>
          </div>
          <div className="relative min-h-0 flex-1">{screen}</div>
          <div className="relative z-10 grid grid-cols-3 items-center bg-black px-1.5 pt-[2px] pb-[4px] text-[11.5px] leading-tight font-bold text-white" aria-hidden>
            <span className="truncate text-left">{softKeys.left ?? ''}</span>
            <span className="truncate text-center">{softKeys.center ?? ''}</span>
            <span className="truncate text-right">{softKeys.right ?? ''}</span>
          </div>
        </div>
      </div>

      {/* navigation: soft keys, four-way D-pad, call and end */}
      <div className="mt-4 grid grid-cols-[1fr_56px_1fr] grid-rows-2 items-center gap-x-2 gap-y-[9px]">
        <Key k="lsk" onKey={onKey} pressed={pressed} className={`h-[24px] rounded-full ${keyFace}`}>
          <span className="h-[2px] w-[22px] rounded bg-white/75" />
        </Key>
        <div className={`relative row-span-2 mx-auto h-[56px] w-[54px] rounded-[17px] ${keyFace}`}>
          <Key k="up" onKey={onKey} pressed={pressed} className="absolute top-0 right-[14px] left-[14px] h-[15px]" />
          <Key k="down" onKey={onKey} pressed={pressed} className="absolute right-[14px] bottom-0 left-[14px] h-[15px]" />
          <Key k="left" onKey={onKey} pressed={pressed} className="absolute top-[14px] bottom-[14px] left-0 w-[14px]" />
          <Key k="right" onKey={onKey} pressed={pressed} className="absolute top-[14px] right-0 bottom-[14px] w-[14px]" />
          <Key k="ok" onKey={onKey} pressed={pressed} className="absolute inset-[13px] rounded-[9px] border border-white/15 bg-[#1d1e20] shadow-[inset_0_1px_3px_rgba(0,0,0,0.7)]" />
        </div>
        <Key k="rsk" onKey={onKey} pressed={pressed} className={`h-[24px] rounded-full ${keyFace}`}>
          <span className="h-[2px] w-[22px] rounded bg-white/75" />
        </Key>
        <Key k="call" onKey={onKey} pressed={pressed} className={`h-[24px] rounded-full ${keyFace}`}>
          <svg viewBox="0 0 24 12" width={22} height={11} aria-hidden>
            <path d="M1.5 9.2 C2 2.6 22 2.6 22.5 9.2 L17.8 9.6 L17 6.9 C13.8 6 10.2 6 7 6.9 L6.2 9.6 Z" fill="none" stroke="#ececec" strokeWidth={1.5} strokeLinejoin="round" />
          </svg>
        </Key>
        <Key k="end" onKey={onKey} pressed={pressed} className={`h-[24px] rounded-full ${keyFace}`}>
          <svg viewBox="0 0 16 16" width={13} height={13} aria-hidden>
            <path d="M4.6 4.6 A5.4 5.4 0 1 0 11.4 4.6" fill="none" stroke="#ececec" strokeWidth={1.6} strokeLinecap="round" />
            <path d="M8 1.8 L8 7.6" stroke="#ececec" strokeWidth={1.6} strokeLinecap="round" />
          </svg>
        </Key>
      </div>

      {/* number pad */}
      <div className="mt-[11px] grid grid-cols-3 gap-x-[7px] gap-y-[7px]">
        {PAD.map(([k, letters]) => (
          <Key key={k} k={k} onKey={onKey} pressed={pressed} className={`relative h-[29px] gap-[5px] rounded-full ${keyFace}`}>
            {k === '5' && <span className="absolute left-[16px] h-[3px] w-[3px] rounded-full bg-white/55" aria-hidden />}
            <span className={k === '*' ? 'text-[17px] leading-none' : 'text-[16px] leading-none font-medium'}>{k === '*' ? '✱' : k}</span>
            <span className="text-[9.5px] leading-none text-white/60">{letters}</span>
            {k === '5' && <span className="absolute right-[16px] h-[3px] w-[3px] rounded-full bg-white/55" aria-hidden />}
          </Key>
        ))}
      </div>

      {/* microphone */}
      <div className="mx-auto mt-[11px] h-[4px] w-[4px] rounded-full bg-black shadow-[0_1px_0_rgba(255,255,255,0.08)]" aria-hidden />
    </div>
  )
}
