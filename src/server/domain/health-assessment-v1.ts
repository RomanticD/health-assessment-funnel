import Decimal from 'decimal.js'

import {
  type ActivityLevel,
  type BmiCategory,
  type HealthInputV1,
  type HealthResultSerializableV1,
  type HealthWarningCode,
  HEALTH_ALGORITHM_VERSION,
  healthInputV1Schema,
  type PrimaryGoal,
  type SexForCalorieEstimation,
  type WeightProjectionPoint,
} from '@/shared/contracts/health'

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP })

export const HEALTH_V1_CONSTANTS = {
  activityFactors: {
    sedentary: '1.200',
    light: '1.375',
    moderate: '1.550',
    active: '1.725',
    very_active: '1.900',
  } satisfies Record<ActivityLevel, string>,
  calorieFloorBySex: {
    female: 1200,
    male: 1500,
  } satisfies Record<SexForCalorieEstimation, number>,
  calorieCeiling: 4500,
  energyPerKgKcal: 7700,
  maximumPredictionWeeks: 104,
  maximumTargetChangeRatio: '0.40',
  maintenanceMinimumToleranceKg: 1,
  maintenanceToleranceRatio: '0.02',
  lossMaximumWeeklyKg: '0.907',
  lossMaximumWeeklyWeightRatio: '0.01',
  gainMaximumWeeklyKg: '0.454',
  gainMaximumWeeklyWeightRatio: '0.005',
} as const

export const TARGET_PLAUSIBILITY_REASON_VALUES = [
  'TARGET_CHANGE_EXCEEDS_40_PERCENT',
  'LOSS_TARGET_NOT_BELOW_CURRENT',
  'LOSS_TARGET_BMI_BELOW_18_5',
  'GAIN_TARGET_NOT_ABOVE_CURRENT',
  'GAIN_TARGET_BMI_ABOVE_40',
  'MAINTENANCE_TARGET_OUTSIDE_TOLERANCE',
] as const

export type TargetPlausibilityReason = (typeof TARGET_PLAUSIBILITY_REASON_VALUES)[number]

export type TargetPlausibilityResult =
  | { ok: true }
  | {
      ok: false
      code: 'UNREASONABLE_TARGET'
      reason: TargetPlausibilityReason
    }

export type HealthInputValidationIssue = {
  path: string[]
  code: string
  message: string
}

export type HealthResultV1 = HealthResultSerializableV1 & {
  /** Kept as an exact Decimal for persistence/auditing; never exposed by public DTO serializers. */
  bmiRaw: Decimal
}

export type HealthAssessmentEvaluationV1 =
  | {
      ok: true
      input: HealthInputV1
      result: HealthResultV1
    }
  | {
      ok: false
      error: {
        kind: 'input_validation'
        code: 'VALIDATION_FAILED'
        issues: HealthInputValidationIssue[]
      }
    }
  | {
      ok: false
      error: {
        kind: 'target_plausibility'
        code: 'UNREASONABLE_TARGET'
        reason: TargetPlausibilityReason
      }
    }
  | {
      ok: false
      error: {
        kind: 'invalid_timestamp'
        code: 'INVALID_ASSESSMENT_TIMESTAMP'
      }
    }

type HealthAssessmentFailureV1 = Extract<HealthAssessmentEvaluationV1, { ok: false }>['error']

export class HealthAssessmentDomainError extends Error {
  readonly failure: HealthAssessmentFailureV1

  constructor(failure: HealthAssessmentFailureV1) {
    super(failure.code)
    this.name = 'HealthAssessmentDomainError'
    this.failure = failure
  }
}

const decimal = (value: number | string): Decimal => new D(value)

const roundToNumber = (value: Decimal, decimalPlaces: number): number =>
  value.toDecimalPlaces(decimalPlaces, Decimal.ROUND_HALF_UP).toNumber()

const calculateRawBmi = (weightKg: Decimal, heightCm: Decimal): Decimal => {
  const heightMeters = heightCm.div(100)
  return weightKg.div(heightMeters.pow(2))
}

const classifyRawBmi = (bmiRaw: Decimal): BmiCategory => {
  if (bmiRaw.lt('18.5')) {
    return 'underweight'
  }
  if (bmiRaw.lt(25)) {
    return 'healthy_weight'
  }
  if (bmiRaw.lt(30)) {
    return 'overweight'
  }
  return 'obesity'
}

const exhaustiveGoal = (goal: never): never => {
  throw new Error(`Unsupported primary goal: ${String(goal)}`)
}

const calculateRawCalories = (
  goal: PrimaryGoal,
  tdeeRaw: Decimal,
): { caloriesRaw: Decimal; dailyEnergyDelta: Decimal } => {
  switch (goal) {
    case 'lose_weight': {
      const deficit = D.min(500, tdeeRaw.mul('0.20'))
      return { caloriesRaw: tdeeRaw.minus(deficit), dailyEnergyDelta: deficit }
    }
    case 'maintain_weight':
      return { caloriesRaw: tdeeRaw, dailyEnergyDelta: decimal(0) }
    case 'gain_weight': {
      const surplus = D.min(300, tdeeRaw.mul('0.12'))
      return { caloriesRaw: tdeeRaw.plus(surplus), dailyEnergyDelta: surplus }
    }
    default:
      return exhaustiveGoal(goal)
  }
}

