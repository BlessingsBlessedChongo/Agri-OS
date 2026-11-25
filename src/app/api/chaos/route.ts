import { z } from 'zod'
import { CHAOS_PRESETS, normalizeChaos } from '@/domain/chaos'
import { json, readBody, worldRoute } from '@/server/http'
import { getWorld, setChaos } from '@/server/world'

export const GET = worldRoute(async (_request, { world }) => json({ chaos: world.chaos, presets: CHAOS_PRESETS }))

const input = z.union([
  z.object({ preset: z.enum(['calm', 'rough', 'storm', 'theft']) }),
  z.object({ settings: z.record(z.string(), z.number()) }),
])

/** How badly the simulated outside world behaves in this sandbox. */
export const PUT = worldRoute(async (request, { world }) => {
  const body = await readBody(request, input)
  const settings = 'preset' in body ? CHAOS_PRESETS[body.preset].settings : normalizeChaos({ ...world.chaos, ...body.settings })
  await setChaos(world.id, settings)
  return json({ chaos: (await getWorld(world.id))!.chaos })
})
