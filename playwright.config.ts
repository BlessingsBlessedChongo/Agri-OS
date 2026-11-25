import { defineConfig } from '@playwright/test'

/** Browser journeys against a running app (npm run build && npm start). Locally they use the installed Edge. */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 240_000,
  reporter: 'list',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    channel: process.env.CI ? undefined : 'msedge',
    viewport: { width: 1440, height: 1000 },
  },
})
