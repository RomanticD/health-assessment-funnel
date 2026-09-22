import { createHealthAssessmentService } from '@/server/application/health-assessment-service'
import { enforceWriteOrigin } from '@/server/http/origin'
import { withApiErrorBoundary } from '@/server/http/problem'
import { assessmentEtag, parseJsonBody, requireIdempotencyKey } from '@/server/http/request'
import { successResponse } from '@/server/http/response'
import { requireSessionCredential } from '@/server/http/session-credential'
import { createAssessmentRequestSchema } from '@/shared/contracts'

export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  return withApiErrorBoundary(async () => {
    const credential = requireSessionCredential(request)
    enforceWriteOrigin(request, credential)
    const body = await parseJsonBody(request, createAssessmentRequestSchema)
    const idempotencyKey = requireIdempotencyKey(request)
    const result = await createHealthAssessmentService().createOrGetAssessment({
      sessionDigest: credential.digest,
      quizVersion: body.quizVersion,
      idempotencyKey,
    })

    return successResponse(result.data, {
      status: result.responseStatus,
      etag: assessmentEtag(result.data.revision),
    })
  })
}
