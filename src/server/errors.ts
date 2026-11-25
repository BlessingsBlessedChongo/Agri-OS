/** An expected business outcome the caller can act on (an order is closed, escrow is short, a key was reused). */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export const notFound = (what: string) => new HttpError(404, 'NOT_FOUND', `${what} was not found`)
export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'BAD_REQUEST', message, details)

/** Postgres error codes we turn into business errors. */
export function pgCode(error: unknown): string | undefined {
  const e = error as { code?: unknown; cause?: { code?: unknown } }
  if (typeof e?.code === 'string') return e.code
  if (typeof e?.cause?.code === 'string') return e.cause.code
  return undefined
}

export function pgConstraint(error: unknown): string | undefined {
  const e = error as { constraint?: unknown; cause?: { constraint?: unknown } }
  if (typeof e?.constraint === 'string') return e.constraint
  if (typeof e?.cause?.constraint === 'string') return e.cause.constraint
  return undefined
}
