'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  activateDemoAccess,
  getAssessmentResult,
  getFunnel,
  isHealthApiError,
} from '@/client/health-api'
import type { FunnelAnswers } from '@/shared/contracts/funnel'
import { answerLabel } from '@/components/quiz/questions'
import { SiteHeader } from '@/components/site-header'
import { UpgradeDialog } from '@/components/results/upgrade-dialog'
import type {
  BmiCategory,
  FullResultData,
  HealthWarningCode,
  PreviewResultData,
  ResultAccessData,
  WeightProjectionPoint,
} from '@/shared/contracts'

const BMI_LABELS: Record<BmiCategory, string> = {
  underweight: 'Below the reference range',
  healthy_weight: 'Within the reference range',
  overweight: 'Above the reference range',
  obesity: 'Well above the reference range',
}

const WARNING_LABELS: Record<HealthWarningCode, string> = {
  PROFESSIONAL_GUIDANCE_RECOMMENDED:
    'Your needs deserve a more individual approach. A qualified clinician or dietitian can help you choose a suitable energy target.',
  PREDICTION_HORIZON_EXCEEDED:
    'This goal calls for a longer-term approach. Focus on small milestones and review your progress over time.',
  MAINTENANCE_GOAL_NO_ARRIVAL_DATE:
    'Maintenance goals do not have an arrival date; the estimate focuses on sustaining a range.',
}

function resultErrorMessage(error: unknown): string {
  if (!isHealthApiError(error)) {
    return 'We couldn’t load your summary. Please try again.'
  }
  if (error.code === 'SESSION_REQUIRED' || error.code === 'SESSION_EXPIRED') {
    return 'This result belongs to a private session that is no longer available in this browser.'
  }
  if (error.code === 'ASSESSMENT_NOT_FOUND') {
    return 'This assessment was not found for the current private session.'
  }
  return 'We couldn’t load your summary. Please try again.'
}

export function ResultExperience({ assessmentId }: { assessmentId: string }) {
  const [result, setResult] = useState<ResultAccessData | null>(null)
  const [preferences, setPreferences] = useState<FunnelAnswers | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isPaying, setIsPaying] = useState(false)
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const paymentKeyRef = useRef<string | null>(null)
  const openDialog = useCallback(() => setIsDialogOpen(true), [])
  const closeDialog = useCallback(() => setIsDialogOpen(false), [])

  const loadResult = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    try {
      const response = await getAssessmentResult(assessmentId)
      setResult(response.data)
      const funnel = await getFunnel(assessmentId)
      setPreferences(funnel.data.answers)
    } catch (error) {
      setLoadError(resultErrorMessage(error))
    } finally {
      setIsLoading(false)
    }
  }, [assessmentId])

  useEffect(() => {
    // Result access is personalized and must be fetched after hydration. The
    // tiny defer also prevents a synchronous effect-to-state render cascade.
    const taskId = window.setTimeout(() => {
      void loadResult()
    }, 0)
    return () => window.clearTimeout(taskId)
  }, [loadResult])

  async function unlockResult() {
    if (isPaying) return
    const idempotencyKey = paymentKeyRef.current ?? crypto.randomUUID()
    paymentKeyRef.current = idempotencyKey
    setIsPaying(true)
    setPaymentError(null)

    try {
      await activateDemoAccess(assessmentId, idempotencyKey)
      const refreshed = await getAssessmentResult(assessmentId)
      setResult(refreshed.data)
      paymentKeyRef.current = null
      closeDialog()
    } catch (error) {
      setPaymentError(resultErrorMessage(error))
    } finally {
      setIsPaying(false)
    }
  }

  if (isLoading) {
    return (
      <main className="result-page">
        <SiteHeader compact />
        <section className="center-state" aria-live="polite">
          <span className="loading-ring" aria-hidden="true" />
          <p className="eyebrow">A little time for you</p>
          <h1>Your summary is on its way…</h1>
        </section>
      </main>
    )
  }

  if (loadError !== null || result === null) {
    return (
      <main className="result-page">
        <SiteHeader compact />
        <section className="center-state">
          <p className="eyebrow">Result unavailable</p>
          <h1>We could not open this snapshot.</h1>
          <p>{loadError ?? 'We couldn’t load your summary. Please try again.'}</p>
          <div className="button-row button-row--centered">
            <button className="primary-action" type="button" onClick={() => void loadResult()}>
              Try again
            </button>
            <Link className="secondary-action" href="/">
              Return home
            </Link>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="result-page">
      <SiteHeader compact />
      <div className="result-wrap">
        <header className="result-heading">
          <p className="eyebrow">Your wellness snapshot</p>
          <h1>
            {result.access === 'full'
              ? 'Your next chapter starts here.'
              : 'Your personal starting point.'}
          </h1>
          <p>Small steps, chosen around your goals and everyday life.</p>
          <span
            className={
              result.access === 'full' ? 'access-badge access-badge--full' : 'access-badge'
            }
          >
            {result.access === 'full' ? 'Your full summary' : 'Your first look'}
          </span>
        </header>

        {preferences?.experience && <RoutineSummary answers={preferences} />}

        <section className="result-overview" aria-label="BMI overview">
          <div className="bmi-orbit" aria-hidden="true">
            <span>{result.bmi}</span>
            <small>BMI</small>
          </div>
          <div>
            <p className="metric-label">BMI reference category</p>
            <h2>{BMI_LABELS[result.bmiCategory]}</h2>
            <p>
              One part of your starting point. Your energy, strength, and everyday wellbeing matter
              too.
            </p>
          </div>
        </section>

        {result.access === 'preview' ? (
          <PreviewResult result={result} onUnlock={openDialog} />
        ) : (
          <FullResult result={result} />
        )}

        <EducationalFooter />
      </div>

      <UpgradeDialog
        hasEstimate={result.calorieRange !== null}
        hasTimeline={result.warnings.length === 0 && result.calorieRange !== null}
        open={isDialogOpen}
        isPaying={isPaying}
        error={paymentError}
        onClose={closeDialog}
        onConfirm={() => void unlockResult()}
      />
    </main>
  )
}

