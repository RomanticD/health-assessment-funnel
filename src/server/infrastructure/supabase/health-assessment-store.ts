import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { z, type ZodType } from 'zod'

import { ApplicationError } from '@/server/application/errors'
import type {
  AssessmentStore,
  FinalizeResult,
  OperationResult,
  SessionLookup,
} from '@/server/application/ports/assessment-store'
import {
  assessmentAnswersSchema,
  assessmentMutationDataSchema,
  assessmentNextStepSchema,
  assessmentProgressSchema,
  assessmentStatusSchema,
  assessmentStepKeySchema,
  fullResultDataSchema,
  isoTimestampSchema,
  payDataSchema,
  paymentOutcomeSchema,
  planCodeSchema,
  previewResultDataSchema,
  QUIZ_VERSION,
  revisionSchema,
  submitAssessmentDataSchema,
  uuidSchema,
} from '@/shared/contracts'
import { healthInputV1Schema } from '@/shared/contracts/health'

const HEX_SHA256_PATTERN = /^[a-f0-9]{64}$/u

const sessionLookupSchema = z.strictObject({
  sessionRecordId: uuidSchema,
  expiresAt: isoTimestampSchema,
  userKind: z.enum(['standard', 'demo_readonly']),
})

const rawAssessmentSchema = z.strictObject({
  assessmentId: uuidSchema,
  status: assessmentStatusSchema,
  quizVersion: z.literal(QUIZ_VERSION),
  revision: revisionSchema,
  completedSteps: z.array(assessmentStepKeySchema).max(4),
  nextStep: assessmentNextStepSchema.nullable(),
  answers: assessmentAnswersSchema,
  updatedAt: isoTimestampSchema,
})

const createAssessmentPayloadSchema = assessmentMutationDataSchema.extend({ reused: z.boolean() })

const readyInputsSchema = z.strictObject({
  assessmentId: uuidSchema,
  quizVersion: z.literal(QUIZ_VERSION),
  revision: revisionSchema,
  input: healthInputV1Schema,
})

const finalizePayloadSchema = submitAssessmentDataSchema.extend({ revision: revisionSchema })

const previewResultRowSchema = previewResultDataSchema.extend({
  assessmentId: uuidSchema,
  resultId: uuidSchema,
})

const fullResultRowSchema = fullResultDataSchema.extend({
  assessmentId: uuidSchema,
  resultId: uuidSchema,
  calculatedAt: isoTimestampSchema,
})

const resultRowSchema = z.discriminatedUnion('access', [
  previewResultRowSchema,
  fullResultRowSchema,
])

const paymentPayloadSchema = z.strictObject({
  paymentEventId: uuidSchema,
  assessmentId: uuidSchema,
  outcome: paymentOutcomeSchema,
  subscription: z.strictObject({
    status: z.literal('active'),
    planCode: planCodeSchema,
    validFrom: isoTimestampSchema,
    validUntil: isoTimestampSchema.nullable(),
    revision: revisionSchema,
  }),
})

const rpcEnvelopeSchema = <T>(payload: ZodType<T>) =>
  z.strictObject({
    replayed: z.boolean(),
    responseStatus: z.number().int().min(200).max(299),
    payload,
  })

type SupabaseRpcFailure = {
  code?: string
  details?: string
  hint?: string
  message?: string
}

const PUBLIC_DATABASE_ERRORS: Record<string, { status: number; title: string; detail: string }> = {
  AMBIGUOUS_SESSION: {
    status: 400,
    title: 'Ambiguous session',
    detail: 'The request contains conflicting session credentials.',
  },
  SESSION_REQUIRED: {
    status: 401,
    title: 'Session required',
    detail: 'Create a session or supply a valid session credential before continuing.',
  },
  SESSION_EXPIRED: {
    status: 401,
    title: 'Session expired',
    detail: 'The session expired or was revoked. Start a new assessment session.',
  },
  DEMO_SESSION_READ_ONLY: {
    status: 403,
    title: 'Demo session is read-only',
    detail: 'The public paid fixture cannot be changed.',
  },
  ASSESSMENT_NOT_FOUND: {
    status: 404,
    title: 'Assessment not found',
    detail: 'The requested assessment was not found.',
  },
  RESULT_NOT_READY: {
    status: 409,
    title: 'Result not ready',
    detail: 'Submit the completed assessment before requesting its result.',
  },
  VALIDATION_FAILED: {
    status: 422,
    title: 'Validation failed',
    detail: 'The request contains invalid or unsupported values.',
  },
  UNREASONABLE_TARGET: {
    status: 422,
    title: 'Target needs review',
    detail: 'The target weight conflicts with the selected goal or safety boundaries.',
  },
  ASSESSMENT_INCOMPLETE: {
    status: 422,
    title: 'Assessment incomplete',
    detail: 'Complete every required assessment step before submitting.',
  },
  REVISION_MISMATCH: {
    status: 412,
    title: 'Assessment changed',
    detail: 'The assessment was updated elsewhere. Reload it before trying again.',
  },
  STEP_OUT_OF_ORDER: {
    status: 409,
    title: 'Step out of order',
    detail: 'Complete the earlier assessment steps before saving this step.',
  },
  ASSESSMENT_LOCKED: {
    status: 409,
    title: 'Assessment locked',
    detail: 'A submitted assessment can no longer be changed.',
  },
  IDEMPOTENCY_KEY_REUSED: {
    status: 409,
    title: 'Idempotency key reused',
    detail: 'This Idempotency-Key was already used for a different request.',
  },
  INVALID_IDEMPOTENCY_KEY: {
    status: 400,
    title: 'Invalid idempotency key',
    detail: 'Supply an Idempotency-Key in the documented format.',
  },
  PAYMENT_REQUIRES_RESULT: {
    status: 409,
    title: 'Result required',
    detail: 'Submit the assessment before activating demo access.',
  },
}

