import { getServerEnv } from '@/server/config/env'
import { ApiProblem } from '@/server/http/problem'
import type { SessionCredential } from '@/server/http/session-credential'

/** Bearer-only CLI writes do not participate in browser cookie CSRF. */
export function enforceWriteOrigin(
  request: Request,
  credential: SessionCredential | undefined,
): void {
  if (credential?.mode === 'bearer' || credential === undefined) return

  const origin = request.headers.get('origin')
  if (origin !== getServerEnv().APP_ORIGIN) {
    throw new ApiProblem({
      status: 403,
      code: 'ORIGIN_NOT_ALLOWED',
      title: 'Origin not allowed',
      detail: 'Cookie-authenticated writes require an exact trusted Origin.',
    })
  }
}
