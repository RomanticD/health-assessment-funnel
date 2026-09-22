import { ZodError, type ZodType } from 'zod'

import { ApiProblem, validationProblem } from '@/server/http/problem'
import { revisionSchema } from '@/shared/contracts'

export const MAX_JSON_BODY_BYTES = 16 * 1024
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/
export const ETAG_PATTERN = /^"rev-(0|[1-9][0-9]*)"$/

async function readBodyWithinLimit(request: Request): Promise<string> {
  const contentLength = request.headers.get('content-length')
  if (contentLength !== null && Number(contentLength) > MAX_JSON_BODY_BYTES) {
    throw new ApiProblem({
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
      title: 'Payload too large',
      detail: `JSON request bodies are limited to ${MAX_JSON_BODY_BYTES} bytes.`,
    })
  }

  if (request.body === null) {
    return ''
  }

  const reader = request.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytesRead = 0
  let text = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytesRead += value.byteLength
      if (bytesRead > MAX_JSON_BODY_BYTES) {
        await reader.cancel()
        throw new ApiProblem({
          status: 413,
          code: 'PAYLOAD_TOO_LARGE',
          title: 'Payload too large',
          detail: `JSON request bodies are limited to ${MAX_JSON_BODY_BYTES} bytes.`,
        })
      }
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } catch (error) {
    if (error instanceof ApiProblem) throw error
    throw new ApiProblem({
      status: 400,
      code: 'INVALID_BODY_ENCODING',
      title: 'Invalid request body',
      detail: 'The request body must be valid UTF-8.',
      cause: error,
    })
  }
}

export async function parseJsonBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json') {
    throw new ApiProblem({
      status: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      title: 'Unsupported media type',
      detail: 'Content-Type must be application/json.',
    })
  }

  const rawBody = await readBodyWithinLimit(request)
  let value: unknown
  try {
    value = JSON.parse(rawBody)
  } catch (error) {
    throw new ApiProblem({
      status: 400,
      code: 'INVALID_JSON',
      title: 'Invalid JSON',
      detail: 'The request body is not valid JSON.',
      cause: error,
    })
  }

  try {
    return schema.parse(value)
  } catch (error) {
    if (error instanceof ZodError) throw validationProblem(error)
    throw error
  }
}

export function parseRequestValue<T>(value: unknown, schema: ZodType<T>): T {
  try {
    return schema.parse(value)
  } catch (error) {
    if (error instanceof ZodError) throw validationProblem(error)
    throw error
  }
}

export function requireIdempotencyKey(request: Request): string {
  const value = request.headers.get('idempotency-key')
  if (value === null || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new ApiProblem({
      status: 400,
      code: 'INVALID_IDEMPOTENCY_KEY',
      title: 'Invalid idempotency key',
      detail:
        'Idempotency-Key must contain 16–128 characters from A-Z, a-z, 0-9, dot, underscore, colon or hyphen.',
    })
  }
  return value
}

export function requireRevision(request: Request): number {
  const value = request.headers.get('if-match')
  if (value === null) {
    throw new ApiProblem({
      status: 428,
      code: 'PRECONDITION_REQUIRED',
      title: 'Precondition required',
      detail: 'Supply the assessment ETag in If-Match, for example "rev-4".',
    })
  }

  const match = ETAG_PATTERN.exec(value)
  if (match === null) {
    throw new ApiProblem({
      status: 400,
      code: 'INVALID_PRECONDITION',
      title: 'Invalid precondition',
      detail: 'If-Match must use the exact format "rev-N".',
    })
  }

  const revision = revisionSchema.safeParse(Number(match[1]))
  if (!revision.success) {
    throw new ApiProblem({
      status: 400,
      code: 'INVALID_PRECONDITION',
      title: 'Invalid precondition',
      detail: 'If-Match revision must be a non-negative safe integer.',
      cause: revision.error,
    })
  }

  return revision.data
}

export function assessmentEtag(revision: number): string {
  return `"rev-${revision}"`
}
