import { z } from 'zod'
import { DEFAULT_TAX_RULES } from '@/domain/tax'
import { db } from '@/server/db'
import { notFound } from '@/server/errors'
import { json, readBody, worldRoute } from '@/server/http'
import { effectiveTaxRules } from '@/server/reference'
import { taxRules } from '@/server/schema'
import { inWorld } from '@/server/uow'

export const GET = worldRoute(async (_request, { world }) => json({ rules: await effectiveTaxRules(db, world.id), defaults: DEFAULT_TAX_RULES }))

const change = z.object({
  code: z.string(),
  rateBp: z.number().int().min(0).max(3000),
  enabled: z.boolean(),
  collection: z.enum(['REMIT', 'RECORD']).optional(),
})

/** Tax is data: change a rule in this sandbox and the next settlement and invoice follow it. */
export const PUT = worldRoute(async (request, { world }) => {
  const input = await readBody(request, change)
  const base = DEFAULT_TAX_RULES.find((r) => r.code === input.code)
  if (!base) throw notFound('Tax rule')
  const collection = base.kind === 'WITHHOLDING' ? 'REMIT' : (input.collection ?? base.collection)
  await inWorld(world.id, async (u) => {
    await u.tx
      .insert(taxRules)
      .values({ worldId: world.id, code: base.code, name: base.name, kind: base.kind, base: base.base, appliesWhen: base.appliesWhen, note: base.note, rateBp: input.rateBp, enabled: input.enabled, collection })
      .onConflictDoUpdate({ target: [taxRules.worldId, taxRules.code], set: { rateBp: input.rateBp, enabled: input.enabled, collection, updatedAt: new Date() } })
    u.emit({ type: 'tax.rule_changed', entityType: 'tax_rule', entityId: base.code, actor: 'visitor', payload: { code: base.code, rateBp: input.rateBp, enabled: input.enabled, collection } })
  })
  return json({ rules: await effectiveTaxRules(db, world.id) })
})
