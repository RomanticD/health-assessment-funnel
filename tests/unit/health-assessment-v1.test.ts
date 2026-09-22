import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  calculateHealthAssessmentV1,
  evaluateHealthAssessmentV1,
  HealthAssessmentDomainError,
  HEALTH_V1_CONSTANTS,
  validateTargetPlausibilityV1,
} from '@/server/domain/health-assessment-v1'
import {
  ACTIVITY_LEVEL_VALUES,
  type HealthInputV1,
  HEALTH_INPUT_BOUNDS,
} from '@/shared/contracts/health'

const calculatedAt = new Date('2026-09-21T00:00:00.000Z')

const goldenInput: HealthInputV1 = {
  sexForCalorieEstimation: 'female',
  primaryGoal: 'lose_weight',
  ageYears: 32,
  heightCm: 165,
  weightKg: 70,
  targetWeightKg: 60,
  activityLevel: 'light',
}

describe('health-v1 golden behavior', () => {
  it('reproduces the frozen worked example exactly', () => {
    const result = calculateHealthAssessmentV1(goldenInput, calculatedAt)

    expect(result).toMatchObject({
      algorithmVersion: 'health-v1',
      bmi: 25.7,
      bmiCategory: 'overweight',
      bmrKcal: 1410,
      tdeeKcal: 1939,
      calorieEstimateAvailable: true,
      exactDailyCalories: 1551,
      calorieRange: { min: 1500, max: 1700 },
      targetDate: '2027-04-12',
      warnings: [],
    })
    expect(result.bmiRaw.toFixed(10)).toBe('25.7116620753')
    expect(result.weightProjection).toHaveLength(30)
    expect(result.weightProjection[0]).toEqual({ date: '2026-09-21', weightKg: 70 })
    expect(result.weightProjection.at(-1)).toEqual({ date: '2027-04-12', weightKg: 60 })
  })

  it.each([
    ['sedentary', 1692],
    ['light', 1939],
    ['moderate', 2186],
    ['active', 2433],
    ['very_active', 2679],
  ] as const)('uses the frozen %s activity factor', (activityLevel, tdeeKcal) => {
    const result = calculateHealthAssessmentV1({ ...goldenInput, activityLevel }, calculatedAt)
    expect(result.tdeeKcal).toBe(tdeeKcal)
    expect(HEALTH_V1_CONSTANTS.activityFactors[activityLevel]).toBeDefined()
  })

  it.each([
    [18.49, 'underweight'],
    [18.5, 'healthy_weight'],
    [24.99, 'healthy_weight'],
    [25, 'overweight'],
    [29.99, 'overweight'],
    [30, 'obesity'],
  ] as const)('classifies raw BMI %s before display rounding', (bmi, category) => {
    const weightKg = bmi * 4
    const result = calculateHealthAssessmentV1(
      {
        ...goldenInput,
        primaryGoal: 'maintain_weight',
        heightCm: 200,
        weightKg,
        targetWeightKg: weightKg,
      },
      calculatedAt,
    )
    expect(result.bmiCategory).toBe(category)
  })

  it('returns a single baseline point for a maintenance goal', () => {
    const result = calculateHealthAssessmentV1(
      {
        ...goldenInput,
        primaryGoal: 'maintain_weight',
        targetWeightKg: goldenInput.weightKg,
      },
      calculatedAt,
    )
    expect(result.targetDate).toBeNull()
    expect(result.weightProjection).toEqual([{ date: '2026-09-21', weightKg: 70 }])
    expect(result.warnings).toEqual(['MAINTENANCE_GOAL_NO_ARRIVAL_DATE'])
  })

  it('withholds calorie and prediction details below the female calorie floor', () => {
    const result = calculateHealthAssessmentV1(
      {
        sexForCalorieEstimation: 'female',
        primaryGoal: 'maintain_weight',
        ageYears: 80,
        heightCm: 120,
        weightKg: 35,
        targetWeightKg: 35,
        activityLevel: 'sedentary',
      },
      calculatedAt,
    )
    expect(result).toMatchObject({
      calorieEstimateAvailable: false,
      exactDailyCalories: null,
      calorieRange: null,
      targetDate: null,
      weightProjection: [],
      warnings: ['PROFESSIONAL_GUIDANCE_RECOMMENDED'],
    })
  })

  it('withholds calorie and prediction details above the calorie ceiling', () => {
    const result = calculateHealthAssessmentV1(
      {
        sexForCalorieEstimation: 'male',
        primaryGoal: 'maintain_weight',
        ageYears: 18,
        heightCm: 230,
        weightKg: 300,
        targetWeightKg: 300,
        activityLevel: 'very_active',
      },
      calculatedAt,
    )
    expect(result.calorieEstimateAvailable).toBe(false)
    expect(result.exactDailyCalories).toBeNull()
    expect(result.warnings).toEqual(['PROFESSIONAL_GUIDANCE_RECOMMENDED'])
  })

  it('caps long predictions instead of drawing a false multi-year curve', () => {
    const result = calculateHealthAssessmentV1(
      {
        sexForCalorieEstimation: 'female',
        primaryGoal: 'gain_weight',
        ageYears: 80,
        heightCm: 180,
        weightKg: 60,
        targetWeightKg: 84,
        activityLevel: 'sedentary',
      },
      calculatedAt,
    )
    expect(result.calorieEstimateAvailable).toBe(true)
    expect(result.targetDate).toBeNull()
    expect(result.weightProjection).toEqual([])
    expect(result.warnings).toEqual(['PREDICTION_HORIZON_EXCEEDED'])
  })
})

