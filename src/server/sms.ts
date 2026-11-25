import { and, desc, eq } from 'drizzle-orm'
import { words, type Words } from '@/ussd/i18n'
import { config } from './config'
import { db } from './db'
import { enqueue } from './jobs'
import { languageOf, type Farmer } from './reference'
import { smsMessages } from './schema'
import type { Uow } from './uow'
import { LIVE_WORLD_ID } from './world'

/**
 * Text messages go into an outbox and are sent by a job. In a sandbox they land in the phone simulator's inbox;
 * in the live world they go out through Africa's Talking, except to seeded (fictional) people, who never get one.
 */
export async function queueSms(u: Uow, input: { to: string; body: string; kind: string; external: boolean }) {
  const [row] = await u.tx.insert(smsMessages).values({ worldId: u.worldId, toPhone: input.to, body: input.body, kind: input.kind }).returning({ id: smsMessages.id })
  await enqueue(u.tx, u.worldId, 'sms.send', { smsId: row.id, external: input.external }, { delayMs: 250 })
}

export async function smsFarmer(u: Uow, farmer: Farmer, kind: string, build: (w: Words) => string) {
  const lang = await languageOf(u.tx, u.worldId, farmer)
  await queueSms(u, { to: farmer.phone, body: build(words(lang)), kind, external: u.worldId === LIVE_WORLD_ID && !farmer.fictional })
}

export async function sendSms(worldId: string, smsId: string, external: boolean): Promise<void> {
  const [sms] = await db.select().from(smsMessages).where(and(eq(smsMessages.id, smsId), eq(smsMessages.worldId, worldId)))
  if (!sms || sms.status !== 'QUEUED') return
  const at = config.africasTalking()
  if (external && at) {
    const messageId = await sendViaAfricasTalking(at, sms.toPhone, sms.body)
    await db.update(smsMessages).set({ status: 'SENT', providerMessageId: messageId, sentAt: new Date() }).where(eq(smsMessages.id, smsId))
    return
  }
  await db.update(smsMessages).set({ status: 'DELIVERED_TO_SIMULATOR', sentAt: new Date() }).where(eq(smsMessages.id, smsId))
}

async function sendViaAfricasTalking(at: { username: string; apiKey: string; senderId?: string }, to: string, message: string): Promise<string> {
  const host = at.username === 'sandbox' ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com'
  const form = new URLSearchParams({ username: at.username, to, message })
  if (at.senderId) form.set('from', at.senderId)
  const response = await fetch(`${host}/version1/messaging`, {
    method: 'POST',
    headers: { apiKey: at.apiKey, accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
    signal: AbortSignal.timeout(8000),
  })
  const json = (await response.json().catch(() => null)) as { SMSMessageData?: { Recipients?: Array<{ status: string; messageId: string }> } } | null
  const recipient = json?.SMSMessageData?.Recipients?.[0]
  if (!response.ok || !recipient || !['Success', 'Sent'].includes(recipient.status)) {
    throw new Error(`Africa's Talking did not accept the SMS (${response.status} ${recipient?.status ?? ''})`)
  }
  return recipient.messageId
}

export async function inbox(worldId: string, phone: string, limit = 30) {
  return db
    .select({ id: smsMessages.id, body: smsMessages.body, kind: smsMessages.kind, status: smsMessages.status, createdAt: smsMessages.createdAt })
    .from(smsMessages)
    .where(and(eq(smsMessages.worldId, worldId), eq(smsMessages.toPhone, phone)))
    .orderBy(desc(smsMessages.createdAt))
    .limit(limit)
}
