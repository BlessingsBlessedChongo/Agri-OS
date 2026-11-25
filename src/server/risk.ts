import { and, desc, eq, gte, isNull, or, sql } from 'drizzle-orm'
import type { CropCode } from '@/domain/produce'
import type { RiskFinding } from '@/domain/risk'
import { db, rows, type DbOrTx } from './db'
import { riskFlags } from './schema'
import type { Uow } from './uow'

export async function raiseFlag(u: Uow, finding: RiskFinding, districtId?: string | null) {
  const inserted = await u.tx
    .insert(riskFlags)
    .values({
      worldId: u.worldId,
      type: finding.type,
      severity: finding.severity,
      title: finding.title,
      explanation: finding.explanation,
      evidence: finding.evidence,
      districtId: districtId ?? null,
      dedupeKey: finding.dedupeKey,
    })
    .onConflictDoNothing()
    .returning({ id: riskFlags.id })
  if (inserted.length > 0) {
    u.emit({ type: 'risk.flagged', entityType: 'risk', entityId: inserted[0].id, actor: 'system', payload: { type: finding.type, severity: finding.severity, title: finding.title } })
  }
}

/** Median price per kg for a crop in a district over the last 60 days (last season's history plus this world). */
export async function districtMedianPrice(runner: DbOrTx, worldId: string, districtId: string, crop: CropCode) {
  const [r] = await rows<{ median: number | null; n: number }>(
    runner,
    sql`select percentile_disc(0.5) within group (order by unit_price_ngwee) as median, count(*)::int as n
        from invoices
        where kind = 'PRODUCE' and crop = ${crop} and district_id = ${districtId}
          and (world_id is null or world_id = ${worldId})
          and issued_at > now() - interval '60 days' and unit_price_ngwee is not null`,
  )
  return { median: r?.median ?? 0, sampleSize: r?.n ?? 0 }
}

export async function listFlags(worldId: string, limit = 50) {
  return db
    .select()
    .from(riskFlags)
    .where(and(or(isNull(riskFlags.worldId), eq(riskFlags.worldId, worldId)), gte(riskFlags.createdAt, new Date(0))))
    .orderBy(desc(riskFlags.createdAt))
    .limit(limit)
}
