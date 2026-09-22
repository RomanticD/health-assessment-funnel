import { createHealthAssessmentService } from '@/server/application/health-assessment-service'
import { withApiErrorBoundary } from '@/server/http/problem'
import { parseRequestValue } from '@/server/http/request'
import { successResponse } from '@/server/http/response'
import { requireSessionCredential } from '@/server/http/session-credential'
import { uuidSchema } from '@/shared/contracts'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ assessmentId: string }>
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return withApiErrorBoundary(async () => {
    const credential = requireSessionCredential(request)
    const { assessmentId: rawAssessmentId } = await context.params
    const assessmentId = parseRequestValue(rawAssessmentId, uuidSchema)
    const result = await createHealthAssessmentService().getAssessmentResult({
      sessionDigest: credential.digest,
      assessmentId,
    })
    return successResponse(result)
  })
}