describe('health-v1 input validation', () => {
  const invalidInputs: Array<[string, unknown, string]> = [
    ['missing age', { ...goldenInput, ageYears: undefined }, 'ageYears'],
    ['minor age', { ...goldenInput, ageYears: 17 }, 'ageYears'],
    ['age above supported range', { ...goldenInput, ageYears: 81 }, 'ageYears'],
    ['fractional age', { ...goldenInput, ageYears: 32.5 }, 'ageYears'],
    ['string age', { ...goldenInput, ageYears: '32' }, 'ageYears'],
    ['null age', { ...goldenInput, ageYears: null }, 'ageYears'],
    ['height below minimum', { ...goldenInput, heightCm: 119.99 }, 'heightCm'],
    ['height above maximum', { ...goldenInput, heightCm: 230.01 }, 'heightCm'],
    ['infinite height', { ...goldenInput, heightCm: Number.POSITIVE_INFINITY }, 'heightCm'],
    ['weight below minimum', { ...goldenInput, weightKg: 34.99 }, 'weightKg'],
    ['weight above maximum', { ...goldenInput, weightKg: 300.01 }, 'weightKg'],
    ['NaN weight', { ...goldenInput, weightKg: Number.NaN }, 'weightKg'],
    ['target below minimum', { ...goldenInput, targetWeightKg: 34.99 }, 'targetWeightKg'],
    ['target above maximum', { ...goldenInput, targetWeightKg: 300.01 }, 'targetWeightKg'],
    ['three decimal places', { ...goldenInput, weightKg: 70.001 }, 'weightKg'],
    ['unknown goal', { ...goldenInput, primaryGoal: 'cut_fast' }, 'primaryGoal'],
    ['unknown field', { ...goldenInput, subscriptionStatus: 'active' }, ''],
  ]

  it.each(invalidInputs)('rejects %s', (_label, rawInput, expectedPath) => {
    const evaluation = evaluateHealthAssessmentV1(rawInput, calculatedAt)
    expect(evaluation.ok).toBe(false)
    if (evaluation.ok || evaluation.error.kind !== 'input_validation') return
    expect(evaluation.error.code).toBe('VALIDATION_FAILED')
    expect(evaluation.error.issues.some((issue) => issue.path.join('.') === expectedPath)).toBe(
      true,
    )
  })

  it('accepts every exact scalar minimum and maximum in a plausible combination', () => {
    const minimum = evaluateHealthAssessmentV1(
      {
        sexForCalorieEstimation: 'female',
        primaryGoal: 'maintain_weight',
        ageYears: HEALTH_INPUT_BOUNDS.ageYears.min,
        heightCm: HEALTH_INPUT_BOUNDS.heightCm.min,
        weightKg: HEALTH_INPUT_BOUNDS.weightKg.min,
        targetWeightKg: HEALTH_INPUT_BOUNDS.targetWeightKg.min,
        activityLevel: 'sedentary',
      },
      calculatedAt,
    )
    const maximum = evaluateHealthAssessmentV1(
      {
        sexForCalorieEstimation: 'male',
        primaryGoal: 'maintain_weight',
        ageYears: HEALTH_INPUT_BOUNDS.ageYears.max,
        heightCm: HEALTH_INPUT_BOUNDS.heightCm.max,
        weightKg: HEALTH_INPUT_BOUNDS.weightKg.max,
        targetWeightKg: HEALTH_INPUT_BOUNDS.targetWeightKg.max,
        activityLevel: 'very_active',
      },
      calculatedAt,
    )
    expect(minimum.ok).toBe(true)
    expect(maximum.ok).toBe(true)
  })

  it('rejects an invalid calculation timestamp', () => {
    const evaluation = evaluateHealthAssessmentV1(goldenInput, new Date(Number.NaN))
    expect(evaluation).toEqual({
      ok: false,
      error: { kind: 'invalid_timestamp', code: 'INVALID_ASSESSMENT_TIMESTAMP' },
    })
  })

  it('offers a typed exception API for trusted callers', () => {
    expect(() =>
      calculateHealthAssessmentV1({ ...goldenInput, ageYears: 17 }, calculatedAt),
    ).toThrowError(HealthAssessmentDomainError)
  })
})

