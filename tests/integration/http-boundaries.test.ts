import { describe, expect, it } from 'vitest'

import {
  baseUrl,
  bearerHeaders,
  createAssessment,
  createSession,
  expectProblem,
  idempotencyKey,
  jsonInit,
  request,
} from './helpers/api-client'

describe('HTTP boundary validation', () => {
  it('requires authentication for protected resources', async () => {
    const result = await request('/api/v1/assessments/current')
    expectProblem(result, 401, 'SESSION_REQUIRED')
  })

  it('rejects an unsupported content type before parsing', async () => {
    const result = await request('/api/v1/sessions', {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'text/plain' },
    })
    expectProblem(result, 415, 'UNSUPPORTED_MEDIA_TYPE')
  })

  it('rejects malformed JSON', async () => {
    const result = await request('/api/v1/sessions', {
      method: 'POST',
      body: '{',
      headers: { 'Content-Type': 'application/json' },
    })
    expectProblem(result, 400, 'INVALID_JSON')
  })

  it('rejects JSON bodies larger than 16 KiB before schema validation', async () => {
    const result = await request(
      '/api/v1/sessions',
      jsonInit('POST', { padding: 'x'.repeat(17 * 1024) }),
    )
    expectProblem(result, 413, 'PAYLOAD_TOO_LARGE')
  })

  it('rejects unknown fields and illegal numeric values', async () => {
    const session = await createSession()
    const created = await createAssessment(session)
    const unknown = await request(
      `/api/v1/assessments/${created.data.assessmentId}/steps/sex`,
      jsonInit(
        'PUT',
        {
          data: { sexForCalorieEstimation: 'female', subscriptionStatus: 'active' },
        },
        {
          ...bearerHeaders(session),
          'Idempotency-Key': idempotencyKey('unknown-field'),
          'If-Match': created.etag,
        },
      ),
    )
    const unknownProblem = expectProblem(unknown, 422, 'VALIDATION_FAILED')
    expect(unknownProblem.errors?.some((error) => error.code === 'unrecognized_keys')).toBe(true)

    const sexResult = await request(
      `/api/v1/assessments/${created.data.assessmentId}/steps/sex`,
      jsonInit(
        'PUT',
        { data: { sexForCalorieEstimation: 'female' } },
        {
          ...bearerHeaders(session),
          'Idempotency-Key': idempotencyKey('valid-after-rejection'),
          'If-Match': created.etag,
        },
      ),
    )
    expect(sexResult.response.status).toBe(200)
    const body = await request(
      `/api/v1/assessments/${created.data.assessmentId}/steps/goal`,
      jsonInit(
        'PUT',
        { data: { primaryGoal: 'lose_weight' } },
        {
          ...bearerHeaders(session),
          'Idempotency-Key': idempotencyKey('goal-before-body'),
          'If-Match': '"rev-1"',
        },
      ),
    )
    expect(body.response.status).toBe(200)

    const illegalBody = await request(
      `/api/v1/assessments/${created.data.assessmentId}/steps/body`,
      jsonInit(
        'PUT',
        {
          data: { ageYears: 17, heightCm: 0, weightKg: -1, targetWeightKg: 1000 },
        },
        {
          ...bearerHeaders(session),
          'Idempotency-Key': idempotencyKey('illegal-numbers'),
          'If-Match': '"rev-2"',
        },
      ),
    )
    const illegalProblem = expectProblem(illegalBody, 422, 'VALIDATION_FAILED')
    expect(illegalProblem.errors?.map((error) => error.path).sort()).toEqual([
      'data.ageYears',
      'data.heightCm',
      'data.targetWeightKg',
      'data.weightKg',
    ])
  })

  it('enforces idempotency and ETag header formats', async () => {
    const session = await createSession()
    const missingKey = await request(
      '/api/v1/assessments',
      jsonInit('POST', { quizVersion: 'health-v1' }, bearerHeaders(session)),
    )
    expectProblem(missingKey, 400, 'INVALID_IDEMPOTENCY_KEY')

    const created = await createAssessment(session)
    const missingRevision = await request(
      `/api/v1/assessments/${created.data.assessmentId}/steps/sex`,
      jsonInit(
        'PUT',
        { data: { sexForCalorieEstimation: 'female' } },
        {
          ...bearerHeaders(session),
          'Idempotency-Key': idempotencyKey('missing-revision'),
        },
      ),
    )
    expectProblem(missingRevision, 428, 'PRECONDITION_REQUIRED')

    for (const ifMatch of ['rev-0', '"rev-01"', `"rev-${'9'.repeat(400)}"`]) {
      const invalid = await request(
        `/api/v1/assessments/${created.data.assessmentId}/steps/sex`,
        jsonInit(
          'PUT',
          { data: { sexForCalorieEstimation: 'female' } },
          {
            ...bearerHeaders(session),
            'Idempotency-Key': idempotencyKey('bad-revision'),
            'If-Match': ifMatch,
          },
        ),
      )
      expectProblem(invalid, 400, 'INVALID_PRECONDITION')
    }
  })

  it('requires exact Origin for cookie-authenticated writes but permits bearer CLI writes', async () => {
    const session = await createSession()
    const withoutOrigin = await request(
      '/api/v1/assessments',
      jsonInit(
        'POST',
        { quizVersion: 'health-v1' },
        {
          Cookie: session.cookie,
          'Idempotency-Key': idempotencyKey('cookie-no-origin'),
        },
      ),
    )
    expectProblem(withoutOrigin, 403, 'ORIGIN_NOT_ALLOWED')

    const wrongOrigin = await request(
      '/api/v1/assessments',
      jsonInit(
        'POST',
        { quizVersion: 'health-v1' },
        {
          Cookie: session.cookie,
          Origin: 'https://attacker.example',
          'Idempotency-Key': idempotencyKey('cookie-wrong-origin'),
        },
      ),
    )
    expectProblem(wrongOrigin, 403, 'ORIGIN_NOT_ALLOWED')

    const correctOrigin = await request(
      '/api/v1/assessments',
      jsonInit(
        'POST',
        { quizVersion: 'health-v1' },
        {
          Cookie: session.cookie,
          Origin: baseUrl,
          'Idempotency-Key': idempotencyKey('cookie-correct-origin'),
        },
      ),
    )
    expect(correctOrigin.response.status).toBe(201)
  })

  it('rejects conflicting bearer and cookie credentials', async () => {
    const bearer = await createSession()
    const cookie = await createSession()
    const result = await request('/api/v1/assessments/current', {
      headers: { ...bearerHeaders(bearer), Cookie: cookie.cookie },
    })
    expectProblem(result, 400, 'AMBIGUOUS_SESSION')
  })

  it('keeps business tables inaccessible through the public Data API key', async () => {
    const supabaseUrl = process.env.SUPABASE_URL
    const publishableKey = process.env.TEST_SUPABASE_PUBLISHABLE_KEY
    expect(supabaseUrl).toBeDefined()
    expect(publishableKey).toBeDefined()
    if (supabaseUrl === undefined || publishableKey === undefined) return

    const response = await fetch(`${supabaseUrl}/rest/v1/app_users?select=id`, {
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${publishableKey}`,
      },
    })
    expect(response.ok).toBe(false)
    expect([401, 403, 404]).toContain(response.status)
  })
})
