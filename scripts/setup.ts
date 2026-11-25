/**
 * One-command local setup: creates .env (with a fresh signing seed) if there isn't one, then migrates and seeds.
 *   docker compose up -d   # or point DATABASE_URL at any Postgres 15+
 *   npm run setup
 *   npm run dev
 */
import { execSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

if (!existsSync('.env')) {
  const env = readFileSync('.env.example', 'utf8').replace('SIGNING_SEED=""', `SIGNING_SEED="${randomBytes(32).toString('hex')}"`)
  writeFileSync('.env', env)
  console.log('Created .env with a new signing seed. Change DATABASE_URL in it if you are not using docker compose.')
}
process.loadEnvFile('.env')
execSync('npx tsx scripts/migrate.ts', { stdio: 'inherit', env: process.env })
execSync('npx tsx scripts/seed.ts', { stdio: 'inherit', env: process.env })
console.log('\nReady. Run npm run dev and open http://localhost:3000')
