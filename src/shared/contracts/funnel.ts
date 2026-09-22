import { z } from 'zod'
import {
  ageYearsSchema,
  heightCmSchema,
  weightKgSchema,
  targetWeightKgSchema,
  sexForCalorieEstimationSchema,
  primaryGoalSchema,
  activityLevelSchema,
} from './health'

const choices = <T extends string>(values: readonly [T, ...T[]]) =>
  z
    .array(z.enum(values))
    .min(1)
    .max(values.length)
    .refine((v) => new Set(v).size === v.length, 'Choose each option once.')
export const funnelAnswerSchemas = {
  motivation: choices(['strength', 'flexibility', 'posture', 'energy', 'calm']),
  primaryGoal: primaryGoalSchema,
  experience: z.enum(['new', 'some', 'regular']),
  activityLevel: activityLevelSchema,
  sitting: z.enum(['little', 'some', 'mostly']),
  focus: choices(['whole_body', 'core', 'back', 'legs', 'arms']),
  barriers: choices(['time', 'consistency', 'confidence', 'none']),
  minutes: z.enum(['10', '15', '20', '30']),
  days: z.enum(['2', '3', '4', '5']),
  equipment: z.enum(['none', 'mat', 'bands']),
  sexForCalorieEstimation: sexForCalorieEstimationSchema,
  ageYears: ageYearsSchema,
  heightCm: heightCmSchema,
  weightKg: weightKgSchema,
  targetWeightKg: targetWeightKgSchema,
} as const
export const funnelAnswersSchema = z.strictObject(funnelAnswerSchemas).partial()
export type FunnelAnswers = z.infer<typeof funnelAnswersSchema>
export type FunnelKey = keyof FunnelAnswers
export const FUNNEL_KEYS = Object.keys(funnelAnswerSchemas) as FunnelKey[]
export const funnelSnapshotSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  answers: funnelAnswersSchema,
})
export type FunnelSnapshot = z.infer<typeof funnelSnapshotSchema>
export const funnelPatchSchema = z
  .strictObject({ key: z.enum(FUNNEL_KEYS as [FunnelKey, ...FunnelKey[]]), value: z.unknown() })
  .superRefine((value, ctx) => {
    const parsed = funnelAnswerSchemas[value.key].safeParse(value.value)
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        ctx.addIssue({ code: 'custom', path: ['value'], message: issue.message })
    if (
      value.key === 'barriers' &&
      Array.isArray(value.value) &&
      value.value.includes('none') &&
      value.value.length > 1
    )
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Choose no barriers on its own.' })
    if (
      value.key === 'focus' &&
      Array.isArray(value.value) &&
      value.value.includes('whole_body') &&
      value.value.length > 1
    )
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Choose whole body on its own.' })
  })
