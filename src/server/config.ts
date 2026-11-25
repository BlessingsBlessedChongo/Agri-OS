/** Runtime configuration, read lazily so builds and tests don't need every variable. */
export const config = {
  appUrl(): string {
    const explicit = process.env.APP_URL
    if (explicit) return explicit.replace(/\/$/, '')
    if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
    return `http://localhost:${process.env.PORT ?? 3000}`
  },
  /** Host shown to farmers on USSD and SMS, e.g. "agri-os.vercel.app". */
  displayHost(): string {
    return config.appUrl().replace(/^https?:\/\//, '')
  },
  /** How Agri-OS reaches the simulated providers: over HTTP like a real integration, or in-process (tests). */
  providerTransport(): 'http' | 'loopback' {
    return process.env.PROVIDER_TRANSPORT === 'loopback' ? 'loopback' : 'http'
  },
  zamtelApiKey(): string {
    return process.env.ZAMTEL_API_KEY ?? 'sim_test_key'
  },
  providerTimeoutMs(): number {
    return Number(process.env.PROVIDER_TIMEOUT_MS ?? 2500)
  },
  africasTalking(): { username: string; apiKey: string; senderId?: string } | null {
    const apiKey = process.env.AT_API_KEY
    if (!apiKey) return null
    return { username: process.env.AT_USERNAME ?? 'sandbox', apiKey, senderId: process.env.AT_SENDER_ID || undefined }
  },
  cronSecret(): string | null {
    return process.env.CRON_SECRET ?? null
  },
  sandboxTtlHours(): number {
    return Number(process.env.SANDBOX_TTL_HOURS ?? 24)
  },
}
