import { createHealthAssessmentService } from '@/server/application/health-assessment-service'
import { enforceWriteOrigin } from '@/server/http/origin'
import { withApiErrorBoundary } from '@/server/http/problem'
import { parseJsonBody, requireIdempotencyKey } from '@/server/http/request'
import { successResponse } from '@/server/http/response'
import { requireSessionCredential } from '@/server/http/session-credential'
import { payRequestSchema } from '@/shared/contracts'

export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  return withApiErrorBoundary(async () => {
    const credential = requireSessionCredential(request)
    enforceWriteOrigin(request, credential)
    const body = await parseJsonBody(request, payRequestSchema)
    const idempotencyKey = requireIdempotencyKey(request)
    const result = await createHealthAssessmentService().simulatePayment({
      sessionDigest: credential.digest,
      assessmentId: body.assessmentId,
      planCode: body.planCode,
      idempotencyKey,
    })
    return successResponse(result.data, { status: result.responseStatus })
  })
}
