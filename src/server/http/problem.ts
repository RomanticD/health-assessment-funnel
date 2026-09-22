import { ZodError } from 'zod'

import { ApplicationError, type ApplicationErrorOptions } from '@/server/application/errors'
import { logStructured } from '@/server/infrastructure/logging/structured-logger'

export interface FieldProblem {
  path: string
  message: string
  code: string
}

export interface ProblemBody {
  type: string
  title: string
  status: number
  code: string
  detail: string
  traceId: string
  errors?: FieldProblem[]
  meta?: Record<string, unknown>
}

export class ApiProblem extends ApplicationError {
  constructor(options: ApplicationErrorOptions) {
    super(options)
    this.name = 'ApiProblem'
  }
}

export function validationProblem(error: ZodError): ApiProblem {
  return new ApiProblem({
    status: 422,
    code: 'VALIDATION_FAILED',
    title: 'Validation failed',
    detail: 'The request contains invalid or unsupported fields.',
    errors: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    })),
    cause: error,
  })
}

function problemType(code: string): string {
  return `urn:health-assessment:problem:${code.toLowerCase().replaceAll('_', '-')}`
}

export function toProblemResponse(error: unknown, traceId: string): Response {
  const problem =
    error instanceof ApplicationError
      ? error
      : new ApiProblem({
          status: 500,
          code: 'INTERNAL_ERROR',
          title: 'Internal server error',
          detail: 'The server could not complete the request.',
          cause: error,
        })

  const body: ProblemBody = {
    type: problemType(problem.code),
    title: problem.title,
    status: problem.status,
    code: problem.code,
    detail: problem.message,
    traceId,
    ...(problem.errors === undefined ? {} : { errors: problem.errors }),
    ...(problem.meta === undefined ? {} : { meta: problem.meta }),
  }

  return Response.json(body, {
    status: problem.status,
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Type': 'application/problem+json',
      'X-Trace-Id': traceId,
      Vary: 'Cookie, Authorization',
    },
  })
}

export async function withApiErrorBoundary(
  handler: (traceId: string) => Promise<Response>,
): Promise<Response> {
  const traceId = crypto.randomUUID()

  try {
    const response = await handler(traceId)
    response.headers.set('X-Trace-Id', traceId)
    return response
  } catch (error) {
    // Only stable public errors cross this boundary. Stack traces, SQL details,
    // bearer credentials and health answers must never be serialized here.
    if (!(error instanceof ApplicationError) || error.status >= 500) {
      logStructured('error', {
        traceId,
        event: 'api.request.failed',
        status: error instanceof ApplicationError ? error.status : 500,
        errorCode: error instanceof ApplicationError ? error.code : 'UNEXPECTED_ERROR',
        errorName: error instanceof Error ? error.name : typeof error,
      })
    }
    return toProblemResponse(error, traceId)
  }
}