function parseRevisionMeta(details: string | undefined): Record<string, unknown> | undefined {
  if (details === undefined) return undefined

  try {
    const value: unknown = JSON.parse(details)
    const parsed = z.strictObject({ currentRevision: revisionSchema }).safeParse(value)
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

function mapRpcError(error: SupabaseRpcFailure): ApplicationError {
  const publicError =
    error.message === undefined ? undefined : PUBLIC_DATABASE_ERRORS[error.message]
  if (publicError === undefined) {
    return new ApplicationError({
      status: 500,
      code: 'INTERNAL_ERROR',
      title: 'Internal server error',
      detail: 'The server could not complete the persistence operation.',
      cause: error,
    })
  }

  const revisionMeta =
    error.message === 'REVISION_MISMATCH' ? parseRevisionMeta(error.details) : undefined

  return new ApplicationError({
    ...publicError,
    code: error.message ?? 'INTERNAL_ERROR',
    ...(revisionMeta === undefined ? {} : { meta: revisionMeta }),
    cause: error,
  })
}

function internalContractError(cause: unknown): ApplicationError {
  return new ApplicationError({
    status: 500,
    code: 'INTERNAL_ERROR',
    title: 'Internal server error',
    detail: 'The persistence layer returned an invalid response.',
    cause,
  })
}

function byteaHex(value: string): string {
  if (!HEX_SHA256_PATTERN.test(value))
    throw internalContractError(new Error('Invalid SHA-256 hex.'))
  return `\\x${value}`
}

function toProgress(raw: z.infer<typeof rawAssessmentSchema>) {
  return assessmentProgressSchema.parse({
    assessmentId: raw.assessmentId,
    status: raw.status,
    quizVersion: raw.quizVersion,
    revision: raw.revision,
    completedSteps: raw.completedSteps,
    nextStep: raw.nextStep ?? 'review',
    answers: raw.answers,
    updatedAt: raw.updatedAt,
  })
}

export class SupabaseHealthAssessmentStore implements AssessmentStore {
  constructor(private readonly client: SupabaseClient) {}

  private async rpc<T>(
    name: string,
    args: Record<string, unknown>,
    schema: ZodType<T>,
  ): Promise<T> {
    const { data, error } = await this.client.rpc(name, args)
    if (error !== null) throw mapRpcError(error)

    const parsed = schema.safeParse(data)
    if (!parsed.success) throw internalContractError(parsed.error)
    return parsed.data
  }

  async createSession(input: { sessionDigest: string; expiresAt: string }): Promise<SessionLookup> {
    const row = await this.rpc(
      'rpc_create_anonymous_session',
      {
        p_session_hash: byteaHex(input.sessionDigest),
        p_expires_at: input.expiresAt,
      },
      sessionLookupSchema,
    )
    return { expiresAt: row.expiresAt, userKind: row.userKind }
  }

  async resolveSession(sessionDigest: string): Promise<SessionLookup> {
    const row = await this.rpc(
      'rpc_resolve_session',
      { p_session_hash: byteaHex(sessionDigest) },
      sessionLookupSchema,
    )
    return { expiresAt: row.expiresAt, userKind: row.userKind }
  }

  async createOrGetAssessment(input: {
    sessionDigest: string
    quizVersion: 'health-v1'
    idempotencyKey: string
    requestHash: string
  }) {
    const row = await this.rpc(
      'rpc_create_or_get_assessment',
      {
        p_session_hash: byteaHex(input.sessionDigest),
        p_quiz_version: input.quizVersion,
        p_idempotency_key: input.idempotencyKey,
        p_request_hash: byteaHex(input.requestHash),
      },
      rpcEnvelopeSchema(createAssessmentPayloadSchema),
    )
    return {
      data: assessmentMutationDataSchema.parse({
        assessmentId: row.payload.assessmentId,
        status: row.payload.status,
        revision: row.payload.revision,
        completedSteps: row.payload.completedSteps,
        nextStep: row.payload.nextStep,
        updatedAt: row.payload.updatedAt,
      }),
      replayed: row.replayed,
      responseStatus: row.responseStatus,
    }
  }

  async getCurrentAssessment(sessionDigest: string) {
    const row = await this.rpc(
      'rpc_get_current_assessment',
      { p_session_hash: byteaHex(sessionDigest) },
      rawAssessmentSchema,
    )
    return toProgress(row)
  }

  async getAssessment(input: { sessionDigest: string; assessmentId: string }) {
    const row = await this.rpc(
      'rpc_get_assessment',
      {
        p_session_hash: byteaHex(input.sessionDigest),
        p_assessment_id: input.assessmentId,
      },
      rawAssessmentSchema,
    )
    return toProgress(row)
  }

  async fetchReadyInputs(input: { sessionDigest: string; assessmentId: string }) {
    return this.rpc(
      'rpc_fetch_ready_inputs',
      {
        p_session_hash: byteaHex(input.sessionDigest),
        p_assessment_id: input.assessmentId,
      },
      readyInputsSchema,
    )
  }

  async saveAssessmentStep(input: {
    sessionDigest: string
    assessmentId: string
    stepKey: z.infer<typeof assessmentStepKeySchema>
    stepPayload: Record<string, unknown>
    expectedRevision: number
    idempotencyKey: string
    requestHash: string
  }) {
    const row = await this.rpc(
      'rpc_save_assessment_step',
      {
        p_session_hash: byteaHex(input.sessionDigest),
        p_assessment_id: input.assessmentId,
        p_step_key: input.stepKey,
        p_step_payload: input.stepPayload,
        p_expected_revision: input.expectedRevision,
        p_idempotency_key: input.idempotencyKey,
        p_request_hash: byteaHex(input.requestHash),
      },
      rpcEnvelopeSchema(assessmentMutationDataSchema),
    )
    return {
      data: row.payload,
      replayed: row.replayed,
      responseStatus: row.responseStatus,
    }
  }

  async finalizeAssessment(input: {
    sessionDigest: string
    assessmentId: string
    expectedRevision: number
    idempotencyKey: string
    requestHash: string
    result: Parameters<AssessmentStore['finalizeAssessment']>[0]['result']
  }): Promise<FinalizeResult> {
    const row = await this.rpc(
      'rpc_finalize_assessment',
      {
        p_session_hash: byteaHex(input.sessionDigest),
        p_assessment_id: input.assessmentId,
        p_expected_revision: input.expectedRevision,
        p_idempotency_key: input.idempotencyKey,
        p_request_hash: byteaHex(input.requestHash),
        p_result: input.result,
      },
      rpcEnvelopeSchema(finalizePayloadSchema),
    )
    return {
      data: submitAssessmentDataSchema.parse({
        assessmentId: row.payload.assessmentId,
        resultId: row.payload.resultId,
        status: row.payload.status,
        calculatedAt: row.payload.calculatedAt,
      }),
      replayed: row.replayed,
      responseStatus: row.responseStatus,
      revision: row.payload.revision,
    }
  }

  async getAssessmentResult(input: { sessionDigest: string; assessmentId: string }) {
    const row = await this.rpc(
      'rpc_get_assessment_result',
      {
        p_session_hash: byteaHex(input.sessionDigest),
        p_assessment_id: input.assessmentId,
      },
      resultRowSchema,
    )

    if (row.access === 'preview') {
      return previewResultDataSchema.parse({
        access: row.access,
        bmi: row.bmi,
        bmiCategory: row.bmiCategory,
        summary: row.summary,
        calorieRange: row.calorieRange,
        warnings: row.warnings,
        upgradeRequired: row.upgradeRequired,
        lockedFeatures: row.lockedFeatures,
      })
    }

    return fullResultDataSchema.parse({
      access: row.access,
      bmi: row.bmi,
      bmiCategory: row.bmiCategory,
      bmrKcal: row.bmrKcal,
      tdeeKcal: row.tdeeKcal,
      exactDailyCalories: row.exactDailyCalories,
      calorieRange: row.calorieRange,
      calorieEstimateAvailable: row.calorieEstimateAvailable,
      targetDate: row.targetDate,
      weightProjection: row.weightProjection,
      warnings: row.warnings,
      algorithmVersion: row.algorithmVersion,
    })
  }

  async simulatePayment(input: {
    sessionDigest: string
    assessmentId: string
    planCode: z.infer<typeof planCodeSchema>
    idempotencyKey: string
    requestHash: string
  }): Promise<OperationResult<z.infer<typeof payDataSchema>>> {
    const row = await this.rpc(
      'rpc_simulate_payment',
      {
        p_session_hash: byteaHex(input.sessionDigest),
        p_assessment_id: input.assessmentId,
        p_plan_code: input.planCode,
        p_idempotency_key: input.idempotencyKey,
        p_request_hash: byteaHex(input.requestHash),
      },
      rpcEnvelopeSchema(paymentPayloadSchema),
    )
    return {
      data: payDataSchema.parse({
        assessmentId: row.payload.assessmentId,
        planCode: row.payload.subscription.planCode,
        outcome: row.payload.outcome,
        subscriptionStatus: row.payload.subscription.status,
        validFrom: row.payload.subscription.validFrom,
        validUntil: row.payload.subscription.validUntil,
      }),
      replayed: row.replayed,
      responseStatus: row.responseStatus,
    }
  }
}
