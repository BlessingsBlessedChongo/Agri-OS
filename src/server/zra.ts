import { sql } from 'drizzle-orm'
import type { CropCode } from '@/domain/produce'
import { db, rows } from './db'

/**
 * The tax authority's view. Everything comes from invoices (last season's shared history plus this world's live
 * trades), because an invoice accepted by the VSDC is exactly the trail ZRA can rely on.
 */
const visible = (worldId: string) => sql`(world_id is null or world_id = ${worldId})`

export async function zraOverview(worldId: string) {
  const [season] = await rows<{
    produce_value: number
    grams: number
    farmers: number
    produce_invoices: number
    invoices: number
    tax_to_zra: number
    vat_recorded: number
    buyers: number
  }>(
    db,
    sql`select coalesce(sum(subtotal_ngwee) filter (where kind = 'PRODUCE'), 0)::bigint as produce_value,
               coalesce(sum(quantity_grams) filter (where kind = 'PRODUCE'), 0)::bigint as grams,
               count(distinct seller_id) filter (where kind = 'PRODUCE')::int as farmers,
               count(*) filter (where kind = 'PRODUCE')::int as produce_invoices,
               count(*)::int as invoices,
               (coalesce(sum(vat_ngwee) filter (where kind = 'SERVICE'), 0) + coalesce(sum(withholding_ngwee), 0))::bigint as tax_to_zra,
               coalesce(sum(vat_ngwee) filter (where kind = 'TRANSPORT'), 0)::bigint as vat_recorded,
               count(distinct buyer_id)::int as buyers
        from invoices where ${visible(worldId)} and issued_at > now() - interval '200 days'`,
  )
  const [live] = await rows<{ produce_value: number; invoices: number; tax_to_zra: number; pending: number }>(
    db,
    sql`select coalesce(sum(subtotal_ngwee) filter (where kind = 'PRODUCE'), 0)::bigint as produce_value,
               count(*)::int as invoices,
               (coalesce(sum(vat_ngwee) filter (where kind = 'SERVICE'), 0) + coalesce(sum(withholding_ngwee), 0))::bigint as tax_to_zra,
               count(*) filter (where vsdc_status = 'PENDING')::int as pending
        from invoices where world_id = ${worldId}`,
  )
  const byDistrict = await rows<{ district_id: string; value: number; grams: number; invoices: number; live: number }>(
    db,
    sql`select district_id, sum(subtotal_ngwee)::bigint as value, sum(quantity_grams)::bigint as grams, count(*)::int as invoices,
               count(*) filter (where world_id is not null)::int as live
        from invoices where ${visible(worldId)} and kind = 'PRODUCE' and issued_at > now() - interval '200 days'
        group by district_id`,
  )
  const byCrop = await rows<{ crop: CropCode; value: number; grams: number }>(
    db,
    sql`select crop, sum(subtotal_ngwee)::bigint as value, sum(quantity_grams)::bigint as grams
        from invoices where ${visible(worldId)} and kind = 'PRODUCE' and issued_at > now() - interval '200 days'
        group by crop order by value desc`,
  )
  return {
    season: {
      produceValueNgwee: Number(season.produce_value),
      grams: Number(season.grams),
      farmers: season.farmers,
      produceInvoices: season.produce_invoices,
      invoices: season.invoices,
      taxToZraNgwee: Number(season.tax_to_zra),
      vatRecordedNgwee: Number(season.vat_recorded),
      buyers: season.buyers,
    },
    live: { produceValueNgwee: Number(live.produce_value), invoices: live.invoices, taxToZraNgwee: Number(live.tax_to_zra), pendingAtVsdc: live.pending },
    byDistrict: byDistrict.map((d) => ({ districtId: d.district_id, valueNgwee: Number(d.value), grams: Number(d.grams), invoices: d.invoices, live: d.live })),
    byCrop: byCrop.map((c) => ({ crop: c.crop, valueNgwee: Number(c.value), grams: Number(c.grams) })),
  }
}

/** Weekly median price per kg for one crop, with the middle half of prices as a band. */
export async function priceIndex(worldId: string, crop: CropCode) {
  const weeks = await rows<{ week: Date; median: number; p25: number; p75: number; n: number }>(
    db,
    sql`select date_trunc('week', issued_at) as week,
               percentile_disc(0.5) within group (order by unit_price_ngwee) as median,
               percentile_disc(0.25) within group (order by unit_price_ngwee) as p25,
               percentile_disc(0.75) within group (order by unit_price_ngwee) as p75,
               count(*)::int as n
        from invoices
        where ${visible(worldId)} and kind = 'PRODUCE' and crop = ${crop} and unit_price_ngwee is not null and issued_at > now() - interval '200 days'
        group by 1 order by 1`,
  )
  return weeks.map((w) => ({ week: new Date(w.week).toISOString().slice(0, 10), medianNgwee: w.median, p25Ngwee: w.p25, p75Ngwee: w.p75, sales: w.n }))
}
