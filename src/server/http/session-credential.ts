import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import { ApiProblem } from '@/server/http/problem'

export const SESSION_COOKIE_NAME = '__Host-health_session'
export const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
export const STANDARD_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

export type CredentialMode = 'none' | 'bearer' | 'cookie' | 'both'

export interface SessionCredential {
  token: string
  digest: string
  mode: Exclude<CredentialMode, 'none'>
}

function bearerToken(request: Request): string | undefined {
  const authorization = request.headers.get('authorization')
  if (authorization === null) return undefined

  const match = /^Bearer ([^\s]+)$/.exec(authorization)
  if (match === null || match[1] === undefined) {
    throw new ApiProblem({
      status: 401,
      code: 'SESSION_REQUIRED',
      title: 'Session required',
      detail: 'Authorization must use a single Bearer session credential.',
    })
  }
  return match[1]
}

function cookieToken(request: Request): string | undefined {
  const cookieHeader = request.headers.get('cookie')
  if (cookieHeader === null) return undefined

  const matches = cookieHeader
    .split(';')
    .map((entry) => entry.trim().split('=', 2))
    .filter(([name]) => name === SESSION_COOKIE_NAME)
    .map(([, value]) => value)

  if (matches.length > 1) {
    throw new ApiProblem({
      status: 400,
      code: 'AMBIGUOUS_SESSION',
      title: 'Ambiguous session',
      detail: 'The request contains more than one session cookie.',
    })
  }

  return matches[0]
}

function assertTokenShape(token: string): void {
  if (!SESSION_TOKEN_PATTERN.test(token)) {
    throw new ApiProblem({
      status: 401,
      code: 'SESSION_REQUIRED',
      title: 'Session required',
      detail: 'The supplied session credential is malformed.',
    })
  }
}

function equalTokens(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'ascii')
  const rightBytes = Buffer.from(right, 'ascii')
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes)
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

export function sessionDigest(token: string): string {
  assertTokenShape(token)
  return createHash('sha256').update(token, 'ascii').digest('hex')
}

export function optionalSessionCredential(request: Request): SessionCredential | undefined {
  const bearer = bearerToken(request)
  const cookie = cookieToken(request)

  if (bearer !== undefined) assertTokenShape(bearer)
  if (cookie !== undefined) assertTokenShape(cookie)

  if (bearer !== undefined && cookie !== undefined && !equalTokens(bearer, cookie)) {
    throw new ApiProblem({
      status: 400,
      code: 'AMBIGUOUS_SESSION',
      title: 'Ambiguous session',
      detail: 'Bearer and cookie credentials identify different sessions.',
    })
  }

  const token = bearer ?? cookie
  if (token === undefined) return undefined

  return {
    token,
    digest: sessionDigest(token),
    mode:
      bearer !== undefined && cookie !== undefined
        ? 'both'
        : bearer !== undefined
          ? 'bearer'
          : 'cookie',
  }
}

export function requireSessionCredential(request: Request): SessionCredential {
  const credential = optionalSessionCredential(request)
  if (credential === undefined) {
    throw new ApiProblem({
      status: 401,
      code: 'SESSION_REQUIRED',
      title: 'Session required',
      detail: 'Create a session or supply its bearer credential before continuing.',
    })
  }
  return credential
}

export function sessionCookie(token: string, expiresAt: Date): string {
  assertTokenShape(token)
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; Expires=${expiresAt.toUTCString()}; HttpOnly; Secure; SameSite=Lax`
}
