import {
  type FullResultData,
  LOCKED_RESULT_FEATURES,
  PREVIEW_SUMMARY,
  type PreviewResultData,
  fullResultDataSchema,
  previewResultDataSchema,
} from '@/shared/contracts/api'

import type { HealthResultV1 } from './health-assessment-v1'

/**
 * Builds a preview from an allow-list. Protected values are never added to the
 * object, so there is no fragile "build full, then delete" redaction phase.
 */
export const toPreviewResultData = (result: HealthResultV1): PreviewResultData =>
  previewResultDataSchema.parse({
    access: 'preview',
    bmi: result.bmi,
    bmiCategory: result.bmiCategory,
    summary: PREVIEW_SUMMARY,
    calorieRange: result.calorieRange,
    warnings: result.warnings,
    upgradeRequired: true,
    lockedFeatures: LOCKED_RESULT_FEATURES,
  })

export const toFullResultData = (result: HealthResultV1): FullResultData =>
  fullResultDataSchema.parse({
    access: 'full',
    bmi: result.bmi,
    bmiCategory: result.bmiCategory,
    bmrKcal: result.bmrKcal,
    tdeeKcal: result.tdeeKcal,
    exactDailyCalories: result.exactDailyCalories,
    calorieRange: result.calorieRange,
    calorieEstimateAvailable: result.calorieEstimateAvailable,
    targetDate: result.targetDate,
    weightProjection: result.weightProjection,
    warnings: result.warnings,
    algorithmVersion: result.algorithmVersion,
  })
