/** Thin fetch wrapper for the browser. Errors carry the API's own message and code. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const response = await fetch(path, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: init.body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: 'same-origin',
    cache: 'no-store',
    signal: init.signal,
  })
  const text = await response.text()
  const json = text ? safeJson(text) : null
  if (!response.ok) {
    const error = (json as { error?: { message?: string; code?: string } } | null)?.error
    throw new ApiError(error?.message ?? `Request failed (${response.status})`, response.status, error?.code ?? 'HTTP_ERROR')
  }
  return json as T
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** USSD speaks form-encoded text, like Africa's Talking. */
export async function ussd(input: { sessionId: string; phoneNumber: string; text: string; serviceCode?: string }): Promise<{ type: 'CON' | 'END'; text: string }> {
  const body = new URLSearchParams({ sessionId: input.sessionId, phoneNumber: input.phoneNumber, text: input.text, serviceCode: input.serviceCode ?? '*384*123#' })
  const response = await fetch('/api/ussd', { method: 'POST', body, credentials: 'same-origin', cache: 'no-store' })
  const reply = await response.text()
  const type = reply.startsWith('CON ') ? 'CON' : 'END'
  return { type, text: reply.replace(/^(CON|END) /, '') }
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong'
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** UUID v4 in any browser (crypto.randomUUID needs a secure context). */
export function uuid(): string {
  const c = globalThis.crypto
  if (typeof c.randomUUID === 'function') return c.randomUUID()
  const bytes = c.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
