import { execSync } from 'node:child_process'

/** Migrates and seeds the test database once per run (skipped when TEST_DATABASE_URL isn't set). */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL
  if (!url) {
    console.log('[tests] TEST_DATABASE_URL is not set: database tests will be skipped.')
    return
  }
  const env = { ...process.env, DATABASE_URL: url }
  execSync('npx tsx scripts/migrate.ts', { env, stdio: 'inherit' })
  execSync('npx tsx scripts/seed.ts', { env, stdio: 'inherit' })
}