const formatUtcCalendarDate = (timestamp: Date): string => timestamp.toISOString().slice(0, 10)

const addUtcDays = (timestamp: Date, days: number): Date =>
  new Date(
    Date.UTC(timestamp.getUTCFullYear(), timestamp.getUTCMonth(), timestamp.getUTCDate() + days),
  )

const makeProjection = (
  input: HealthInputV1,
  startTimestamp: Date,
  weeklyRate: Decimal,
  weeks: number,
): WeightProjectionPoint[] => {
  const currentWeight = decimal(input.weightKg)
  const targetWeight = decimal(input.targetWeightKg)
  const projection: WeightProjectionPoint[] = []

  for (let week = 0; week <= weeks; week += 1) {
    const unboundedWeight =
      input.primaryGoal === 'lose_weight'
        ? currentWeight.minus(weeklyRate.mul(week))
        : currentWeight.plus(weeklyRate.mul(week))

    const boundedWeight =
      input.primaryGoal === 'lose_weight'
        ? D.max(targetWeight, unboundedWeight)
        : D.min(targetWeight, unboundedWeight)

    projection.push({
      date: formatUtcCalendarDate(addUtcDays(startTimestamp, week * 7)),
      weightKg: roundToNumber(week === weeks ? targetWeight : boundedWeight, 1),
    })
  }

  return projection
}

export const validateTargetPlausibilityV1 = (input: HealthInputV1): TargetPlausibilityResult => {
  const currentWeight = decimal(input.weightKg)
  const targetWeight = decimal(input.targetWeightKg)
  const change = targetWeight.minus(currentWeight).abs()

  if (change.gt(currentWeight.mul(HEALTH_V1_CONSTANTS.maximumTargetChangeRatio))) {
    return {
      ok: false,
      code: 'UNREASONABLE_TARGET',
      reason: 'TARGET_CHANGE_EXCEEDS_40_PERCENT',
    }
  }

  switch (input.primaryGoal) {
    case 'lose_weight': {
      if (!targetWeight.lt(currentWeight)) {
        return {
          ok: false,
          code: 'UNREASONABLE_TARGET',
          reason: 'LOSS_TARGET_NOT_BELOW_CURRENT',
        }
      }

      const targetBmiRaw = calculateRawBmi(targetWeight, decimal(input.heightCm))
      return targetBmiRaw.gte('18.5')
        ? { ok: true }
        : {
            ok: false,
            code: 'UNREASONABLE_TARGET',
            reason: 'LOSS_TARGET_BMI_BELOW_18_5',
          }
    }
    case 'gain_weight': {
      if (!targetWeight.gt(currentWeight)) {
        return {
          ok: false,
          code: 'UNREASONABLE_TARGET',
          reason: 'GAIN_TARGET_NOT_ABOVE_CURRENT',
        }
      }

      const targetBmiRaw = calculateRawBmi(targetWeight, decimal(input.heightCm))
      return targetBmiRaw.lte(40)
        ? { ok: true }
        : {
            ok: false,
            code: 'UNREASONABLE_TARGET',
            reason: 'GAIN_TARGET_BMI_ABOVE_40',
          }
    }
    case 'maintain_weight': {
      const tolerance = D.max(
        HEALTH_V1_CONSTANTS.maintenanceMinimumToleranceKg,
        currentWeight.mul(HEALTH_V1_CONSTANTS.maintenanceToleranceRatio),
      )
      return change.lte(tolerance)
        ? { ok: true }
        : {
            ok: false,
            code: 'UNREASONABLE_TARGET',
            reason: 'MAINTENANCE_TARGET_OUTSIDE_TOLERANCE',
          }
    }
    default:
      return exhaustiveGoal(input.primaryGoal)
  }
}

