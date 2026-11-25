import type { Metadata } from 'next'
import { config } from '@/server/config'
import { openApiDocument } from '@/server/openapi'

export const metadata: Metadata = { title: 'API' }

const METHOD_STYLE: Record<string, string> = { get: 'bg-sky-wash text-sky', post: 'bg-leaf-wash text-leaf', put: 'bg-maize-wash text-ink', delete: 'bg-chili-wash text-chili' }

export default function ApiDocsPage() {
  const doc = openApiDocument(config.appUrl())
  const groups = new Map<string, Array<[string, string, { summary: string; description?: string; security?: unknown[] }]>>()
  for (const [path, methods] of Object.entries(doc.paths)) {
    const group = path.split('/')[2] ?? 'other'
    for (const [method, op] of Object.entries(methods)) {
      if (!groups.has(group)) groups.set(group, [])
      groups.get(group)!.push([method, path, op as { summary: string; description?: string; security?: unknown[] }])
    }
  }
  return (
    <div className="space-y-8">
      <div className="max-w-3xl">
        <h1 className="font-display text-5xl leading-none font-extrabold tracking-wide">API</h1>
        <p className="mt-3 text-ink-2">
          Everything the screens do goes through this API. Requests run in the caller’s sandbox (the agrios_world cookie, set by POST /api/world). Errors are always{' '}
          <code className="rounded bg-sheet-2 px-1">{'{ error: { code, message, details } }'}</code>. The machine-readable OpenAPI 3.1 document is at{' '}
          <a className="text-leaf underline-offset-2 hover:underline" href="/api/openapi">
            /api/openapi
          </a>
          .
        </p>
      </div>
      {[...groups.entries()].map(([group, ops]) => (
        <section key={group} aria-labelledby={`g-${group}`}>
          <h2 id={`g-${group}`} className="font-display text-2xl font-bold tracking-wide">
            {group}
          </h2>
          <ul className="mt-2 divide-y divide-rule rounded-[10px] border border-rule bg-sheet">
            {ops.map(([method, path, op]) => (
              <li key={`${method} ${path}`} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[4.5rem_minmax(0,22rem)_1fr] sm:gap-4">
                <span className={`h-fit w-fit rounded px-2 py-0.5 text-xs font-bold uppercase ${METHOD_STYLE[method] ?? ''}`}>{method}</span>
                <code className="text-sm break-all">{path}</code>
                <span className="text-sm text-ink-2">
                  {op.summary}
                  {op.description ? <span className="block text-ink-3">{op.description}</span> : null}
                  {Array.isArray(op.security) && op.security.length === 0 ? <span className="ml-1 text-xs text-ink-3">(no sandbox needed)</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
