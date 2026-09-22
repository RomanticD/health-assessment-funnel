import { describe, expect, it } from 'vitest'

import { calculateHealthAssessmentV1 } from '@/server/domain/health-assessment-v1'
import { toFullResultData, toPreviewResultData } from '@/server/domain/result-projection'
import { LOCKED_RESULT_FEATURES, previewResultDataSchema } from '@/shared/contracts/api'

function recursivelyCollectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) recursivelyCollectKeys(item, keys)
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key)
      recursivelyCollectKeys(child, keys)
    }
  }
  return keys
}

describe('result projections', () => {
  const result = calculateHealthAssessmentV1(
    {
      sexForCalorieEstimation: 'female',
      primaryGoal: 'lose_weight',
      ageYears: 32,
      heightCm: 165,
      weightKg: 70,
      targetWeightKg: 60,
      activityLevel: 'light',
    },
    new Date('2026-09-21T00:00:00.000Z'),
  )

  it('builds preview data from an allow-list with no protected key at any depth', () => {
    const preview = toPreviewResultData(result)
    const keys = recursivelyCollectKeys(preview)

    expect(previewResultDataSchema.parse(preview)).toEqual(preview)
    expect(preview.access).toBe('preview')
    expect(preview.lockedFeatures).toEqual(LOCKED_RESULT_FEATURES)
    for (const protectedKey of [
      ...LOCKED_RESULT_FEATURES,
      'calorieEstimateAvailable',
      'algorithmVersion',
      'calculatedAt',
      'resultId',
    ]) {
      expect(keys.has(protectedKey)).toBe(false)
    }
  })

  it('includes the complete calculation only in the full projection', () => {
    const full = toFullResultData(result)
    expect(full).toMatchObject({
      access: 'full',
      bmrKcal: 1410,
      tdeeKcal: 1939,
      exactDailyCalories: 1551,
      targetDate: '2027-04-12',
      algorithmVersion: 'health-v1',
    })
    expect(full.weightProjection).toHaveLength(30)
    expect(Object.hasOwn(full, 'bmiRaw')).toBe(false)
  })
})