const calculateAcceptedInput = (input: HealthInputV1, calculatedAt: Date): HealthResultV1 => {
  const weightKg = decimal(input.weightKg)
  const heightCm = decimal(input.heightCm)
  const ageYears = decimal(input.ageYears)
  const bmiRaw = calculateRawBmi(weightKg, heightCm)

  const baseBmr = weightKg.mul(10).plus(heightCm.mul('6.25')).minus(ageYears.mul(5))
  const bmrRaw = input.sexForCalorieEstimation === 'female' ? baseBmr.minus(161) : baseBmr.plus(5)
  const tdeeRaw = bmrRaw.mul(HEALTH_V1_CONSTANTS.activityFactors[input.activityLevel])
  const { caloriesRaw, dailyEnergyDelta } = calculateRawCalories(input.primaryGoal, tdeeRaw)
  const calorieFloor = HEALTH_V1_CONSTANTS.calorieFloorBySex[input.sexForCalorieEstimation]
  const calorieEstimateAvailable =
    caloriesRaw.gte(calorieFloor) && caloriesRaw.lte(HEALTH_V1_CONSTANTS.calorieCeiling)

  const baseResult = {
    algorithmVersion: HEALTH_ALGORITHM_VERSION,
    bmiRaw,
    bmi: roundToNumber(bmiRaw, 1),
    bmiCategory: classifyRawBmi(bmiRaw),
    bmrKcal: roundToNumber(bmrRaw, 0),
    tdeeKcal: roundToNumber(tdeeRaw, 0),
  } as const

  if (!calorieEstimateAvailable) {
    return {
      ...baseResult,
      calorieEstimateAvailable: false,
      exactDailyCalories: null,
      calorieRange: null,
      targetDate: null,
      weightProjection: [],
      warnings: ['PROFESSIONAL_GUIDANCE_RECOMMENDED'],
    }
  }

  const exactDailyCalories = roundToNumber(caloriesRaw, 0)
  const rangeCenter = decimal(exactDailyCalories).toNearest(100, Decimal.ROUND_HALF_UP)
  const calorieRange = {
    min: D.max(calorieFloor, rangeCenter.minus(100)).toNumber(),
    max: D.min(HEALTH_V1_CONSTANTS.calorieCeiling, rangeCenter.plus(100)).toNumber(),
  }

  if (input.primaryGoal === 'maintain_weight') {
    return {
      ...baseResult,
      calorieEstimateAvailable: true,
      exactDailyCalories,
      calorieRange,
      targetDate: null,
      weightProjection: [
        {
          date: formatUtcCalendarDate(calculatedAt),
          weightKg: roundToNumber(weightKg, 1),
        },
      ],
      warnings: ['MAINTENANCE_GOAL_NO_ARRIVAL_DATE'],
    }
  }

  const rawWeeklyRate = dailyEnergyDelta.mul(7).div(HEALTH_V1_CONSTANTS.energyPerKgKcal)
  const weeklyRate =
    input.primaryGoal === 'lose_weight'
      ? D.min(
          rawWeeklyRate,
          HEALTH_V1_CONSTANTS.lossMaximumWeeklyKg,
          weightKg.mul(HEALTH_V1_CONSTANTS.lossMaximumWeeklyWeightRatio),
        )
      : D.min(
          rawWeeklyRate,
          HEALTH_V1_CONSTANTS.gainMaximumWeeklyKg,
          weightKg.mul(HEALTH_V1_CONSTANTS.gainMaximumWeeklyWeightRatio),
        )

  const weightDelta = weightKg.minus(decimal(input.targetWeightKg)).abs()
  const weeks = weightDelta.div(weeklyRate).ceil().toNumber()

  if (weeks > HEALTH_V1_CONSTANTS.maximumPredictionWeeks) {
    return {
      ...baseResult,
      calorieEstimateAvailable: true,
      exactDailyCalories,
      calorieRange,
      targetDate: null,
      weightProjection: [],
      warnings: ['PREDICTION_HORIZON_EXCEEDED'],
    }
  }

  return {
    ...baseResult,
    calorieEstimateAvailable: true,
    exactDailyCalories,
    calorieRange,
    targetDate: formatUtcCalendarDate(addUtcDays(calculatedAt, weeks * 7)),
    weightProjection: makeProjection(input, calculatedAt, weeklyRate, weeks),
    warnings: [] satisfies HealthWarningCode[],
  }
}

export const evaluateHealthAssessmentV1 = (
  rawInput: unknown,
  calculatedAt: Date,
): HealthAssessmentEvaluationV1 => {
  const parsedInput = healthInputV1Schema.safeParse(rawInput)
  if (!parsedInput.success) {
    return {
      ok: false,
      error: {
        kind: 'input_validation',
        code: 'VALIDATION_FAILED',
        issues: parsedInput.error.issues.map((issue) => ({
          path: issue.path.map(String),
          code: issue.code,
          message: issue.message,
        })),
      },
    }
  }

  if (!(calculatedAt instanceof Date) || !Number.isFinite(calculatedAt.getTime())) {
    return {
      ok: false,
      error: {
        kind: 'invalid_timestamp',
        code: 'INVALID_ASSESSMENT_TIMESTAMP',
      },
    }
  }

  const targetPlausibility = validateTargetPlausibilityV1(parsedInput.data)
  if (!targetPlausibility.ok) {
    return {
      ok: false,
      error: {
        kind: 'target_plausibility',
        code: targetPlausibility.code,
        reason: targetPlausibility.reason,
      },
    }
  }

  return {
    ok: true,
    input: parsedInput.data,
    result: calculateAcceptedInput(parsedInput.data, new Date(calculatedAt.getTime())),
  }
}

/**
 * Convenience API for trusted callers that prefer a typed exception over a
 * discriminated failure. Boundary code should normally use evaluateHealthAssessmentV1.
 */
export const calculateHealthAssessmentV1 = (
  input: HealthInputV1,
  calculatedAt: Date,
): HealthResultV1 => {
  const evaluation = evaluateHealthAssessmentV1(input, calculatedAt)
  if (!evaluation.ok) {
    throw new HealthAssessmentDomainError(evaluation.error)
  }
  return evaluation.result
}
