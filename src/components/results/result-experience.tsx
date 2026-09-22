'use client'

import Image from 'next/image'
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
      setPaymentError(`${resultErrorMessage(error)} If checkout completed, retrying is safe.`)
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
    <main
      className={result.access === 'preview' ? 'result-page result-page--preview' : 'result-page'}
    >
      <SiteHeader compact />
      {result.access === 'preview' && <PreviewUnlockRail onUnlock={openDialog} />}
      <div className="result-wrap result-editorial">
        <header className="result-heading">
          <p className="eyebrow">YOUR WELLNESS PROFILE</p>
          <h1>Here’s your wellness profile</h1>
          <p>
            A clear starting point for the way you want to move, feel, and make room for yourself.
          </p>
          <span
            className={
              result.access === 'full' ? 'access-badge access-badge--full' : 'access-badge'
            }
          >
            {result.access === 'full' ? 'Your full summary' : 'Your free preview'}
          </span>
        </header>

        <ResultProfile result={result} answers={preferences} />

        {result.access === 'preview' ? (
          <PreviewResult result={result} onUnlock={openDialog} />
        ) : (
          <FullResult result={result} />
        )}

        {preferences?.experience && <RoutineSummary answers={preferences} />}
        {result.access === 'full' && <SessionReceipt assessmentId={assessmentId} />}

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

export function PreviewUnlockRail({ onUnlock }: { onUnlock: () => void }) {
  return (
    <aside className="preview-unlock-rail" aria-label="Unlock your full summary">
      <div className="preview-unlock-rail-copy">
        <p className="eyebrow">YOUR PERSONAL PLAN</p>
        <strong>Your complete roadmap is ready</strong>
        <span>See the details that make your next steps feel personal.</span>
      </div>
      <button className="primary-action" type="button" onClick={onUnlock}>
        Unlock your full summary
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d="m7.5 4.5 5 5-5 5" />
        </svg>
      </button>
    </aside>
  )
}

export function ResultProfile({
  result,
  answers,
}: {
  result: ResultAccessData
  answers: FunnelAnswers | null
}) {
  return (
    <section className="result-profile" aria-label="Your starting profile">
      <div className="result-profile-copy">
        <BmiScale bmi={result.bmi} category={result.bmiCategory} />
        {answers && <ProfileFacts answers={answers} />}
      </div>
      <div className="result-profile-photo">
        <Image
          src="/pilates-studio.png"
          alt="A calm, supported movement practice"
          fill
          sizes="(max-width: 760px) 100vw, 38vw"
        />
        <span>Made for your everyday</span>
      </div>
    </section>
  )
}

function BmiScale({ bmi, category }: { bmi: number; category: BmiCategory }) {
  const marker = Math.max(0, Math.min(100, ((bmi - 15) / 25) * 100))
  return (
    <section className="bmi-scale" aria-labelledby="bmi-scale-title">
      <p className="eyebrow">A useful starting point</p>
      <div className="bmi-scale-heading">
        <div>
          <h2 id="bmi-scale-title">Body Mass Index</h2>
          <p>{BMI_LABELS[category]}</p>
        </div>
        <strong>{bmi.toFixed(1)}</strong>
      </div>
      <div className="bmi-scale-visual">
        <div className="bmi-scale-track" aria-hidden="true">
          <span className="bmi-scale-marker" style={{ left: `${marker}%` }} />
        </div>
        <div className="bmi-scale-ticks" aria-hidden="true">
          <span>15</span>
          <span>18.5</span>
          <span>25</span>
          <span>30</span>
          <span>40</span>
        </div>
        <div className="bmi-scale-labels">
          <span>Below</span>
          <span>Reference range</span>
          <span>Above</span>
        </div>
      </div>
      <p className="bmi-scale-note">
        BMI is one context point, not a complete picture of your health or how you feel.
      </p>
    </section>
  )
}