describe('health-v1 target plausibility', () => {
  it.each([
    ['TARGET_CHANGE_EXCEEDS_40_PERCENT', { ...goldenInput, targetWeightKg: 40 }],
    ['LOSS_TARGET_NOT_BELOW_CURRENT', { ...goldenInput, targetWeightKg: goldenInput.weightKg }],
    ['LOSS_TARGET_BMI_BELOW_18_5', { ...goldenInput, heightCm: 180, targetWeightKg: 55 }],
    [
      'GAIN_TARGET_NOT_ABOVE_CURRENT',
      { ...goldenInput, primaryGoal: 'gain_weight', targetWeightKg: 65 },
    ],
    [
      'GAIN_TARGET_BMI_ABOVE_40',
      {
        ...goldenInput,
        primaryGoal: 'gain_weight',
        heightCm: 150,
        weightKg: 80,
        targetWeightKg: 91,
      },
    ],
    [
      'MAINTENANCE_TARGET_OUTSIDE_TOLERANCE',
      { ...goldenInput, primaryGoal: 'maintain_weight', targetWeightKg: 73 },
    ],
  ] as const)('rejects %s', (reason, input) => {
    expect(validateTargetPlausibilityV1(input)).toEqual({
      ok: false,
      code: 'UNREASONABLE_TARGET',
      reason,
    })
    const evaluation = evaluateHealthAssessmentV1(input, calculatedAt)
    expect(evaluation).toEqual({
      ok: false,
      error: { kind: 'target_plausibility', code: 'UNREASONABLE_TARGET', reason },
    })
  })

  it('accepts the exact 40% change boundary when the BMI guard also passes', () => {
    const input: HealthInputV1 = {
      ...goldenInput,
      primaryGoal: 'gain_weight',
      heightCm: 180,
      weightKg: 60,
      targetWeightKg: 84,
    }
    expect(validateTargetPlausibilityV1(input)).toEqual({ ok: true })
  })
})

describe('health-v1 properties', () => {
  it('is deterministic and activity-monotonic for valid adult inputs', () => {
    fc.assert(
      fc.property(
        fc.record({
          sexForCalorieEstimation: fc.constantFrom<'female' | 'male'>('female', 'male'),
          ageYears: fc.integer({ min: 18, max: 80 }),
          heightCm: fc.integer({ min: 150, max: 200 }),
          weightKg: fc.integer({ min: 55, max: 120 }),
        }),
        (sample) => {
          const results = ACTIVITY_LEVEL_VALUES.map((activityLevel) =>
            calculateHealthAssessmentV1(
              {
                ...sample,
                primaryGoal: 'maintain_weight',
                targetWeightKg: sample.weightKg,
                activityLevel,
              },
              calculatedAt,
            ),
          )

          expect(results[0]).toEqual(
            calculateHealthAssessmentV1(
              {
                ...sample,
                primaryGoal: 'maintain_weight',
                targetWeightKg: sample.weightKg,
                activityLevel: 'sedentary',
              },
              calculatedAt,
            ),
          )
          for (let index = 1; index < results.length; index += 1) {
            expect(results[index]?.tdeeKcal).toBeGreaterThanOrEqual(
              results[index - 1]?.tdeeKcal ?? 0,
            )
          }
          for (const result of results) {
            expect(Number.isFinite(result.bmi)).toBe(true)
            expect(result.bmrKcal).toBeGreaterThan(0)
            expect(result.tdeeKcal).toBeGreaterThan(0)
          }
        },
      ),
      { numRuns: 100, seed: 20_260_921 },
    )
  })

  it('creates a weekly, monotone, target-bounded loss projection', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 65, max: 120 }),
        fc.integer({ min: 5, max: 12 }),
        (weight, delta) => {
          const target = weight - delta
          fc.pre(target >= 60)
          const result = calculateHealthAssessmentV1(
            {
              ...goldenInput,
              heightCm: 165,
              weightKg: weight,
              targetWeightKg: target,
              activityLevel: 'moderate',
            },
            calculatedAt,
          )
          fc.pre(result.weightProjection.length > 1)
          expect(result.weightProjection.length).toBeLessThanOrEqual(105)
          expect(result.weightProjection.at(-1)?.weightKg).toBe(target)

          for (let index = 1; index < result.weightProjection.length; index += 1) {
            const previous = result.weightProjection[index - 1]
            const current = result.weightProjection[index]
            expect(previous).toBeDefined()
            expect(current).toBeDefined()
            expect(current?.weightKg).toBeLessThanOrEqual(
              previous?.weightKg ?? Number.POSITIVE_INFINITY,
            )
            expect(current?.weightKg).toBeGreaterThanOrEqual(target)
            const dayDifference =
              (Date.parse(`${current?.date}T00:00:00Z`) -
                Date.parse(`${previous?.date}T00:00:00Z`)) /
              86_400_000
            expect(dayDifference).toBe(7)
          }
        },
      ),
      { numRuns: 50, seed: 20_260_922 },
    )
  })
})
