import 'server-only'

import { ApplicationError } from '@/server/application/errors'
import type { AssessmentStore } from '@/server/application/ports/assessment-store'
import type { Clock } from '@/server/application/ports/clock'
import { requestFingerprint } from '@/server/application/request-fingerprint'
import { evaluateHealthAssessmentV1 } from '@/server/domain'
import { getSupabaseServerClient } from '@/server/infrastructure/supabase/server-client'
import { SupabaseHealthAssessmentStore } from '@/server/infrastructure/supabase/health-assessment-store'
import { systemClock } from '@/server/infrastructure/time/system-clock'
import {
  canonicalizeJson,
  canonicalizeStepUpdateCommand,
  HEALTH_ALGORITHM_VERSION,
  healthResultSerializableV1Schema,
  QUIZ_VERSION,
  type AssessmentProgress,
  type PayData,
  type PlanCode,
  type ResultAccessData,
  type StepUpdateCommand,
} from '@/shared/contracts'

const SESSION_TTL_MILLISECONDS = 7 * 24 * 60 * 60 * 1000

export class HealthAssessmentService {
  constructor(
    private readonly store: AssessmentStore,
    private readonly clock: Clock,
  ) {}

  createSession(sessionDigest: string) {
    const expiresAt = new Date(this.clock.now().getTime() + SESSION_TTL_MILLISECONDS).toISOString()
    return this.store.createSession({ sessionDigest, expiresAt })
  }

  resolveSession(sessionDigest: string) {
    return this.store.resolveSession(sessionDigest)
  }

  createOrGetAssessment(input: {
    sessionDigest: string
    quizVersion: typeof QUIZ_VERSION
    idempotencyKey: string
  }) {
    const requestHash = requestFingerprint({
      method: 'POST',
      scope: 'assessment:create',
      semanticVersion: QUIZ_VERSION,
      body: canonicalizeJson({ quizVersion: input.quizVersion }),
    })

    return this.store.createOrGetAssessment({ ...input, requestHash })
  }

  getCurrentAssessment(sessionDigest: string): Promise<AssessmentProgress> {
    return this.store.getCurrentAssessment(sessionDigest)
  }

  getAssessment(input: {
    sessionDigest: string
    assessmentId: string
  }): Promise<AssessmentProgress> {
    return this.store.getAssessment(input)
  }

  saveAssessmentStep(input: {
    sessionDigest: string
    assessmentId: string
    expectedRevision: number
    idempotencyKey: string
    command: StepUpdateCommand
  }) {
    const requestHash = requestFingerprint({
      method: 'PUT',
      scope: 'assessment:step',
      semanticVersion: QUIZ_VERSION,
      resourceId: input.assessmentId,
      body: canonicalizeStepUpdateCommand(input.command),
    })

    return this.store.saveAssessmentStep({
      sessionDigest: input.sessionDigest,
      assessmentId: input.assessmentId,
      stepKey: input.command.stepKey,
      stepPayload: input.command.data,
      expectedRevision: input.expectedRevision,
      idempotencyKey: input.idempotencyKey,
      requestHash,
    })
  }

  async submitAssessment(input: {
    sessionDigest: string
    assessmentId: string
    expectedRevision: number
    idempotencyKey: string
  }) {
    // Submission performs a read-before-calculate so the domain layer can
    // build the result payload. Resolve the session's write capability before
    // that read; otherwise a public read-only fixture could receive a generic
    // 404 for an unknown assessment instead of the stable write denial that
    // every other mutation path returns.
    const session = await this.store.resolveSession(input.sessionDigest)
    if (session.userKind === 'demo_readonly') {
      throw new ApplicationError({
        status: 403,
        code: 'DEMO_SESSION_READ_ONLY',
        title: 'Demo session is read-only',
        detail: 'The public paid fixture cannot be changed.',
      })
    }

    const requestHash = requestFingerprint({
      method: 'POST',
      scope: 'assessment:submit',
      semanticVersion: HEALTH_ALGORITHM_VERSION,
      resourceId: input.assessmentId,
      body: {},
    })

    const progress = await this.store.getAssessment({
      sessionDigest: input.sessionDigest,
      assessmentId: input.assessmentId,
    })

    // The RPC checks its idempotency record before inspecting assessment state
    // or result shape. This preserves a successful retry with the old ETag
    // after the first request already moved the assessment to `completed`.
    if (progress.status === 'completed') {
      return this.store.finalizeAssessment({
        sessionDigest: input.sessionDigest,
        assessmentId: input.assessmentId,
        expectedRevision: input.expectedRevision,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        result: {},
      })
    }

    const ready = await this.store.fetchReadyInputs({
      sessionDigest: input.sessionDigest,
      assessmentId: input.assessmentId,
    })
    const calculatedAt = this.clock.now()
    const evaluation = evaluateHealthAssessmentV1(ready.input, calculatedAt)

    if (!evaluation.ok) {
      if (evaluation.error.kind === 'target_plausibility') {
        throw new ApplicationError({
          status: 422,
          code: evaluation.error.code,
          title: 'Target needs review',
          detail: 'The target weight conflicts with the selected goal or safety boundaries.',
        })
      }

      throw new ApplicationError({
        status: 500,
        code: 'INTERNAL_ERROR',
        title: 'Internal server error',
        detail: 'Persisted assessment inputs could not be evaluated.',
        cause: evaluation.error,
      })
    }

    const result = healthResultSerializableV1Schema.parse({
      algorithmVersion: evaluation.result.algorithmVersion,
      bmi: evaluation.result.bmi,
      bmiCategory: evaluation.result.bmiCategory,
      bmrKcal: evaluation.result.bmrKcal,
      tdeeKcal: evaluation.result.tdeeKcal,
      calorieEstimateAvailable: evaluation.result.calorieEstimateAvailable,
      exactDailyCalories: evaluation.result.exactDailyCalories,
      calorieRange: evaluation.result.calorieRange,
      targetDate: evaluation.result.targetDate,
      weightProjection: evaluation.result.weightProjection,
      warnings: evaluation.result.warnings,
    })

    return this.store.finalizeAssessment({
      sessionDigest: input.sessionDigest,
      assessmentId: input.assessmentId,
      expectedRevision: input.expectedRevision,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      result: { ...result, calculatedAt: calculatedAt.toISOString() },
    })
  }

  getAssessmentResult(input: {
    sessionDigest: string
    assessmentId: string
  }): Promise<ResultAccessData> {
    return this.store.getAssessmentResult(input)
  }

  simulatePayment(input: {
    sessionDigest: string
    assessmentId: string
    planCode: PlanCode
    idempotencyKey: string
  }): Promise<{ data: PayData; replayed: boolean; responseStatus: number }> {
    const requestHash = requestFingerprint({
      method: 'POST',
      scope: 'payment:simulate',
      semanticVersion: 'mock-pay-v1',
      resourceId: input.assessmentId,
      body: canonicalizeJson({
        assessmentId: input.assessmentId,
        planCode: input.planCode,
      }),
    })

    return this.store.simulatePayment({ ...input, requestHash })
  }
}

export function createHealthAssessmentService(): HealthAssessmentService {
  return new HealthAssessmentService(
    new SupabaseHealthAssessmentStore(getSupabaseServerClient()),
    systemClock,
  )
}
