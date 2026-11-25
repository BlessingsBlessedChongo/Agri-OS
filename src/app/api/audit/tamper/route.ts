import { tamper, undoTamper } from '@/server/demo'
import { json, worldRoute } from '@/server/http'

/**
 * Plays an insider with database access: changes a recorded amount behind the application's back (sandboxes only).
 * The database's append-only guard is deliberately bypassed here; the hash chain still exposes the change.
 */
export const POST = worldRoute(async (_request, { world }) => json({ tampered: await tamper(world.id) }))

/** Puts the original back, after which the chain verifies again. */
export const DELETE = worldRoute(async (_request, { world }) => json({ restored: await undoTamper(world.id) }))
