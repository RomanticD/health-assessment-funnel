import { createHash } from 'node:crypto'

import { canonicalJsonStringify, type CanonicalJsonValue } from '@/shared/contracts/canonical-json'

export interface RequestFingerprintInput {
  method: 'POST' | 'PUT'
  scope: string
  semanticVersion: string
  resourceId?: string
  body: CanonicalJsonValue
}

/**
 * The database separately scopes idempotency records to its session-derived
 * user id. This digest covers every remaining semantic input and never includes
 * a bearer credential.
 */
export function requestFingerprint(input: RequestFingerprintInput): string {
  const canonical = canonicalJsonStringify({
    method: input.method,
    scope: input.scope,
    semanticVersion: input.semanticVersion,
    resourceId: input.resourceId ?? null,
    body: input.body,
  })

  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}
