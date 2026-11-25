import { lookupShare } from '@/server/credit'
import { notFound } from '@/server/errors'
import { json, route } from '@/server/http'

/** Public: what a lender sees for a share code the farmer gave them. No phone number, nothing beyond the record. */
export const GET = route<{ code: string }>(async (_request, { params }) => {
  const share = /^[2-9A-HJ-NP-TV-Z]{6}$/i.test(params.code) ? await lookupShare(params.code) : null
  if (!share) throw notFound('Share code (it may have expired)')
  return json(share)
})
