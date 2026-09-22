'use client'

import { useState } from 'react'

import { SiteHeader } from '@/components/site-header'
import { UpgradeDialog } from '@/components/results/upgrade-dialog'
import {
  EducationalFooter,
  FullResult,
  PreviewResult,
  PreviewUnlockRail,
  ResultProfile,
  RoutineSummary,
} from '@/components/results/result-experience'
import type { FunnelAnswers } from '@/shared/contracts/funnel'
import type { FullResultData, PreviewResultData } from '@/shared/contracts'

const MOCK_ANSWERS: FunnelAnswers = {
  motivation: ['strength'],
  primaryGoal: 'lose_weight',
  experience: 'some',
  activityLevel: 'moderate',
  sitting: 'some',
  focus: ['whole_body'],
  barriers: ['time'],
  minutes: '20',
  days: '3',
  equipment: 'mat',
  sexForCalorieEstimation: 'female',
  ageYears: 32,
  heightCm: 168,
  weightKg: 66,
  targetWeightKg: 64,
}

const MOCK_PREVIEW: PreviewResultData = {
  access: 'preview',
  bmi: 23.4,
  bmiCategory: 'healthy_weight',
  summary: 'A gradual plan is recommended.',
  calorieRange: { min: 1550, max: 1750 },
  warnings: [],
  upgradeRequired: true,
  lockedFeatures: ['bmrKcal', 'tdeeKcal', 'exactDailyCalories', 'targetDate', 'weightProjection'],
}

const MOCK_FULL: FullResultData = {
  access: 'full',
  bmi: 23.4,
  bmiCategory: 'healthy_weight',
  bmrKcal: 1410,
  tdeeKcal: 1939,
  exactDailyCalories: 1648,
  calorieRange: { min: 1550, max: 1750 },
  calorieEstimateAvailable: true,
  targetDate: '2027-01-18',
  weightProjection: [
    { date: '2026-09-22', weightKg: 66 },
    { date: '2026-10-13', weightKg: 65.6 },
    { date: '2026-11-03', weightKg: 65.1 },
    { date: '2026-11-24', weightKg: 64.7 },
    { date: '2026-12-15', weightKg: 64.3 },
    { date: '2027-01-18', weightKg: 64 },
  ],
  warnings: [],
  algorithmVersion: 'health-v1',
}

/**
 * Fixed-data UI harness for reviewing the paywall without completing the funnel.
 * It intentionally does not call Supabase or mutate a real assessment.
 */
export function DemoPaywallExperience() {
  const [isFull, setIsFull] = useState(false)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isPaying, setIsPaying] = useState(false)

  function unlockMockResult() {
    if (isPaying) return
    setIsPaying(true)
    window.setTimeout(() => {
      setIsFull(true)
      setIsPaying(false)
      setIsDialogOpen(false)
    }, 550)
  }

  const result = isFull ? MOCK_FULL : MOCK_PREVIEW

  return (
    <main className={isFull ? 'result-page' : 'result-page result-page--preview'}>
      <SiteHeader compact />
      {!isFull && <PreviewUnlockRail onUnlock={() => setIsDialogOpen(true)} />}
      <div className="result-wrap result-editorial demo-paywall-wrap">
        <header className="result-heading">
          <p className="eyebrow">YOUR WELLNESS PROFILE</p>
          <h1>Here’s your wellness profile</h1>
          <p>A preview of your personal summary. No payment is collected here.</p>
          <span className={isFull ? 'access-badge access-badge--full' : 'access-badge'}>
            {isFull ? 'Your full summary' : 'Your free preview'}
          </span>
        </header>

        <ResultProfile result={result} answers={MOCK_ANSWERS} />
        {isFull ? (
          <FullResult result={MOCK_FULL} />
        ) : (
          <PreviewResult result={MOCK_PREVIEW} onUnlock={() => setIsDialogOpen(true)} />
        )}
        <RoutineSummary answers={MOCK_ANSWERS} />
        <EducationalFooter />
      </div>

      <UpgradeDialog
        hasEstimate
        hasTimeline
        open={isDialogOpen}
        isPaying={isPaying}
        error={null}
        onClose={() => setIsDialogOpen(false)}
        onConfirm={unlockMockResult}
      />
    </main>
  )
}
