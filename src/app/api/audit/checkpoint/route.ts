import { db } from '@/server/db'
import { chainHead, signCheckpoint } from '@/server/events'
import { json, worldRoute } from '@/server/http'
import { publicKeyInfo } from '@/server/signing'

/** A signed statement of the trail's head: keep it, and the history up to that point can never be quietly rewritten. */
export const GET = worldRoute(async (_request, { world }) => {
  const head = await chainHead(db, world.id)
  return json({ checkpoint: signCheckpoint(world.id, head?.seq ?? 0, head?.hash ?? '0'.repeat(64)), publicKey: publicKeyInfo() })
})
