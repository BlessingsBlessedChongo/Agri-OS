/**
 * Load test for the USSD endpoint (the hot path: every farmer keypress is a request).
 *   npm run build && npm start, then: npm run loadtest
 * Prints requests per second and latency for the main menu and the trade-record screen (the heaviest one).
 */
import autocannon from 'autocannon'

const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const DURATION = Number(process.env.DURATION ?? 15)
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 20)

const created = await fetch(`${BASE}/api/world?reset=1`, { method: 'POST' })
const cookie = (created.headers.get('set-cookie') ?? '').split(';')[0]
if (!cookie) throw new Error('Could not create a sandbox')

async function run(label, text) {
  const result = await autocannon({
    url: `${BASE}/api/ussd`,
    method: 'POST',
    connections: CONNECTIONS,
    duration: DURATION,
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ sessionId: 'load-test', serviceCode: '*384*123#', phoneNumber: '+260955410101', text }).toString(),
  })
  console.log(
    `${label.padEnd(22)} ${String(Math.round(result.requests.average)).padStart(5)} req/s   p50 ${result.latency.p50} ms   p99 ${result.latency.p99} ms   errors ${result.errors}   non-2xx ${result.non2xx}`,
  )
}

console.log(`USSD load test: ${CONNECTIONS} connections, ${DURATION} s each, against ${BASE}`)
await run('Main menu', '')
await run('Trade record (scored)', '4')
