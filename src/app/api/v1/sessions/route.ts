import { createHealthAssessmentService } from '@/server/application/health-assessment-service'
import { enforceWriteOrigin } from '@/server/http/origin'
import { withApiErrorBoundary } from '@/server/http/problem'
import { parseJsonBody } from '@/server/http/request'
import { successResponse } from '@/server/http/response'
import {
  newSessionToken,
  optionalSessionCredential,
  sessionCookie,
  sessionDigest,
} from '@/server/http/session-credential'
import { createSessionDataSchema, emptyRequestSchema } from '@/shared/contracts'

export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  return withApiErrorBoundary(async () => {
    await parseJsonBody(request, emptyRequestSchema)
    const credential = optionalSessionCredential(request)
    enforceWriteOrigin(request, credential)
    const service = createHealthAssessmentService()

    if (credential !== undefined) {
      const session = await service.resolveSession(credential.digest)
      const data = createSessionDataSchema.parse({
        expiresAt: session.expiresAt,
        reused: true,
      })
      return successResponse(data)
    }

    const token = newSessionToken()
    const session = await service.createSession(sessionDigest(token))
    const data = createSessionDataSchema.parse({
      sessionId: token,
      expiresAt: session.expiresAt,
      reused: false,
    })

    return successResponse(data, {
      status: 201,
      headers: {
        'Set-Cookie': sessionCookie(token, new Date(session.expiresAt)),
      },
    })
  })
}
