import { enforceWriteOrigin } from '@/server/http/origin'
import { withApiErrorBoundary } from '@/server/http/problem'
import {
  assessmentEtag,
  parseJsonBody,
  parseRequestValue,
  requireRevision,
} from '@/server/http/request'
import { successResponse } from '@/server/http/response'
import { requireSessionCredential } from '@/server/http/session-credential'
import { getSupabaseServerClient } from '@/server/infrastructure/supabase/server-client'
import { mapRpcError } from '@/server/infrastructure/supabase/health-assessment-store'
import { uuidSchema } from '@/shared/contracts'
import { funnelPatchSchema, funnelSnapshotSchema } from '@/shared/contracts/funnel'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ assessmentId: string }> }
async function handle(request: Request, context: Context, write: boolean) {
  return withApiErrorBoundary(async () => {
    const credential = requireSessionCredential(request)
    if (write) enforceWriteOrigin(request, credential)
    const id = parseRequestValue((await context.params).assessmentId, uuidSchema)
    const patch = write ? await parseJsonBody(request, funnelPatchSchema) : null
    const { data, error } = await getSupabaseServerClient().rpc('rpc_funnel_answers', {
      p_session_hash: `\\x${credential.digest}`,
      p_assessment_id: id,
      p_expected_revision: write ? requireRevision(request) : null,
      p_patch: patch ? { [patch.key]: patch.value } : null,
    })
    if (error) throw mapRpcError(error)
    const result = funnelSnapshotSchema.parse(data)
    return successResponse(result, { etag: assessmentEtag(result.revision) })
  })
}
export const GET = (request: Request, context: Context) => handle(request, context, false)
export const PUT = (request: Request, context: Context) => handle(request, context, true)
