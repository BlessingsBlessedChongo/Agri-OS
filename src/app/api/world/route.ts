import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/server/db'
import { chainHead } from '@/server/events'
import { clientIp, json, route } from '@/server/http'
import { farmers } from '@/server/schema'
import { ipFingerprint } from '@/server/signing'
import { createWorld, getWorld, purgeWorld, WORLD_COOKIE, worldIdFrom, type World } from '@/server/world'

const cookie = { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 }

async function describe(world: World) {
  const head = await chainHead(db, world.id)
  const [guide] = await db.select({ id: farmers.id, name: farmers.name, phone: farmers.phone }).from(farmers).where(and(isNull(farmers.worldId), eq(farmers.code, 'F-0001')))
  return { id: world.id, kind: world.kind, chaos: world.chaos, createdAt: world.createdAt, events: head?.seq ?? 0, guide: guide ?? null }
}

/** The visitor's sandbox, if they have one. */
export const GET = route(async (request) => {
  const id = worldIdFrom(request)
  const world = id ? await getWorld(id) : null
  return json({ world: world ? await describe(world) : null })
})

/** Creates a sandbox (or returns the current one). `?reset=1` throws the current one away and starts fresh. */
export const POST = route(async (request) => {
  const id = worldIdFrom(request)
  const existing = id ? await getWorld(id) : null
  const reset = new URL(request.url).searchParams.get('reset') === '1'
  if (existing && !reset) return json({ world: await describe(existing) })
  if (existing && existing.kind === 'sandbox') await purgeWorld(existing.id)
  const world = await createWorld({ ipHash: ipFingerprint(clientIp(request)) })
  const response = json({ world: await describe(world) }, { status: 201 })
  response.cookies.set(WORLD_COOKIE, world.id, cookie)
  return response
})
