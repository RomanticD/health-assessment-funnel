import type {
  AssessmentMutationData,
  AssessmentProgress,
  AssessmentStepKey,
  PayData,
  PlanCode,
  ResultAccessData,
  SubmitAssessmentData,
} from '@/shared/contracts/api'
import type { HealthInputV1, HealthResultSerializableV1 } from '@/shared/contracts/health'

export interface SessionLookup {
  expiresAt: string
  userKind: 'standard' | 'demo_readonly'
}

export interface OperationResult<T> {
  data: T
  replayed: boolean
  responseStatus: number
}

export interface FinalizeResult extends OperationResult<SubmitAssessmentData> {
  revision: number
}

export interface AssessmentStore {
  createSession(input: { sessionDigest: string; expiresAt: string }): Promise<SessionLookup>
  resolveSession(sessionDigest: string): Promise<SessionLookup>
  createOrGetAssessment(input: {
    sessionDigest: string
    quizVersion: 'health-v1'
    idempotencyKey: string
    requestHash: string
  }): Promise<OperationResult<AssessmentMutationData>>
  getCurrentAssessment(sessionDigest: string): Promise<AssessmentProgress>
  getAssessment(input: { sessionDigest: string; assessmentId: string }): Promise<AssessmentProgress>
  fetchReadyInputs(input: { sessionDigest: string; assessmentId: string }): Promise<{
    assessmentId: string
    quizVersion: 'health-v1'
    revision: number
    input: HealthInputV1
  }>
  saveAssessmentStep(input: {
    sessionDigest: string
    assessmentId: string
    stepKey: AssessmentStepKey
    stepPayload: Record<string, unknown>
    expectedRevision: number
    idempotencyKey: string
    requestHash: string
  }): Promise<OperationResult<AssessmentMutationData>>
  finalizeAssessment(input: {
    sessionDigest: string
    assessmentId: string
    expectedRevision: number
    idempotencyKey: string
    requestHash: string
    result: (HealthResultSerializableV1 & { calculatedAt: string }) | Record<string, never>
  }): Promise<FinalizeResult>
  getAssessmentResult(input: {
    sessionDigest: string
    assessmentId: string
  }): Promise<ResultAccessData>
  simulatePayment(input: {
    sessionDigest: string
    assessmentId: string
    planCode: PlanCode
    idempotencyKey: string
    requestHash: string
  }): Promise<OperationResult<PayData>>
}
