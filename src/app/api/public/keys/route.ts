import { json, route } from '@/server/http'
import { publicKeyInfo } from '@/server/signing'

/** Agri-OS's public signing key: verify any invoice or audit checkpoint offline with it (Ed25519). */
export const GET = route(async () => json({ keys: [publicKeyInfo()] }, { headers: { 'cache-control': 'public, max-age=3600' } }))
