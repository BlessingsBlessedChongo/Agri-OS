import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Local runs read TEST_DATABASE_URL from .env; CI sets it directly.
try {
  process.loadEnvFile(path.resolve(__dirname, '.env'))
} catch {
  // no .env: database tests are skipped unless TEST_DATABASE_URL is set
}

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/global-setup.ts'],
    // Database tests share one Postgres; run files one at a time.
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
})
