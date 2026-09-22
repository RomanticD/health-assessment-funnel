import { expect } from 'vitest'

import {
  assessmentMutationDataSchema,
  assessmentProgressSchema,
  createSessionDataSchema,
  payDataSchema,
  problemDetailsSchema,
  resultAccessDataSchema,
  submitAssessmentDataSchema,
  type AssessmentMutationData,
  type AssessmentProgress,
  type AssessmentStepKey,
  type ResultAccessData,
  type StepUpdateCommand,
} from '@/shared/contracts'

export const baseUrl = process.env.TEST_API_BASE_URL ?? 'http://127.0.0.1:3110'

type JsonRecord = Record<string, unknown>

export type TestSession = {
  token: string
  cookie: string
}

export type ApiResult = {
  response: Response
  body: unknown
}

export function idempotencyKey(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`
}

export async function request(path: string, init: RequestInit = {}): Promise<ApiResult> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json, application/problem+json',
      ...init.headers,
    },
  })
  const body: unknown = await response.json()
  return { response, body }
}

export function jsonInit(method: string, body: unknown, headers: HeadersInit = {}): RequestInit {
  return {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...headers },
  }
}

export function bearerHeaders(session: TestSession): HeadersInit {
  return { Authorization: `Bearer ${session.token}` }
}

export function expectPrivateResponse(response: Response): void {
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  const vary = response.headers
    .get('vary')
    ?.split(',')
    .map((value) => value.trim().toLowerCase())
  expect(vary).toEqual(expect.arrayContaining(['cookie', 'authorization']))
  expect(response.headers.get('x-trace-id')).toMatch(/^[0-9a-f-]{36}$/u)
}

export function successData<T>(body: unknown): T {
  expect(body).toBeTypeOf('object')
  expect(body).not.toBeNull()
  return (body as { data: T }).data
}

export function expectProblem(
  result: ApiResult,
  status: number,
  code: string,
): ReturnType<typeof problemDetailsSchema.parse> {
  expect(result.response.status).toBe(status)
  expect(result.response.headers.get('content-type')).toContain('application/problem+json')
  expectPrivateResponse(result.response)
  const problem = problemDetailsSchema.parse(result.body)
  expect(problem.status).toBe(status)
  expect(problem.code).toBe(code)
  expect(problem.traceId).toBe(result.response.headers.get('x-trace-id'))
  return problem
}

export async function createSession(): Promise<TestSession> {
  const result = await request('/api/v1/sessions', jsonInit('POST', {}))
  expect(result.response.status).toBe(201)
  expectPrivateResponse(result.response)
  const data = createSessionDataSchema.parse(successData(result.body))
  if (data.reused) throw new Error('A new session request unexpectedly reused a credential.')

  const cookie = result.response.headers.get('set-cookie')
  expect(cookie).toContain('__Host-health_session=')
  expect(cookie).toContain('HttpOnly')
  expect(cookie).toContain('Secure')
  expect(cookie).toContain('SameSite=Lax')
  if (cookie === null) throw new Error('Session response did not set a cookie.')
  return { token: data.sessionId, cookie: cookie.split(';', 1)[0] ?? cookie }
}

export async function createAssessment(
  session: TestSession,
  key = idempotencyKey('create'),
): Promise<{ data: AssessmentMutationData; etag: string; key: string; status: number }> {
  const result = await request(
    '/api/v1/assessments',
    jsonInit(
      'POST',
      { quizVersion: 'health-v1' },
      {
        ...bearerHeaders(session),
        'Idempotency-Key': key,
      },
    ),
  )
  expect([200, 201]).toContain(result.response.status)
  expectPrivateResponse(result.response)
  const data = assessmentMutationDataSchema.parse(successData(result.body))
  const etag = result.response.headers.get('etag')
  expect(etag).toBe(`"rev-${data.revision}"`)
  if (etag === null) throw new Error('Assessment response did not include an ETag.')
  return { data, etag, key, status: result.response.status }
}

export async function getAssessment(
  session: TestSession,
  assessmentId: string,
): Promise<{ data: AssessmentProgress; etag: string }> {
  const result = await request(`/api/v1/assessments/${assessmentId}`, {
    headers: bearerHeaders(session),
  })
  expect(result.response.status).toBe(200)
  expectPrivateResponse(result.response)
  const data = assessmentProgressSchema.parse(successData(result.body))
  const etag = result.response.headers.get('etag')
  expect(etag).toBe(`"rev-${data.revision}"`)
  if (etag === null) throw new Error('Assessment response did not include an ETag.')
  return { data, etag }
}

export async function getCurrentAssessment(session: TestSession): Promise<AssessmentProgress> {
  const result = await request('/api/v1/assessments/current', {
    headers: bearerHeaders(session),
  })
  expect(result.response.status).toBe(200)
  expectPrivateResponse(result.response)
  return assessmentProgressSchema.parse(successData(result.body))
}

export async function saveStep(
  session: TestSession,
  assessmentId: string,
  revision: number,
  command: StepUpdateCommand,
  key = idempotencyKey(`save-${command.stepKey}`),
): Promise<{ data: AssessmentMutationData; etag: string; key: string; status: number }> {
  const result = await request(
    `/api/v1/assessments/${assessmentId}/steps/${command.stepKey}`,
    jsonInit(
      'PUT',
      { data: command.data },
      {
        ...bearerHeaders(session),
        'Idempotency-Key': key,
        'If-Match': `"rev-${revision}"`,
      },
    ),
  )
  expect(result.response.status).toBe(200)
  expectPrivateResponse(result.response)
  const data = assessmentMutationDataSchema.parse(successData(result.body))
  const etag = result.response.headers.get('etag')
  expect(etag).toBe(`"rev-${data.revision}"`)
  if (etag === null) throw new Error('Step response did not include an ETag.')
  return { data, etag, key, status: result.response.status }
}

export const validCommands = [
  { stepKey: 'sex', data: { sexForCalorieEstimation: 'female' } },
  { stepKey: 'goal', data: { primaryGoal: 'lose_weight' } },
  {
    stepKey: 'body',
    data: { ageYears: 32, heightCm: 165, weightKg: 70, targetWeightKg: 60 },
  },
  { stepKey: 'activity', data: { activityLevel: 'light' } },
] satisfies StepUpdateCommand[]

export async function completeAssessment(
  session: TestSession,
): Promise<{ assessmentId: string; revision: number }> {
  const created = await createAssessment(session)
  let revision = created.data.revision
  for (const command of validCommands) {
    const saved = await saveStep(session, created.data.assessmentId, revision, command)
    revision = saved.data.revision
  }
  return { assessmentId: created.data.assessmentId, revision }
}

export async function submitAssessment(
  session: TestSession,
  assessmentId: string,
  revision: number,
  key = idempotencyKey('submit'),
) {
  const result = await request(
    `/api/v1/assessments/${assessmentId}/submit`,
    jsonInit(
      'POST',
      {},
      {
        ...bearerHeaders(session),
        'Idempotency-Key': key,
        'If-Match': `"rev-${revision}"`,
      },
    ),
  )
  expect(result.response.status).toBe(200)
  expectPrivateResponse(result.response)
  return {
    data: submitAssessmentDataSchema.parse(successData(result.body)),
    etag: result.response.headers.get('etag'),
    key,
  }
}

export async function getResult(
  session: TestSession,
  assessmentId: string,
): Promise<ResultAccessData> {
  const result = await request(`/api/v1/assessments/${assessmentId}/result`, {
    headers: bearerHeaders(session),
  })
  expect(result.response.status).toBe(200)
  expectPrivateResponse(result.response)
  return resultAccessDataSchema.parse(successData(result.body))
}

export async function pay(session: TestSession, assessmentId: string, key = idempotencyKey('pay')) {
  const result = await request(
    '/api/v1/pay',
    jsonInit(
      'POST',
      { assessmentId, planCode: 'demo_monthly' },
      {
        ...bearerHeaders(session),
        'Idempotency-Key': key,
      },
    ),
  )
  expect(result.response.status).toBe(200)
  expectPrivateResponse(result.response)
  return { data: payDataSchema.parse(successData(result.body)), key }
}

export function collectObjectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectObjectKeys(item, keys)
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as JsonRecord)) {
      keys.add(key)
      collectObjectKeys(child, keys)
    }
  }
  return keys
}

export function stepPayload(stepKey: AssessmentStepKey): JsonRecord {
  const command = validCommands.find((candidate) => candidate.stepKey === stepKey)
  if (command === undefined) throw new Error(`No fixture exists for ${stepKey}.`)
  return command.data
}
