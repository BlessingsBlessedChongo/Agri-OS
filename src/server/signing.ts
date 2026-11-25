import { createHash, createHmac, createPrivateKey, createPublicKey, sign, timingSafeEqual, verify, type KeyObject } from 'node:crypto'

/**
 * One 32-byte secret (SIGNING_SEED) gives Agri-OS its Ed25519 signing key (invoices, audit checkpoints) and, through
 * HMAC derivation, every shared secret the simulators use (weighbridge devices, webhook signatures, VSDC receipts).
 */
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')

interface Keys {
  seed: Buffer
  privateKey: KeyObject
  publicKey: KeyObject
  keyId: string
}

let cached: Keys | null = null

function readSeed(): Buffer {
  const hex = process.env.SIGNING_SEED
  if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, 'hex')
  if (hex) throw new Error('SIGNING_SEED must be 64 hexadecimal characters (32 bytes).')
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SIGNING_SEED !== 'true') {
    throw new Error('SIGNING_SEED is not set. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"')
  }
  return createHash('sha256').update('agri-os development seed (not secret)').digest()
}

export function keys(): Keys {
  if (cached) return cached
  const seed = readSeed()
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: 'der', type: 'pkcs8' })
  const publicKey = createPublicKey(privateKey)
  const spki = publicKey.export({ format: 'der', type: 'spki' })
  cached = { seed, privateKey, publicKey, keyId: createHash('sha256').update(spki).digest('hex').slice(0, 16) }
  return cached
}

export function signText(text: string): string {
  return sign(null, Buffer.from(text, 'utf8'), keys().privateKey).toString('base64url')
}

export function verifyText(text: string, signature: string): boolean {
  try {
    return verify(null, Buffer.from(text, 'utf8'), keys().publicKey, Buffer.from(signature, 'base64url'))
  } catch {
    return false
  }
}

export function publicKeyInfo() {
  const k = keys()
  return {
    keyId: k.keyId,
    algorithm: 'Ed25519',
    jwk: k.publicKey.export({ format: 'jwk' }),
    spkiPem: k.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
  }
}

/** A secret for one purpose, derived from the seed so nothing else needs configuring. */
export function derivedSecret(purpose: string): Buffer {
  return createHmac('sha256', keys().seed).update(`agri-os:${purpose}`).digest()
}

export function hmacHex(secret: Buffer | string, text: string): string {
  return createHmac('sha256', secret).update(text, 'utf8').digest('hex')
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export function webhookSecret(): Buffer | string {
  return process.env.ZAMTEL_WEBHOOK_SECRET || derivedSecret('zamtel-webhook')
}

/** Short one-way fingerprint for an IP address (used only to rate-limit sandbox creation). */
export function ipFingerprint(ip: string): string {
  return hmacHex(derivedSecret('ip'), ip).slice(0, 24)
}
