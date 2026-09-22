import { describe, expect, it } from 'vitest'
import {
  bearerHeaders,
  createAssessment,
  createSession,
  expectProblem,
  jsonInit,
  request,
  successData,
} from './helpers/api-client'
import { funnelSnapshotSchema } from '@/shared/contracts/funnel'

describe('expanded per-question draft persistence', () => {
  it('recovers partial measurements, handles retries, rejects stale concurrent writes and prevents cross-user reads', async () => {
    const session = await createSession()
    const { data } = await createAssessment(session)
    const path = `/api/v1/assessments/${data.assessmentId}/funnel`
    const write = (revision: number, key: string, value: unknown) =>
      request(
        path,
        jsonInit(
          'PUT',
          { key, value },
          { ...bearerHeaders(session), 'If-Match': `"rev-${revision}"` },
        ),
      )
    const saved = await write(0, 'ageYears', 32)
    expect(saved.response.status).toBe(200)
    expect(funnelSnapshotSchema.parse(successData(saved.body))).toEqual({
      revision: 1,
      answers: { ageYears: 32 },
    })
    const replay = await write(0, 'ageYears', 32)
    expect(successData(replay.body)).toEqual(successData(saved.body))
    const races = await Promise.all([write(1, 'heightCm', 165), write(1, 'weightKg', 70)])
    expect(races.map((r) => r.response.status).sort()).toEqual([200, 412])
    const restored = await request(path, { headers: bearerHeaders(session) })
    expect(funnelSnapshotSchema.parse(successData(restored.body)).answers.ageYears).toBe(32)
    const other = await createSession()
    expectProblem(
      await request(path, { headers: bearerHeaders(other) }),
      404,
      'ASSESSMENT_NOT_FOUND',
    )
    expectProblem(await write(2, 'ageYears', '32'), 422, 'VALIDATION_FAILED')
    expectProblem(await write(2, 'ageYears', 17), 422, 'VALIDATION_FAILED')
    expectProblem(await write(2, 'focus', ['whole_body', 'core']), 422, 'VALIDATION_FAILED')
    expectProblem(await write(2, 'barriers', ['none', 'time']), 422, 'VALIDATION_FAILED')
    expectProblem(await write(2, 'subscription_status', 'active'), 422, 'VALIDATION_FAILED')
  })
})
