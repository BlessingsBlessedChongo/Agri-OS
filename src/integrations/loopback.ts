import { receiveZamtelWebhook } from '@/server/webhooks'
import { random } from '@/server/random'
import { registerLoopback, type OutboundRequest } from './transport'
import { handleVsdcRequest } from './vsdc/simulator'
import { handleZamtelRequest } from './zamtel/simulator'

/**
 * In loopback mode (tests), outbound HTTP to the simulators and back to the webhook endpoint is routed here
 * in-process. The handlers are exactly the ones the HTTP routes use.
 */
function parse(request: OutboundRequest, prefix: string) {
  const url = new URL(request.url)
  const rest = url.pathname.slice(prefix.length).split('/')
  const worldId = rest.shift() ?? ''
  return { url, worldId, path: `/${rest.join('/')}` }
}

const lowerHeaders = (headers: Record<string, string>) => Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
const body = (text?: string) => (text ? JSON.parse(text) : undefined)

registerLoopback('/api/sim/zamtel/', async (request) => {
  const { url, worldId, path } = parse(request, '/api/sim/zamtel/')
  const res = await handleZamtelRequest({ worldId, method: request.method, path: path.replace(/^\/v1/, ''), query: url.searchParams, headers: lowerHeaders(request.headers), body: body(request.body) }, random)
  return { status: res.status, text: JSON.stringify(res.body), delayMs: res.delayMs }
})

registerLoopback('/api/sim/vsdc/', async (request) => {
  const { url, worldId, path } = parse(request, '/api/sim/vsdc/')
  const res = await handleVsdcRequest({ worldId, method: request.method, path, query: url.searchParams, headers: lowerHeaders(request.headers), body: body(request.body) }, random)
  return { status: res.status, text: JSON.stringify(res.body), delayMs: res.delayMs }
})

registerLoopback('/api/webhooks/zamtel/', async (request) => {
  const { worldId } = parse(request, '/api/webhooks/zamtel/')
  const headers = lowerHeaders(request.headers)
  const res = await receiveZamtelWebhook(worldId, request.body ?? '', headers['x-zamtel-signature'] ?? null)
  return { status: res.status, text: JSON.stringify(res.body), delayMs: 0 }
})
