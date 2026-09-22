import { createHash, randomBytes } from 'node:crypto'

import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import {
  bearerHeaders,
  collectObjectKeys,
  completeAssessment,
  createSession,
  expectProblem,
  getResult,
  idempotencyKey,
  jsonInit,
  pay,
  request,
  submitAssessment,
} from './helpers/api-client'

const protectedKeys = [
  'bmrKcal',
  'tdeeKcal',
  'exactDailyCalories',
  'calorieEstimateAvailable',
  'targetDate',
  'weightProjection',
  'algorithmVersion',
  'calculatedAt',
  'resultId',
]

describe('result entitlement and mock payment', () => {
  it('keeps a public paid fixture readable but rejects every business write', async () => {
    const token = randomBytes(32).toString('base64url')
    const digest = createHash('sha256').update(token).digest('hex')
    const admin = createClient(
      process.env.SUPABASE_URL ?? '',
      process.env.SUPABASE_SECRET_KEY ?? '',
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    )
    const user = await admin
      .from('app_users')
      .insert({ kind: 'demo_readonly' })
      .select('id')
      .single()
    if (user.error !== null || user.data === null)
      throw user.error ?? new Error('Fixture user was not created.')
    const session = await admin.from('anonymous_sessions').insert({
      user_id: user.data.id,
      token_hash: `\\x${digest}`,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    })
    if (session.error !== null) throw session.error

    const headers = bearerHeaders({ token, cookie: '' })
    const assessmentId = crypto.randomUUID()
    const requests: Array<
      Promise<ReturnType<typeof request> extends Promise<infer T> ? T : never>
    > = [
      request(
        '/api/v1/assessments',
        jsonInit(
          'POST',
          { quizVersion: 'health-v1' },
          {
            ...headers,
            'Idempotency-Key': idempotencyKey('readonly-create'),
          },
        ),
      ),
      request(
        `/api/v1/assessments/${assessmentId}/steps/sex`,
        jsonInit(
          'PUT',
          { data: { sexForCalorieEstimation: 'female' } },
          {
            ...headers,
            'If-Match': '"rev-0"',
            'Idempotency-Key': idempotencyKey('readonly-step'),
          },
        ),
      ),
      request(
        `/api/v1/assessments/${assessmentId}/submit`,
        jsonInit(
          'POST',
          {},
          {
            ...headers,
            'If-Match': '"rev-0"',
            'Idempotency-Key': idempotencyKey('readonly-submit'),
          },
        ),
      ),
      request(
        '/api/v1/pay',
        jsonInit(
          'POST',
          { assessmentId, planCode: 'demo_monthly' },
          {
            ...headers,
            'Idempotency-Key': idempotencyKey('readonly-pay'),
          },
        ),
      ),
    ]

    for (const result of await Promise.all(requests)) {
      expectProblem(result, 403, 'DEMO_SESSION_READ_ONLY')
    }
  })

  it('moves from structurally redacted preview to full result only after /pay', async () => {
    const session = await createSession()
    const ready = await completeAssessment(session)
    const submitKey = idempotencyKey('submit-transition')
    const submitted = await submitAssessment(session, ready.assessmentId, ready.revision, submitKey)

    const replay = await submitAssessment(session, ready.assessmentId, ready.revision, submitKey)
    expect(replay.data).toEqual(submitted.data)
    expect(replay.etag).toBe(submitted.etag)

    const preview = await getResult(session, ready.assessmentId)
    expect(preview).toMatchObject({
      access: 'preview',
      upgradeRequired: true,
      bmi: 25.7,
      bmiCategory: 'overweight',
      calorieRange: { min: 1500, max: 1700 },
    })
    const previewKeys = collectObjectKeys(preview)
    for (const key of protectedKeys) expect(previewKeys.has(key)).toBe(false)

    const paymentKey = idempotencyKey('pay-transition')
    const activated = await pay(session, ready.assessmentId, paymentKey)
    expect(activated.data).toMatchObject({
      assessmentId: ready.assessmentId,
      planCode: 'demo_monthly',
      outcome: 'activated',
      subscriptionStatus: 'active',
    })
    const paymentReplay = await pay(session, ready.assessmentId, paymentKey)
    expect(paymentReplay.data).toEqual(activated.data)

    const full = await getResult(session, ready.assessmentId)
    expect(full).toMatchObject({
      access: 'full',
      bmi: 25.7,
      bmiCategory: 'overweight',
      bmrKcal: 1410,
      tdeeKcal: 1939,
      exactDailyCalories: 1551,
      calorieRange: { min: 1500, max: 1700 },
      calorieEstimateAvailable: true,
      algorithmVersion: 'health-v1',
    })
    if (full.access !== 'full') throw new Error('Expected full result after payment.')
    expect(full.targetDate).toMatch(/^\d{4}-\d{2}-\d{2}$/u)
    expect(full.weightProjection.length).toBeGreaterThan(1)
  })

  it('does not let one session pay for another session assessment', async () => {
    const owner = await createSession()
    const stranger = await createSession()
    const ready = await completeAssessment(owner)
    await submitAssessment(owner, ready.assessmentId, ready.revision)

    const result = await request(
      '/api/v1/pay',
      jsonInit(
        'POST',
        { assessmentId: ready.assessmentId, planCode: 'demo_monthly' },
        {
          ...bearerHeaders(stranger),
          'Idempotency-Key': idempotencyKey('foreign-pay'),
        },
      ),
    )
    expectProblem(result, 404, 'ASSESSMENT_NOT_FOUND')
    expect((await getResult(owner, ready.assessmentId)).access).toBe('preview')
  })

  it('requires a completed result before payment', async () => {
    const session = await createSession()
    const ready = await completeAssessment(session)
    const result = await request(
      '/api/v1/pay',
      jsonInit(
        'POST',
        { assessmentId: ready.assessmentId, planCode: 'demo_monthly' },
        {
          ...bearerHeaders(session),
          'Idempotency-Key': idempotencyKey('early-pay'),
        },
      ),
    )
    expectProblem(result, 409, 'PAYMENT_REQUIRES_RESULT')
  })
})
