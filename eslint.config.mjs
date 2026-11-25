import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  { ignores: ['.next/**', 'next-env.d.ts', 'drizzle/**', 'public/sw.js', 'scripts/build-map.mjs', 'playwright-report/**', 'test-results/**'] },
]

export default config
