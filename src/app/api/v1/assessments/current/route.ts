import { createHealthAssessmentService } from '@/server/application/health-assessment-service'
import { withApiErrorBoundary } from '@/server/http/problem'
import { assessmentEtag } from '@/server/http/request'
import { successResponse } from '@/server/http/response'
import { requireSessionCredential } from '@/server/http/session-credential'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  return withApiErrorBoundary(async () => {
    const credential = requireSessionCredential(request)
    const progress = await createHealthAssessmentService().getCurrentAssessment(credential.digest)
    return successResponse(progress, { etag: assessmentEtag(progress.revision) })
  })
}