function PreviewResult({ result, onUnlock }: { result: PreviewResultData; onUnlock: () => void }) {
  return (
    <>
      <section className="preview-grid" aria-label="Free result preview">
        <article className="metric-card metric-card--accent">
          <p className="metric-label">Your daily energy guide</p>
          {result.calorieRange === null ? (
            <strong>Individual guidance recommended</strong>
          ) : (
            <strong>
              {result.calorieRange.min.toLocaleString()}–{result.calorieRange.max.toLocaleString()}
              <small> kcal / day</small>
            </strong>
          )}
          <p>A starting range to support your chosen goal and everyday activity.</p>
        </article>
        <article className="metric-card">
          <p className="metric-label">A sustainable pace</p>
          <h2>Gradual beats dramatic.</h2>
          <p>
            Give yourself room to build a routine you enjoy. Small, repeatable changes can fit more
            naturally into everyday life.
          </p>
        </article>
      </section>

      <Warnings warnings={result.warnings} />

      <section className="locked-panel" aria-labelledby="locked-title">
        <div className="locked-copy">
          <div className="lock-symbol" aria-hidden="true">
            <svg viewBox="0 0 28 28" focusable="false">
              <path d="M9.5 12V8.75a4.5 4.5 0 0 1 9 0V12M7 12h14v11H7z" />
            </svg>
          </div>
          <p className="eyebrow">Your next step</p>
          <h2 id="locked-title">See where your next chapter could take you.</h2>
          <p>
            {result.calorieRange === null
              ? 'Explore your daily energy overview alongside your personal movement suggestions. A calorie target and timeline aren’t available for this assessment.'
              : result.warnings.length > 0
                ? 'Explore your personal energy guide. A target-date prediction isn’t available for this goal.'
                : 'Explore your personal energy target and estimated progress, all in one place.'}
          </p>
          <button className="primary-action" type="button" onClick={onUnlock}>
            Explore my full summary
            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path d="m7.5 4.5 5 5-5 5" />
            </svg>
          </button>
        </div>
        <div className="locked-stack" aria-label="Locked result sections">
          {(result.calorieRange === null
            ? ['Your energy at rest', 'Your daily energy overview']
            : result.warnings.length > 0
              ? ['Your daily energy target', 'Your daily energy overview']
              : ['Your daily energy target', 'Your estimated timeline', 'Your progress outlook']
          ).map((label) => (
            <div key={label}>
              <span>{label}</span>
              <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                <path d="M7 9V7a3 3 0 0 1 6 0v2M5.5 9h9v7h-9z" />
              </svg>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

function FullResult({ result }: { result: FullResultData }) {
  return (
    <>
      <section className="full-metrics" aria-label="Full energy estimate">
        <MetricCard
          label="Energy at rest"
          value={result.bmrKcal.toLocaleString()}
          unit="kcal / day"
        />
        <MetricCard
          label="Daily energy estimate"
          value={result.tdeeKcal.toLocaleString()}
          unit="kcal / day"
        />
        <MetricCard
          label="Your daily energy target"
          value={result.exactDailyCalories?.toLocaleString() ?? 'Unavailable'}
          unit={result.exactDailyCalories === null ? 'See guidance below' : 'kcal / day'}
          featured
        />
      </section>

      {result.calorieEstimateAvailable ? (
        <section className="timeline-panel" aria-labelledby="timeline-title">
          <div className="timeline-copy">
            <p className="eyebrow">Estimated direction</p>
            <h2 id="timeline-title">
              {result.targetDate === null
                ? result.warnings.includes('MAINTENANCE_GOAL_NO_ARRIVAL_DATE')
                  ? 'Maintain a steady range.'
                  : 'Take a longer-term view.'
                : `An estimated target date of ${formatDate(result.targetDate)}.`}
            </h2>
            <p>
              Think of this as a direction to work toward. Your pace may change, and that is okay.
            </p>
            {result.calorieRange !== null && (
              <p className="range-note">
                Daily guide: {result.calorieRange.min.toLocaleString()}–
                {result.calorieRange.max.toLocaleString()} kcal/day
              </p>
            )}
          </div>
          {result.weightProjection.length > 1 ? (
            <ProjectionChart points={result.weightProjection} />
          ) : (
            <div className="chart-empty">
              {result.warnings.includes('MAINTENANCE_GOAL_NO_ARRIVAL_DATE')
                ? 'Your goal is to maintain a comfortable range.'
                : 'Start with small milestones and review your progress over time.'}
            </div>
          )}
        </section>
      ) : (
        <section className="guidance-panel" aria-labelledby="guidance-title">
          <p className="eyebrow">A more personal approach</p>
          <h2 id="guidance-title">Let’s find the right support for your goal.</h2>
          <p>
            A qualified clinician or dietitian can help you choose an energy target that fits your
            individual needs.
          </p>
        </section>
      )}

      <Warnings warnings={result.warnings} />
    </>
  )
}

function MetricCard({
  label,
  value,
  unit,
  featured = false,
}: {
  label: string
  value: string
  unit: string
  featured?: boolean
}) {
  return (
    <article className={featured ? 'metric-card metric-card--accent' : 'metric-card'}>
      <p className="metric-label">{label}</p>
      <strong>{value}</strong>
      <small>{unit}</small>
    </article>
  )
}

function ProjectionChart({ points }: { points: WeightProjectionPoint[] }) {
  const weights = points.map((point) => point.weightKg)
  const minimum = Math.min(...weights)
  const maximum = Math.max(...weights)
  const range = Math.max(maximum - minimum, 1)
  const left = 22
  const right = 698
  const top = 18
  const bottom = 188
  const polyline = points
    .map((point, index) => {
      const x = left + (index / Math.max(points.length - 1, 1)) * (right - left)
      const y = bottom - ((point.weightKg - minimum) / range) * (bottom - top)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  const first = points[0]
  const last = points.at(-1)

  return (
    <figure className="projection-chart">
      <svg
        viewBox="0 0 720 220"
        role="img"
        aria-labelledby="projection-title projection-description"
      >
        <title id="projection-title">Estimated weekly weight projection</title>
        <desc id="projection-description">
          {first === undefined || last === undefined
            ? 'No projection points.'
            : `An estimate from ${first.weightKg} kilograms on ${first.date} to ${last.weightKg} kilograms on ${last.date}.`}
        </desc>
        <path className="chart-grid" d="M22 18H698M22 103H698M22 188H698" />
        <polyline className="chart-line" points={polyline} />
        {first !== undefined && (
          <circle
            className="chart-dot"
            cx={left}
            cy={bottom - ((first.weightKg - minimum) / range) * (bottom - top)}
            r="5"
          />
        )}
        {last !== undefined && (
          <circle
            className="chart-dot"
            cx={right}
            cy={bottom - ((last.weightKg - minimum) / range) * (bottom - top)}
            r="5"
          />
        )}
      </svg>
      {first !== undefined && last !== undefined && (
        <figcaption>
          <span>
            {formatShortDate(first.date)} · {first.weightKg} kg
          </span>
          <span>
            {formatShortDate(last.date)} · {last.weightKg} kg
          </span>
        </figcaption>
      )}
    </figure>
  )
}

function Warnings({ warnings }: { warnings: HealthWarningCode[] }) {
  if (warnings.length === 0) return null
  return (
    <section className="warning-list" aria-label="Important result notes">
      {warnings.map((warning) => (
        <div key={warning}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 3.5 21 20H3L12 3.5ZM12 9v5M12 17.25v.25" />
          </svg>
          <p>{WARNING_LABELS[warning]}</p>
        </div>
      ))}
    </section>
  )
}

function EducationalFooter() {
  return (
    <footer className="result-footer">
      <div>
        <p className="eyebrow">A note about your summary</p>
        <p>
          These are general wellness estimates, not medical advice or guaranteed results. Your
          individual needs may differ. BMI alone does not measure your health.
        </p>
      </div>
      <Link className="secondary-action" href="/">
        Return to the start
      </Link>
    </footer>
  )
}

function RoutineSummary({ answers }: { answers: FunnelAnswers }) {
  return (
    <section className="routine-card">
      <p className="eyebrow">YOUR EVERYDAY MOVEMENT</p>
      <h2>A little space for what matters to you.</h2>
      <div className="routine-tags">
        {(['experience', 'minutes', 'days', 'equipment'] as const).map(
          (key) => answers[key] && <span key={key}>{answerLabel(key, answers[key])}</span>,
        )}
      </div>
      <p>Your focus: {answerLabel('motivation', answers.motivation)}.</p>
      <ul>
        <li>
          {answers.experience === 'new'
            ? 'Begin with a gentle introduction to breathing, posture, and controlled movement.'
            : answers.experience === 'some'
              ? 'Revisit familiar basics before adding more challenging movements.'
              : 'Keep a mix of familiar practice and recovery in your weekly routine.'}
        </li>
        <li>
          Set aside {answers.minutes} minutes on {answers.days} days each week.{' '}
          {answers.equipment === 'none'
            ? 'Choose a comfortable, non-slip space; a supportive mat can help with floor work.'
            : answers.equipment === 'bands'
              ? 'Start with your mat; add light resistance only when movement feels comfortable.'
              : 'Keep your mat somewhere easy to reach as a reminder to begin.'}
        </li>
        <li>
          {answers.sitting === 'mostly'
            ? 'Break up long periods of sitting with short, comfortable movement breaks.'
            : answers.sitting === 'some'
              ? 'Use a short movement break to add variety to your day.'
              : 'Balance your active day with a gentle cooldown and rest.'}
        </li>
        <li>
          {answers.focus?.includes('whole_body')
            ? 'Explore a balanced mix of whole-body movements.'
            : `Build your practice around ${answerLabel('focus', answers.focus).toLowerCase()}, alongside balanced movement.`}
        </li>
        {answers.barriers?.includes('time') && (
          <li>
            Pair your practice with a daily cue, such as finishing work, to make time easier to
            find.
          </li>
        )}
        {answers.barriers?.includes('consistency') && (
          <li>
            Put your chosen days in your calendar. Missing one day does not mean starting over.
          </li>
        )}
        {answers.barriers?.includes('confidence') && (
          <li>Look for beginner instruction and take time to learn each movement comfortably.</li>
        )}
      </ul>
    </section>
  )
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00.000Z`))
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00.000Z`))
}
