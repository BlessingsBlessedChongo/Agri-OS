import { sql } from 'drizzle-orm'
import { config } from '@/server/config'
import { db } from '@/server/db'
import { json, route } from '@/server/http'
import { keys } from '@/server/signing'

export const GET = route(async () => {
  const started = Date.now()
  let database: 'ok' | 'down' = 'ok'
  try {
    await db.execute(sql`select 1`)
  } catch {
    database = 'down'
  }
  let signing: 'ok' | 'missing' = 'ok'
  try {
    keys()
  } catch {
    signing = 'missing'
  }
  const ok = database === 'ok' && signing === 'ok'
  return json({ ok, database, signing, providerTransport: config.providerTransport(), latencyMs: Date.now() - started }, { status: ok ? 200 : 503 })
})
