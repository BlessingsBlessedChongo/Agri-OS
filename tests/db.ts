/**
 * Shared setup for database tests. Import this first: it points the app at the test database and switches the
 * provider transport to loopback, so the simulators run in-process with no real sleeping.
 */
export const hasDatabase = Boolean(process.env.TEST_DATABASE_URL)

if (hasDatabase) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
  process.env.PROVIDER_TRANSPORT = 'loopback'
  process.env.APP_URL = 'http://agrios.test'
  process.env.SIGNING_SEED ??= 'a'.repeat(64)
}
