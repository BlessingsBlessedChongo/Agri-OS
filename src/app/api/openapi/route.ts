import { config } from '@/server/config'
import { json, route } from '@/server/http'
import { openApiDocument } from '@/server/openapi'

export const GET = route(async () => json(openApiDocument(config.appUrl()), { headers: { 'cache-control': 'public, max-age=300' } }))
