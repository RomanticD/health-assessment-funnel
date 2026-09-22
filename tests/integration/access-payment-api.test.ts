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
