import { z } from 'zod'

import {
  activityStepDataSchema,
  bmiCategorySchema,
  bodyStepDataSchema,
  calorieRangeSchema,
  goalStepDataSchema,
  HEALTH_ALGORITHM_VERSION,
  healthWarningCodeSchema,
  isoCalendarDateSchema,
  QUIZ_VERSION,
  sexStepDataSchema,
  weightProjectionPointSchema,
} from './health'

export const ASSESSMENT_STEP_KEYS = ['sex', 'goal', 'body', 'activity'] as const
export const ASSESSMENT_NEXT_STEP_VALUES = [...ASSESSMENT_STEP_KEYS, 'review'] as const
export const ASSESSMENT_STATUS_VALUES = ['draft', 'ready', 'completed'] as const
export const PLAN_CODE_VALUES = ['demo_monthly'] as const
export const PAYMENT_OUTCOME_VALUES = ['activated', 'already_active'] as const
export const LOCKED_RESULT_FEATURES = [
  'bmrKcal',
  'tdeeKcal',
  'exactDailyCalories',
  'targetDate',
  'weightProjection',
] as const
export const PREVIEW_SUMMARY = 'A gradual plan is recommended.' as const

export const assessmentStepKeySchema = z.enum(ASSESSMENT_STEP_KEYS)
export const assessmentNextStepSchema = z.enum(ASSESSMENT_NEXT_STEP_VALUES)
export const assessmentStatusSchema = z.enum(ASSESSMENT_STATUS_VALUES)
export const planCodeSchema = z.enum(PLAN_CODE_VALUES)
export const paymentOutcomeSchema = z.enum(PAYMENT_OUTCOME_VALUES)
export const lockedResultFeatureSchema = z.enum(LOCKED_RESULT_FEATURES)

export const uuidSchema = z.string().uuid()
export const sessionIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/u, 'Expected a 256-bit base64url session credential.')
export const idempotencyKeySchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u, 'Idempotency key contains unsupported characters.')
export const revisionSchema = z.number().int().nonnegative().safe()
export const etagSchema = z.string().regex(/^"rev-(0|[1-9]\d*)"$/u)

const ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/u

const isRealIsoTimestamp = (value: string): boolean => {
  const match = ISO_TIMESTAMP_PATTERN.exec(value)
  if (match === null) return false

  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    ,
    offsetHourText,
    offsetMinuteText,
  ] = match
  if (
    yearText === undefined ||
    monthText === undefined ||
    dayText === undefined ||
    hourText === undefined ||
    minuteText === undefined ||
    secondText === undefined
  ) {
    return false
  }

  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const maximumDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText)
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText)

  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= maximumDay &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 14 &&
    offsetMinute <= 59 &&
    (offsetHour < 14 || offsetMinute === 0) &&
    Number.isFinite(Date.parse(value))
  )
}

export const isoTimestampSchema = z
  .string()
  .regex(ISO_TIMESTAMP_PATTERN, 'Expected an ISO 8601 timestamp with an explicit offset.')
  .refine(isRealIsoTimestamp, 'Expected a real ISO 8601 timestamp.')

export const emptyRequestSchema = z.strictObject({})
export const createAssessmentRequestSchema = z.strictObject({
  quizVersion: z.literal(QUIZ_VERSION),
})

export const sexStepRequestSchema = z.strictObject({ data: sexStepDataSchema })
export const goalStepRequestSchema = z.strictObject({ data: goalStepDataSchema })
export const bodyStepRequestSchema = z.strictObject({ data: bodyStepDataSchema })
export const activityStepRequestSchema = z.strictObject({ data: activityStepDataSchema })

export const stepUpdateCommandSchema = z.discriminatedUnion('stepKey', [
  z.strictObject({ stepKey: z.literal('sex'), data: sexStepDataSchema }),
  z.strictObject({ stepKey: z.literal('goal'), data: goalStepDataSchema }),
  z.strictObject({ stepKey: z.literal('body'), data: bodyStepDataSchema }),
  z.strictObject({ stepKey: z.literal('activity'), data: activityStepDataSchema }),
])

export const payRequestSchema = z.strictObject({
  assessmentId: uuidSchema,
  planCode: planCodeSchema,
})

export const assessmentAnswersSchema = z.strictObject({
  sex: sexStepDataSchema.optional(),
  goal: goalStepDataSchema.optional(),
  body: bodyStepDataSchema.optional(),
  activity: activityStepDataSchema.optional(),
})

const completedStepsSchema = z
  .array(assessmentStepKeySchema)
  .max(ASSESSMENT_STEP_KEYS.length)
  .refine(
    (steps) => steps.every((step, index) => step === ASSESSMENT_STEP_KEYS[index]),
    'Completed steps must be a unique ordered prefix of the quiz.',
  )

const expectedNextStep = (completedSteps: AssessmentStepKey[]): AssessmentNextStep =>
  ASSESSMENT_STEP_KEYS[completedSteps.length] ?? 'review'

export const assessmentProgressSchema = z
  .strictObject({
    assessmentId: uuidSchema,
    status: assessmentStatusSchema,
    quizVersion: z.literal(QUIZ_VERSION),
    revision: revisionSchema,
    completedSteps: completedStepsSchema,
    nextStep: assessmentNextStepSchema,
    answers: assessmentAnswersSchema,
    updatedAt: isoTimestampSchema,
  })
  .superRefine((progress, context) => {
    if (progress.nextStep !== expectedNextStep(progress.completedSteps)) {
      context.addIssue({
        code: 'custom',
        path: ['nextStep'],
        message: 'Next step must be derived from completed steps.',
      })
    }

    for (const stepKey of ASSESSMENT_STEP_KEYS) {
      const isComplete = progress.completedSteps.includes(stepKey)
      const hasAnswer = progress.answers[stepKey] !== undefined
      if (isComplete !== hasAnswer) {
        context.addIssue({
          code: 'custom',
          path: ['answers', stepKey],
          message: 'Answers and completed steps must describe the same persisted progress.',
        })
      }
    }

    const allStepsComplete = progress.completedSteps.length === ASSESSMENT_STEP_KEYS.length
    if ((progress.status === 'draft') === allStepsComplete) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Draft assessments are incomplete; ready/completed assessments are complete.',
      })
    }
  })

