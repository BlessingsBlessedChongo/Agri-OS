/** Short, readable references that fit on a USSD screen and an SMS: AGR-0042, GRN-0107, CON-012. */
export function formatRef(prefix: string, n: number, width = 4): string {
  return `${prefix}-${String(n).padStart(width, '0')}`
}

/** Crockford-style alphabet without 0/O, 1/I/L or U, so codes survive being read aloud or typed on a keypad. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'

export function randomCode(length = 6): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length]
  return out
}

/** Zambian mobile numbers: +260 followed by 9 digits (Zamtel numbers start 095). */
export function normalizeMsisdn(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '')
  let m = /^\+?260(\d{9})$/.exec(digits)
  if (m) return `+260${m[1]}`
  m = /^0(\d{9})$/.exec(digits)
  if (m) return `+260${m[1]}`
  return null
}

export function formatMsisdn(msisdn: string): string {
  const m = /^\+260(\d{2})(\d{3})(\d{4})$/.exec(msisdn)
  return m ? `+260 ${m[1]} ${m[2]} ${m[3]}` : msisdn
}

export function maskMsisdn(msisdn: string): string {
  const m = /^\+260(\d{2})\d{3}(\d{4})$/.exec(msisdn)
  return m ? `+260 ${m[1]} ••• ${m[2]}` : msisdn
}
