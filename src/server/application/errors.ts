export interface ApplicationFieldError {
  path: string
  message: string
  code: string
}

export interface ApplicationErrorOptions {
  status: number
  code: string
  title: string
  detail: string
  errors?: ApplicationFieldError[]
  meta?: Record<string, unknown>
  cause?: unknown
}

/**
 * A transport-neutral, safe-to-publish application failure. The `cause` is
 * retained for diagnostics but is never serialized by the HTTP boundary.
 */
export class ApplicationError extends Error {
  readonly status: number
  readonly code: string
  readonly title: string
  readonly errors: ApplicationFieldError[] | undefined
  readonly meta: Record<string, unknown> | undefined

  constructor(options: ApplicationErrorOptions) {
    super(options.detail, { cause: options.cause })
    this.name = 'ApplicationError'
    this.status = options.status
    this.code = options.code
    this.title = options.title
    this.errors = options.errors
    this.meta = options.meta
  }
}
