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
import { emptyRequestSchema, uuidSchema } from '@/shared/contracts'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ assessmentId: string }>
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return withApiErrorBoundary(async () => {
    const credential = requireSessionCredential(request)
    enforceWriteOrigin(request, credential)
    const { assessmentId: rawAssessmentId } = await context.params
    const assessmentId = parseRequestValue(rawAssessmentId, uuidSchema)
    await parseJsonBody(request, emptyRequestSchema)
    const expectedRevision = requireRevision(request)
    const idempotencyKey = requireIdempotencyKey(request)
    const result = await createHealthAssessmentService().submitAssessment({
      sessionDigest: credential.digest,
      assessmentId,
      expectedRevision,
      idempotencyKey,
    })

    return successResponse(result.data, {
      status: result.responseStatus,
      etag: assessmentEtag(result.revision),
    })
  })
}
