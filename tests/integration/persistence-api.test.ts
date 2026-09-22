import { describe, expect, it } from 'vitest'

import {
  bearerHeaders,
  createAssessment,
  createSession,
  expectProblem,
  getAssessment,
  getCurrentAssessment,
  idempotencyKey,
  jsonInit,
  request,
  saveStep,
} from './helpers/api-client'

describe('assessment persistence API', () => {
  it('persists a step and restores the exact server-confirmed progress after interruption', async () => {
    const session = await createSession()
    const created = await createAssessment(session)
    const saved = await saveStep(session, created.data.assessmentId, created.data.revision, {
      stepKey: 'sex',
      data: { sexForCalorieEstimation: 'female' },
    })

    const recovered = await getCurrentAssessment(session)
    expect(recovered).toMatchObject({
      assessmentId: created.data.assessmentId,
      status: 'draft',
      revision: saved.data.revision,
      completedSteps: ['sex'],
      nextStep: 'goal',
      answers: { sex: { sexForCalorieEstimation: 'female' } },
    })
    expect(Object.keys(recovered.answers)).toEqual(['sex'])

    const concrete = await getAssessment(session, created.data.assessmentId)
    expect(concrete.data).toEqual(recovered)
  })

  it('rejects an out-of-order step atomically', async () => {
    const session = await createSession()
    const created = await createAssessment(session)
    const result = await request(
      `/api/v1/assessments/${created.data.assessmentId}/steps/activity`,
      jsonInit(
        'PUT',
        { data: { activityLevel: 'light' } },
        {
          ...bearerHeaders(session),
          'Idempotency-Key': idempotencyKey('out-of-order'),
          'If-Match': created.etag,
        },
      ),
    )
    expectProblem(result, 409, 'STEP_OUT_OF_ORDER')

    const after = await getAssessment(session, created.data.assessmentId)
    expect(after.data).toMatchObject({ revision: 0, completedSteps: [], answers: {} })
  })

  it('replays the same request without incrementing revision, even with the old ETag', async () => {
    const session = await createSession()
    const created = await createAssessment(session)
    const key = idempotencyKey('same-save')
    const command = {
      stepKey: 'sex' as const,
      data: { sexForCalorieEstimation: 'female' as const },
    }
    const first = await saveStep(
      session,
      created.data.assessmentId,
      created.data.revision,
      command,
      key,
    )
    const replay = await saveStep(
      session,
      created.data.assessmentId,
      created.data.revision,
      command,
      key,
    )
    expect(replay.data).toEqual(first.data)
    expect(replay.etag).toBe(first.etag)

    const after = await getAssessment(session, created.data.assessmentId)
    expect(after.data.revision).toBe(1)
  })

  it('rejects reuse of an idempotency key with different payload', async () => {
    const session = await createSession()
    const created = await createAssessment(session)
    const key = idempotencyKey('conflicting-save')
    await saveStep(
      session,
      created.data.assessmentId,
      created.data.revision,
      { stepKey: 'sex', data: { sexForCalorieEstimation: 'female' } },
      key,
    )
    const conflict = await request(
      `/api/v1/assessments/${created.data.assessmentId}/steps/sex`,
      jsonInit(
        'PUT',
        { data: { sexForCalorieEstimation: 'male' } },
        {
          ...bearerHeaders(session),
          'Idempotency-Key': key,
          'If-Match': created.etag,
        },
      ),
    )
    expectProblem(conflict, 409, 'IDEMPOTENCY_KEY_REUSED')
  })

  it('prevents stale and concurrent writes without losing an update', async () => {
    const session = await createSession()
    const created = await createAssessment(session)
    const sex = await saveStep(session, created.data.assessmentId, 0, {
      stepKey: 'sex',
      data: { sexForCalorieEstimation: 'female' },
    })

    const stale = await request(
      `/api/v1/assessments/${created.data.assessmentId}/steps/goal`,
      jsonInit(
        'PUT',
        { data: { primaryGoal: 'lose_weight' } },
        {
          ...bearerHeaders(session),
          'Idempotency-Key': idempotencyKey('stale'),
          'If-Match': '"rev-0"',
        },
      ),
    )
    const staleProblem = expectProblem(stale, 412, 'REVISION_MISMATCH')
    expect(staleProblem.meta?.currentRevision).toBe(1)

    const makeConcurrentRequest = (primaryGoal: 'lose_weight' | 'maintain_weight') =>
      request(
        `/api/v1/assessments/${created.data.assessmentId}/steps/goal`,
        jsonInit(
          'PUT',
          { data: { primaryGoal } },
          {
            ...bearerHeaders(session),
            'Idempotency-Key': idempotencyKey(`concurrent-${primaryGoal}`),
            'If-Match': sex.etag,
          },
        ),
      )
    const outcomes = await Promise.all([
      makeConcurrentRequest('lose_weight'),
      makeConcurrentRequest('maintain_weight'),
    ])
    expect(outcomes.map(({ response }) => response.status).sort()).toEqual([200, 412])
    const rejected = outcomes.find(({ response }) => response.status === 412)
    if (rejected === undefined) throw new Error('Expected one concurrent request to be rejected.')
    expectProblem(rejected, 412, 'REVISION_MISMATCH')

    const after = await getAssessment(session, created.data.assessmentId)
    expect(after.data.revision).toBe(2)
    expect(after.data.completedSteps).toEqual(['sex', 'goal'])
  })

  it('returns not found rather than leaking another session assessment (BOLA)', async () => {
    const owner = await createSession()
    const stranger = await createSession()
    const created = await createAssessment(owner)

    const read = await request(`/api/v1/assessments/${created.data.assessmentId}`, {
      headers: bearerHeaders(stranger),
    })
    expectProblem(read, 404, 'ASSESSMENT_NOT_FOUND')

    const write = await request(
      `/api/v1/assessments/${created.data.assessmentId}/steps/sex`,
      jsonInit(
        'PUT',
        { data: { sexForCalorieEstimation: 'female' } },
        {
          ...bearerHeaders(stranger),
          'Idempotency-Key': idempotencyKey('bola'),
          'If-Match': created.etag,
        },
      ),
    )
    expectProblem(write, 404, 'ASSESSMENT_NOT_FOUND')
  })
})