export const createSessionDataSchema = z.discriminatedUnion('reused', [
  z.strictObject({
    sessionId: sessionIdSchema,
    expiresAt: isoTimestampSchema,
    reused: z.literal(false),
  }),
  z.strictObject({
    expiresAt: isoTimestampSchema,
    reused: z.literal(true),
  }),
])

export const assessmentMutationDataSchema = z
  .strictObject({
    assessmentId: uuidSchema,
    status: assessmentStatusSchema,
    revision: revisionSchema,
    completedSteps: completedStepsSchema,
    nextStep: assessmentNextStepSchema,
    updatedAt: isoTimestampSchema,
  })
  .superRefine((progress, context) => {
    if (progress.nextStep !== expectedNextStep(progress.completedSteps)) {
      context.addIssue({
        code: 'custom',
        path: ['nextStep'],
        message: 'Next step must be derived from completed steps.',
      })
    }

    const allStepsComplete = progress.completedSteps.length === ASSESSMENT_STEP_KEYS.length
    if ((progress.status === 'draft') === allStepsComplete) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Draft assessments are incomplete; ready/completed assessments are complete.',
      })
    }
  })

export const submitAssessmentDataSchema = z.strictObject({
  assessmentId: uuidSchema,
  resultId: uuidSchema,
  status: z.literal('completed'),
  calculatedAt: isoTimestampSchema,
})

export const payDataSchema = z.strictObject({
  assessmentId: uuidSchema,
  planCode: planCodeSchema,
  outcome: paymentOutcomeSchema,
  subscriptionStatus: z.literal('active'),
  validFrom: isoTimestampSchema,
  validUntil: isoTimestampSchema.nullable(),
})

const warningsSchema = z
  .array(healthWarningCodeSchema)
  .max(3)
  .refine((warnings) => new Set(warnings).size === warnings.length, {
    message: 'Warning codes must be unique.',
  })

export const previewResultDataSchema = z.strictObject({
  access: z.literal('preview'),
  bmi: z.number().finite().positive(),
  bmiCategory: bmiCategorySchema,
  summary: z.literal(PREVIEW_SUMMARY),
  calorieRange: calorieRangeSchema.nullable(),
  warnings: warningsSchema,
  upgradeRequired: z.literal(true),
  lockedFeatures: z.tuple([
    z.literal('bmrKcal'),
    z.literal('tdeeKcal'),
    z.literal('exactDailyCalories'),
    z.literal('targetDate'),
    z.literal('weightProjection'),
  ]),
})

export const fullResultDataSchema = z
  .strictObject({
    access: z.literal('full'),
    bmi: z.number().finite().positive(),
    bmiCategory: bmiCategorySchema,
    bmrKcal: z.number().finite().int().positive(),
    tdeeKcal: z.number().finite().int().positive(),
    exactDailyCalories: z.number().finite().int().positive().nullable(),
    calorieRange: calorieRangeSchema.nullable(),
    calorieEstimateAvailable: z.boolean(),
    targetDate: isoCalendarDateSchema.nullable(),
    weightProjection: z.array(weightProjectionPointSchema).max(105),
    warnings: warningsSchema,
    algorithmVersion: z.literal(HEALTH_ALGORITHM_VERSION),
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

export const resultAccessDataSchema = z.discriminatedUnion('access', [
  previewResultDataSchema,
  fullResultDataSchema,
])

export const fieldProblemSchema = z.strictObject({
  path: z.string(),
  code: z.string().min(1),
  message: z.string().min(1),
})

export const problemDetailsSchema = z.strictObject({
  type: z.string().min(1),
  title: z.string().min(1),
  status: z.number().int().min(400).max(599),
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/u),
  detail: z.string().min(1),
  traceId: z.string().min(1),
  errors: z.array(fieldProblemSchema).optional(),
  meta: z.strictObject({ currentRevision: revisionSchema.optional() }).optional(),
})

export type AssessmentStepKey = z.infer<typeof assessmentStepKeySchema>
export type AssessmentNextStep = z.infer<typeof assessmentNextStepSchema>
export type AssessmentStatus = z.infer<typeof assessmentStatusSchema>
export type PlanCode = z.infer<typeof planCodeSchema>
export type PaymentOutcome = z.infer<typeof paymentOutcomeSchema>
export type LockedResultFeature = z.infer<typeof lockedResultFeatureSchema>
export type StepUpdateCommand = z.infer<typeof stepUpdateCommandSchema>
export type AssessmentAnswers = z.infer<typeof assessmentAnswersSchema>
export type AssessmentProgress = z.infer<typeof assessmentProgressSchema>
export type CreateSessionData = z.infer<typeof createSessionDataSchema>
export type AssessmentMutationData = z.infer<typeof assessmentMutationDataSchema>
export type SubmitAssessmentData = z.infer<typeof submitAssessmentDataSchema>
export type PayData = z.infer<typeof payDataSchema>
export type PreviewResultData = z.infer<typeof previewResultDataSchema>
export type FullResultData = z.infer<typeof fullResultDataSchema>
export type ResultAccessData = z.infer<typeof resultAccessDataSchema>
export type ProblemDetails = z.infer<typeof problemDetailsSchema>