function ProfileFacts({ answers }: { answers: FunnelAnswers }) {
  const facts = [
    answers.experience && ['Starting point', answerLabel('experience', answers.experience)],
    answers.activityLevel && [
      'Movement rhythm',
      answerLabel('activityLevel', answers.activityLevel),
    ],
    answers.minutes &&
      answers.days && [
        'Weekly intention',
        `${answerLabel('minutes', answers.minutes)} · ${answerLabel('days', answers.days)}`,
      ],
    answers.focus && ['Focus', answerLabel('focus', answers.focus)],
    answers.equipment && ['At home', answerLabel('equipment', answers.equipment)],
  ].filter((fact): fact is [string, string] => Boolean(fact?.[0] && fact[1]))

  if (facts.length === 0) return null
  return (
    <div className="profile-facts" aria-label="Movement preferences">
      <p className="eyebrow">Your everyday rhythm</p>
      <dl>
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function PreviewResult({
  result,
  onUnlock,
}: {
  result: PreviewResultData
  onUnlock: () => void
}) {
  const lockedFeatures =
    result.calorieRange === null
      ? ['Your energy at rest', 'Your daily energy overview']
      : result.warnings.length > 0
        ? ['Your daily energy target', 'Your daily energy overview']
        : ['Your daily energy target', 'Your estimated timeline', 'Your progress outlook']

  return (
    <>
      <section className="preview-summary" aria-label="Free result preview">
        <div className="section-heading">
          <p className="eyebrow">YOUR FREE PREVIEW</p>
          <h2>A clear place to begin.</h2>
          <p>Small, repeatable changes can fit more naturally into everyday life.</p>
        </div>
        <div className="preview-stat-list">
          <div>
            <span>Daily energy guide</span>
            <strong>
              {result.calorieRange === null
                ? 'Personal guidance'
                : `${result.calorieRange.min.toLocaleString()}–${result.calorieRange.max.toLocaleString()} kcal`}
            </strong>
            <small>A supportive range, not a prescription.</small>
          </div>
          <div>
            <span>A sustainable pace</span>
            <strong>Gradual beats dramatic.</strong>
            <small>Give your routine room to become yours.</small>
          </div>
        </div>
      </section>

      <Warnings warnings={result.warnings} />

      <section className="locked-detail-preview" aria-labelledby="locked-preview-title">
        <div className="locked-detail-preview-copy">
          <p className="eyebrow">YOUR FULL SUMMARY</p>
          <h2 id="locked-preview-title">See the details that make the plan yours.</h2>
          <p>
            Unlock a clearer daily rhythm, a gentle direction, and the progress outlook behind it.
          </p>
        </div>
        <div className="locked-detail-preview-visual">
          <div className="locked-detail-lines" aria-hidden="true">
            <div>
              <span>Daily energy target</span>
              <strong>•••••• kcal</strong>
            </div>
            <div>
              <span>Estimated timeline</span>
              <strong>•••• ••••</strong>
            </div>
            <div>
              <span>Progress outlook</span>
              <strong>••••••••</strong>
            </div>
          </div>
          <div className="locked-detail-overlay">
            <span className="paywall-lock" aria-hidden="true">
              <svg viewBox="0 0 28 28" focusable="false">
                <path d="M9.5 12V8.75a4.5 4.5 0 0 1 9 0V12M7 12h14v11H7z" />
              </svg>
            </span>
            <strong>Your timeline is ready to unlock</strong>
            <small>Your preview stays available.</small>
          </div>
        </div>
      </section>

      <section className="paywall-callout" aria-labelledby="locked-title">
        <div className="paywall-callout-copy">
          <p className="eyebrow">YOUR PERSONAL PLAN</p>
          <h2 id="locked-title">Unlock the complete picture.</h2>
          <p>
            See the rest of your personal profile. Nothing is charged and your preview stays
            available if you choose not to continue.
          </p>
          <ul>
            <li className="paywall-list-heading">What’s included</li>
            {lockedFeatures.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
          <button className="primary-action" type="button" onClick={onUnlock}>
            See your full summary
            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path d="m7.5 4.5 5 5-5 5" />
            </svg>
          </button>
          <small>No card · No charge · No renewal</small>
        </div>
        <div className="paywall-callout-side" aria-hidden="true">
          <span className="paywall-lock">
            <svg viewBox="0 0 28 28" focusable="false">
              <path d="M9.5 12V8.75a4.5 4.5 0 0 1 9 0V12M7 12h14v11H7z" />
            </svg>
          </span>
          <strong>Your full summary</strong>
          <span>Ready when you are</span>
        </div>
      </section>
    </>
  )
}

export function FullResult({ result }: { result: FullResultData }) {
  return (
    <>
      <section className="energy-summary" aria-labelledby="energy-summary-title">
        <div className="section-heading">
          <p className="eyebrow">YOUR DAILY RHYTHM</p>
          <h2 id="energy-summary-title">Numbers to help you plan.</h2>
          <p>These are gentle estimates to help you choose a direction, not rules to follow.</p>
        </div>
        <div className="energy-rows">
          <MetricRow label="Energy at rest" value={result.bmrKcal.toLocaleString()} />
          <MetricRow label="Daily energy estimate" value={result.tdeeKcal.toLocaleString()} />
          <MetricRow
            label="Your daily energy target"
            value={result.exactDailyCalories?.toLocaleString() ?? 'Unavailable'}
            featured
          />
        </div>
      </section>

      {result.calorieEstimateAvailable ? (
        <section className="timeline-editorial" aria-labelledby="timeline-title">
          <div className="timeline-copy">
            <p className="eyebrow">A GENTLE DIRECTION</p>
            <h2 id="timeline-title">
              {result.targetDate === null
                ? result.warnings.includes('MAINTENANCE_GOAL_NO_ARRIVAL_DATE')
                  ? 'A steady range, not an arrival date.'
                  : 'This goal deserves a longer horizon.'
                : `An estimated target date of ${formatDate(result.targetDate)}.`}
            </h2>
            <p>
              This is an estimate to help you choose a direction. Your pace may change, and that is
              okay.
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

function MetricRow({
  label,
  value,
  featured = false,
}: {
  label: string
  value: string
  featured?: boolean
}) {
  return (
    <div className={featured ? 'energy-row energy-row--featured' : 'energy-row'}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>kcal / day</small>
    </div>
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
  const coordinates = points.map((point, index) => {
    const x = left + (index / Math.max(points.length - 1, 1)) * (right - left)
    const y = bottom - ((point.weightKg - minimum) / range) * (bottom - top)
    return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) }
  })
  const linePath = coordinates
    .map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`)
    .join(' ')
  const firstCoordinate = coordinates[0]
  const lastCoordinate = coordinates.at(-1)
  const areaPath =
    firstCoordinate && lastCoordinate
      ? `${linePath} L ${lastCoordinate.x} ${bottom} L ${firstCoordinate.x} ${bottom} Z`
      : ''
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
        <defs>
          <linearGradient id="projection-line-gradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ef4c20" />
            <stop offset="48%" stopColor="#f6c331" />
            <stop offset="100%" stopColor="#27c9a4" />
          </linearGradient>
          <linearGradient id="projection-fill-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f1a35a" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#f1a35a" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="chart-grid" d="M22 18H698M22 103H698M22 188H698" />
        {areaPath && <path className="chart-area" d={areaPath} />}
        <path className="chart-line" d={linePath} pathLength="1000" />
        {first !== undefined && firstCoordinate && (
          <circle className="chart-dot" cx={firstCoordinate.x} cy={firstCoordinate.y} r="5" />
        )}
        {last !== undefined && lastCoordinate && (
          <circle className="chart-dot" cx={lastCoordinate.x} cy={lastCoordinate.y} r="5" />
        )}
        {last !== undefined && lastCoordinate && (
          <g
            className="chart-goal-tag"
            transform={`translate(${Math.max(left, lastCoordinate.x - 138)} ${Math.max(top, lastCoordinate.y - 48)})`}
          >
            <rect width="128" height="32" rx="16" />
            <text x="64" y="21" textAnchor="middle">
              Goal · {last.weightKg} kg
            </text>
          </g>
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

export function SessionReceipt({ assessmentId }: { assessmentId: string }) {
  const [copied, setCopied] = useState(false)

  async function copyReference() {
    try {
      await navigator.clipboard.writeText(assessmentId)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className="session-receipt" aria-label="Saved private session">
      <div>
        <p className="eyebrow">YOUR PRIVATE SESSION</p>
        <h2>Your full summary is saved.</h2>
        <p>
          Return to this result on the same browser while your private session is active. Your
          assessment reference is safe to keep, but it is not a login credential.
        </p>
      </div>
      <div className="session-reference">
        <span>Assessment reference</span>
        <code>{assessmentId.slice(0, 8).toUpperCase()} ·••••</code>
        <button className="secondary-action" type="button" onClick={() => void copyReference()}>
          {copied ? 'Copied reference' : 'Copy reference'}
        </button>
      </div>
    </section>
  )
}

export function EducationalFooter() {
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

export function RoutineSummary({ answers }: { answers: FunnelAnswers }) {
  const guidance = [
    answers.experience === 'new'
      ? 'Begin with a gentle introduction to breathing, posture, and controlled movement.'
      : answers.experience === 'some'
        ? 'Revisit familiar basics before adding more challenging movements.'
        : 'Keep a mix of familiar practice and recovery in your weekly routine.',
    `Set aside ${answers.minutes} minutes on ${answers.days} days each week. ${
      answers.equipment === 'none'
        ? 'Choose a comfortable, non-slip space; a supportive mat can help with floor work.'
        : answers.equipment === 'bands'
          ? 'Start with your mat; add light resistance only when movement feels comfortable.'
          : 'Keep your mat somewhere easy to reach as a reminder to begin.'
    }`,
    answers.sitting === 'mostly'
      ? 'Break up long periods of sitting with short, comfortable movement breaks.'
      : answers.sitting === 'some'
        ? 'Use a short movement break to add variety to your day.'
        : 'Balance your active day with a gentle cooldown and rest.',
    answers.focus?.includes('whole_body')
      ? 'Explore a balanced mix of whole-body movements.'
      : `Build your practice around ${answerLabel('focus', answers.focus).toLowerCase()}, alongside balanced movement.`,
  ]

  if (answers.barriers?.includes('time')) {
    guidance.push(
      'Pair your practice with a daily cue, such as finishing work, to make time easier to find.',
    )
  }
  if (answers.barriers?.includes('consistency')) {
    guidance.push(
      'Put your chosen days in your calendar. Missing one day does not mean starting over.',
    )
  }
  if (answers.barriers?.includes('confidence')) {
    guidance.push('Look for beginner instruction and take time to learn each movement comfortably.')
  }

  return (
    <section className="routine-editorial">
      <div className="section-heading">
        <p className="eyebrow">YOUR EVERYDAY MOVEMENT</p>
        <h2>A little space for what matters to you.</h2>
        <p>Your focus: {answerLabel('motivation', answers.motivation)}.</p>
      </div>
      <div className="routine-facts">
        {(['experience', 'minutes', 'days', 'equipment'] as const).map(
          (key) =>
            answers[key] && (
              <div key={key}>
                <span>{key === 'minutes' ? 'Time' : key === 'days' ? 'Rhythm' : key}</span>
                <strong>{answerLabel(key, answers[key])}</strong>
              </div>
            ),
        )}
      </div>
      <ul className="routine-guidance">
        {guidance.map((item) => (
          <li key={item}>{item}</li>
        ))}
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
