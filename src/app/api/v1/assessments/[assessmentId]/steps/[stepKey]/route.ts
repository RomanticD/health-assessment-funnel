import { createHealthAssessmentService } from '@/server/application/health-assessment-service'
import { enforceWriteOrigin } from '@/server/http/origin'
import { withApiErrorBoundary } from '@/server/http/problem'
import {
  assessmentEtag,
  parseJsonBody,
  parseRequestValue,
  requireIdempotencyKey,
  requireRevision,
} from '@/server/http/request'
import { successResponse } from '@/server/http/response'
import { requireSessionCredential } from '@/server/http/session-credential'
import {
  activityStepRequestSchema,
  assessmentStepKeySchema,
  bodyStepRequestSchema,
  goalStepRequestSchema,
  sexStepRequestSchema,
  type AssessmentStepKey,
  type StepUpdateCommand,
  uuidSchema,
} from '@/shared/contracts'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ assessmentId: string; stepKey: string }>
}

async function parseStepCommand(
  request: Request,
  stepKey: AssessmentStepKey,
): Promise<StepUpdateCommand> {
  switch (stepKey) {
    case 'sex':
      return { stepKey, data: (await parseJsonBody(request, sexStepRequestSchema)).data }
    case 'goal':
      return { stepKey, data: (await parseJsonBody(request, goalStepRequestSchema)).data }
    case 'body':
      return { stepKey, data: (await parseJsonBody(request, bodyStepRequestSchema)).data }
    case 'activity':
      return { stepKey, data: (await parseJsonBody(request, activityStepRequestSchema)).data }
  }
}

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  return withApiErrorBoundary(async () => {
    const credential = requireSessionCredential(request)
    enforceWriteOrigin(request, credential)
    const params = await context.params
    const assessmentId = parseRequestValue(params.assessmentId, uuidSchema)
    const stepKey = parseRequestValue(params.stepKey, assessmentStepKeySchema)
    const command = await parseStepCommand(request, stepKey)
    const expectedRevision = requireRevision(request)
    const idempotencyKey = requireIdempotencyKey(request)
    const result = await createHealthAssessmentService().saveAssessmentStep({
      sessionDigest: credential.digest,
      assessmentId,
      expectedRevision,
      idempotencyKey,
      command,
    })

    return successResponse(result.data, {
      status: result.responseStatus,
      etag: assessmentEtag(result.data.revision),
    })
  })
}
