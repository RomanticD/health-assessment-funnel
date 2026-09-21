import Decimal from 'decimal.js'
import { z } from 'zod'

export const HEALTH_ALGORITHM_VERSION = 'health-v1' as const
export const QUIZ_VERSION = 'health-v1' as const

export const SEX_VALUES = ['female', 'male'] as const
export const PRIMARY_GOAL_VALUES = ['lose_weight', 'maintain_weight', 'gain_weight'] as const
export const ACTIVITY_LEVEL_VALUES = [
  'sedentary',
  'light',
  'moderate',
  'active',
  'very_active',
] as const
export const BMI_CATEGORY_VALUES = [
  'underweight',
  'healthy_weight',
  'overweight',
  'obesity',
] as const
export const HEALTH_WARNING_CODE_VALUES = [
  'PROFESSIONAL_GUIDANCE_RECOMMENDED',
  'PREDICTION_HORIZON_EXCEEDED',
  'MAINTENANCE_GOAL_NO_ARRIVAL_DATE',
] as const

export const HEALTH_INPUT_BOUNDS = {
  ageYears: { min: 18, max: 80 },
  heightCm: { min: 120, max: 230 },
  weightKg: { min: 35, max: 300 },
  targetWeightKg: { min: 35, max: 300 },
} as const

export const sexForCalorieEstimationSchema = z.enum(SEX_VALUES)
export const primaryGoalSchema = z.enum(PRIMARY_GOAL_VALUES)
export const activityLevelSchema = z.enum(ACTIVITY_LEVEL_VALUES)
export const bmiCategorySchema = z.enum(BMI_CATEGORY_VALUES)
export const healthWarningCodeSchema = z.enum(HEALTH_WARNING_CODE_VALUES)

const hasAtMostTwoDecimalPlaces = (value: number): boolean =>
  new Decimal(value.toString()).decimalPlaces() <= 2

const measurementSchema = (minimum: number, maximum: number) =>
  z.number().finite().min(minimum).max(maximum).refine(hasAtMostTwoDecimalPlaces, {
    message: 'Measurements support at most two decimal places.',
  })

export const ageYearsSchema = z
  .number()
  .finite()
  .int()
  .min(HEALTH_INPUT_BOUNDS.ageYears.min)
  .max(HEALTH_INPUT_BOUNDS.ageYears.max)

export const heightCmSchema = measurementSchema(
  HEALTH_INPUT_BOUNDS.heightCm.min,
  HEALTH_INPUT_BOUNDS.heightCm.max,
)
export const weightKgSchema = measurementSchema(
  HEALTH_INPUT_BOUNDS.weightKg.min,
  HEALTH_INPUT_BOUNDS.weightKg.max,
)
export const targetWeightKgSchema = measurementSchema(
  HEALTH_INPUT_BOUNDS.targetWeightKg.min,
  HEALTH_INPUT_BOUNDS.targetWeightKg.max,
)

export const sexStepDataSchema = z.strictObject({
  sexForCalorieEstimation: sexForCalorieEstimationSchema,
})

export const goalStepDataSchema = z.strictObject({
  primaryGoal: primaryGoalSchema,
})

export const bodyStepDataSchema = z.strictObject({
  ageYears: ageYearsSchema,
  heightCm: heightCmSchema,
  weightKg: weightKgSchema,
  targetWeightKg: targetWeightKgSchema,
})

export const activityStepDataSchema = z.strictObject({
  activityLevel: activityLevelSchema,
})

export const healthInputV1Schema = z.strictObject({
  sexForCalorieEstimation: sexForCalorieEstimationSchema,
  primaryGoal: primaryGoalSchema,
  ageYears: ageYearsSchema,
  heightCm: heightCmSchema,
  weightKg: weightKgSchema,
  targetWeightKg: targetWeightKgSchema,
  activityLevel: activityLevelSchema,
})

export const calorieRangeSchema = z.strictObject({
  min: z.number().finite().int().min(0),
  max: z.number().finite().int().min(0),
})

export const isoCalendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, 'Expected an ISO calendar date.')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  }, 'Expected a real ISO calendar date.')

export const weightProjectionPointSchema = z.strictObject({
  date: isoCalendarDateSchema,
  weightKg: z
    .number()
    .finite()
    .min(HEALTH_INPUT_BOUNDS.weightKg.min)
    .max(HEALTH_INPUT_BOUNDS.weightKg.max),
})

const uniqueWarningsSchema = z
  .array(healthWarningCodeSchema)
  .max(HEALTH_WARNING_CODE_VALUES.length)
  .refine((warnings) => new Set(warnings).size === warnings.length, {
    message: 'Warning codes must be unique.',
  })

export const healthResultSerializableV1Schema = z
  .strictObject({
    algorithmVersion: z.literal(HEALTH_ALGORITHM_VERSION),
    bmi: z.number().finite().positive(),
    bmiCategory: bmiCategorySchema,
    bmrKcal: z.number().finite().int().positive(),
    tdeeKcal: z.number().finite().int().positive(),
    calorieEstimateAvailable: z.boolean(),
    exactDailyCalories: z.number().finite().int().positive().nullable(),
    calorieRange: calorieRangeSchema.nullable(),
    targetDate: isoCalendarDateSchema.nullable(),
    weightProjection: z.array(weightProjectionPointSchema).max(105),
    warnings: uniqueWarningsSchema,
  })
  .superRefine((result, context) => {
    if (result.calorieRange !== null && result.calorieRange.min > result.calorieRange.max) {
      context.addIssue({
        code: 'custom',
        path: ['calorieRange'],
        message: 'Calorie range minimum cannot exceed its maximum.',
      })
    }

    if (
      result.calorieEstimateAvailable &&
      (result.exactDailyCalories === null || result.calorieRange === null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['calorieEstimateAvailable'],
        message: 'Available calorie estimates require exact calories and a preview range.',
      })
    }

    if (
      !result.calorieEstimateAvailable &&
      (result.exactDailyCalories !== null ||
        result.calorieRange !== null ||
        result.targetDate !== null ||
        result.weightProjection.length !== 0 ||
        !result.warnings.includes('PROFESSIONAL_GUIDANCE_RECOMMENDED'))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['calorieEstimateAvailable'],
        message:
          'Unavailable calorie estimates must redact prediction details and carry a warning.',
      })
    }
  })

export type SexForCalorieEstimation = z.infer<typeof sexForCalorieEstimationSchema>
export type PrimaryGoal = z.infer<typeof primaryGoalSchema>
export type ActivityLevel = z.infer<typeof activityLevelSchema>
export type BmiCategory = z.infer<typeof bmiCategorySchema>
export type HealthWarningCode = z.infer<typeof healthWarningCodeSchema>
export type SexStepData = z.infer<typeof sexStepDataSchema>
export type GoalStepData = z.infer<typeof goalStepDataSchema>
export type BodyStepData = z.infer<typeof bodyStepDataSchema>
export type ActivityStepData = z.infer<typeof activityStepDataSchema>
export type HealthInputV1 = z.infer<typeof healthInputV1Schema>
export type CalorieRange = z.infer<typeof calorieRangeSchema>
export type WeightProjectionPoint = z.infer<typeof weightProjectionPointSchema>
export type HealthResultSerializableV1 = z.infer<typeof healthResultSerializableV1Schema>
