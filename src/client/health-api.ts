'use client'

import type { Route } from 'next'
import { z, type ZodType } from 'zod'

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
  type PayData,
  type ProblemDetails,
  type ResultAccessData,
  type StepUpdateCommand,
  type SubmitAssessmentData,
} from '@/shared/contracts'
import { QUIZ_VERSION } from '@/shared/contracts/health'

const API_BASE = '/api/v1'

type ResponseEnvelope<T> = {
  data: T
  etag: string | null
  status: number
}

export class HealthApiError extends Error {
  readonly status: number
  readonly code: string
  readonly traceId: string | undefined
  readonly fieldErrors: ProblemDetails['errors']
  readonly currentRevision: number | undefined

  constructor(problem: ProblemDetails) {
    super(problem.detail)
    this.name = 'HealthApiError'
    this.status = problem.status
    this.code = problem.code
    this.traceId = problem.traceId
    this.fieldErrors = problem.errors
    this.currentRevision = problem.meta?.currentRevision
  }
}

export function isHealthApiError(error: unknown): error is HealthApiError {
  return error instanceof HealthApiError
}

function contractError(status: number): HealthApiError {
  return new HealthApiError({
    type: 'urn:health-assessment:problem:invalid-server-response',
    title: 'Invalid server response',
    status: status >= 400 && status <= 599 ? status : 502,
    code: 'INVALID_SERVER_RESPONSE',
    detail: 'The server returned data that did not match the published API contract.',
    traceId: 'client-contract-check',
  })
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw contractError(response.status)
  }
}

async function requestData<T>(
  path: string,
  schema: ZodType<T>,
  init: RequestInit = {},
): Promise<ResponseEnvelope<T>> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json, application/problem+json',
        ...init.headers,
      },
    })
  } catch (cause) {
    throw new Error('We could not reach the server. Check your connection and try again.', {
      cause,
    })
  }

  const payload = await readJson(response)
  if (!response.ok) {
    const problem = problemDetailsSchema.safeParse(payload)
    if (problem.success) throw new HealthApiError(problem.data)
    throw contractError(response.status)
  }

  const envelope = z.strictObject({ data: schema }).safeParse(payload)
  if (!envelope.success) throw contractError(502)

  return {
    data: envelope.data.data,
    etag: response.headers.get('etag'),
    status: response.status,
  }
}

function jsonRequest(
  body: unknown,
  headers: HeadersInit = {},
): Pick<RequestInit, 'body' | 'headers'> {
  return {
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  }
}

export async function establishBrowserSession(): Promise<void> {
  await requestData('/sessions', createSessionDataSchema, {
    method: 'POST',
    ...jsonRequest({}),
  })
}

export function getCurrentAssessment(): Promise<ResponseEnvelope<AssessmentProgress>> {
  return requestData('/assessments/current', assessmentProgressSchema)
}

export function getAssessment(assessmentId: string): Promise<ResponseEnvelope<AssessmentProgress>> {
  return requestData(`/assessments/${encodeURIComponent(assessmentId)}`, assessmentProgressSchema)
}

export async function createOrReuseAssessment(): Promise<AssessmentProgress> {
  await requestData('/assessments', assessmentMutationDataSchema, {
    method: 'POST',
    ...jsonRequest({ quizVersion: QUIZ_VERSION }, { 'Idempotency-Key': crypto.randomUUID() }),
  })

  return (await getCurrentAssessment()).data
}

export async function recoverOrCreateAssessment(): Promise<AssessmentProgress> {
  await establishBrowserSession()

  try {
    return (await getCurrentAssessment()).data
  } catch (error) {
    if (isHealthApiError(error) && error.code === 'ASSESSMENT_NOT_FOUND') {
      return createOrReuseAssessment()
    }
    throw error
  }
}

export function revisionEtag(revision: number, receivedEtag: string | null = null): string {
  return receivedEtag ?? `"rev-${revision}"`
}

export function saveAssessmentStep(
  assessmentId: string,
  revision: number,
  command: StepUpdateCommand,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<ResponseEnvelope<AssessmentMutationData>> {
  return requestData(
    `/assessments/${encodeURIComponent(assessmentId)}/steps/${command.stepKey}`,
    assessmentMutationDataSchema,
    {
      method: 'PUT',
      ...jsonRequest(
        { data: command.data },
        {
          'Idempotency-Key': idempotencyKey,
          'If-Match': revisionEtag(revision),
        },
      ),
    },
  )
}

export function submitAssessment(
  assessmentId: string,
  revision: number,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<ResponseEnvelope<SubmitAssessmentData>> {
  return requestData(
    `/assessments/${encodeURIComponent(assessmentId)}/submit`,
    submitAssessmentDataSchema,
    {
      method: 'POST',
      ...jsonRequest(
        {},
        {
          'Idempotency-Key': idempotencyKey,
          'If-Match': revisionEtag(revision),
        },
      ),
    },
  )
}

export function getAssessmentResult(
  assessmentId: string,
): Promise<ResponseEnvelope<ResultAccessData>> {
  return requestData(
    `/assessments/${encodeURIComponent(assessmentId)}/result`,
    resultAccessDataSchema,
  )
}

export function activateDemoAccess(
  assessmentId: string,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<ResponseEnvelope<PayData>> {
  return requestData('/pay', payDataSchema, {
    method: 'POST',
    ...jsonRequest(
      { assessmentId, planCode: 'demo_monthly' },
      { 'Idempotency-Key': idempotencyKey },
    ),
  })
}

export function quizDestination(progress: AssessmentProgress): Route {
  // `assessmentId` and `nextStep` are parsed by the shared, strict DTO before
  // this helper is called. Keeping the route assertion here gives callers a
  // typed navigation API without scattering unchecked dynamic paths in UI.
  if (progress.status === 'completed') {
    return `/results/${progress.assessmentId}` as Route
  }

  return `/quiz/${progress.nextStep}` as Route
}

export function isAssessmentStep(value: string): value is AssessmentStepKey {
  return value === 'sex' || value === 'goal' || value === 'body' || value === 'activity'
}
