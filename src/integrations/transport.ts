import { config } from '@/server/config'

/**
 * How Agri-OS reaches outside systems. In the running app this is real HTTP (to the simulators' URLs, exactly as it
 * would be to Zamtel or ZRA). In tests it is a loopback that calls the simulators in-process, with the same request
 * and response shapes, and the same timeout semantics: a provider that answers too late is treated as unknown.
 */
export interface OutboundRequest {
  method: 'GET' | 'POST'
  url: string
  headers: Record<string, string>
  body?: string
  timeoutMs?: number
}

export interface OutboundResponse {
  status: number
  text: string
}

export class ProviderTimeoutError extends Error {
  constructor(url: string) {
    super(`No answer from ${new URL(url).pathname} in time`)
    this.name = 'ProviderTimeoutError'
  }
}

export class ProviderNetworkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderNetworkError'
  }
}

export type LoopbackHandler = (request: OutboundRequest) => Promise<OutboundResponse & { delayMs: number }>

const loopbackRoutes: Array<{ prefix: string; handler: LoopbackHandler }> = []

/** Simulators register themselves for loopback mode (see src/integrations/loopback.ts). */
export function registerLoopback(prefix: string, handler: LoopbackHandler) {
  loopbackRoutes.push({ prefix, handler })
}

export async function send(request: OutboundRequest): Promise<OutboundResponse> {
  const timeoutMs = request.timeoutMs ?? config.providerTimeoutMs()
  if (config.providerTransport() === 'loopback') {
    const path = new URL(request.url).pathname
    const route = loopbackRoutes.find((r) => path.startsWith(r.prefix))
    if (!route) throw new ProviderNetworkError(`No loopback route for ${path}`)
    const response = await route.handler(request)
    if (response.delayMs > timeoutMs) throw new ProviderTimeoutError(request.url)
    return { status: response.status, text: response.text }
  }
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    })
    return { status: response.status, text: await response.text() }
  } catch (error) {
    const name = (error as Error)?.name
    if (name === 'TimeoutError' || name === 'AbortError') throw new ProviderTimeoutError(request.url)
    throw new ProviderNetworkError((error as Error)?.message ?? 'Network error')
  }
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
