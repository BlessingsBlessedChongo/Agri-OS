import { after, NextResponse, type NextRequest } from 'next/server'
import { ZodError, type z } from 'zod'
import { DomainError, HttpError } from './errors'
import { drain } from './worker'
import { requireWorld, touchWorld, type World } from './world'

export function json(data: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return NextResponse.json(data, { status: init.status ?? 200, headers: { 'cache-control': 'no-store', ...init.headers } })
}

function describeIssue(error: ZodError): string {
  const issue = error.issues[0]
  if (!issue) return 'The request is not valid'
  const where = issue.path.length ? `${issue.path.join('.')}: ` : ''
  return `${where}${issue.message}`
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError || error instanceof DomainError) {
    return json({ error: { code: error.code, message: error.message, details: error.details ?? null } }, { status: error.status })
  }
  if (error instanceof ZodError) return json({ error: { code: 'VALIDATION', message: describeIssue(error), details: error.issues } }, { status: 422 })
  console.error('[api]', error)
  return json({ error: { code: 'INTERNAL', message: 'Something went wrong on our side.' } }, { status: 500 })
}

type Params = Record<string, string | string[]>

export function route<P extends Params = Record<string, never>>(handler: (request: NextRequest, ctx: { params: P }) => Promise<Response>) {
  return async (request: NextRequest, context: { params: Promise<P> }) => {
    try {
      return await handler(request, { params: context?.params ? await context.params : ({} as P) })
    } catch (error) {
      return errorResponse(error)
    }
  }
}

/**
 * A route inside the visitor's sandbox. After the response has been sent, due background work for that world runs
 * (Next's `after`), so payouts, callbacks and invoices keep moving without a separate worker process.
 */
export function worldRoute<P extends Params = Record<string, never>>(handler: (request: NextRequest, ctx: { params: P; world: World }) => Promise<Response>) {
  return route<P>(async (request, { params }) => {
    const world = await requireWorld(request)
    after(async () => {
      await touchWorld(world).catch(() => undefined)
      await drain({ worldId: world.id, budgetMs: 2500 }).catch((error) => console.error('[drain]', error))
    })
    return handler(request, { params, world })
  })
}

export async function readBody<S extends z.ZodType>(request: NextRequest, schema: S): Promise<z.infer<S>> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    throw new HttpError(400, 'BAD_JSON', 'The request body is not valid JSON')
  }
  return schema.parse(raw)
}

export function clientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || '127.0.0.1'
}
