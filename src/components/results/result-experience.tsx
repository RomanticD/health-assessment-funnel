'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

import { activateDemoAccess, getAssessmentResult, isHealthApiError } from '@/client/health-api'
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
    'This input set falls outside the demo’s calorie safety envelope. A qualified professional can provide a more appropriate individual estimate.',
  PREDICTION_HORIZON_EXCEEDED:
    'The estimated timeline extends beyond the model’s 104-week horizon, so no arrival date or curve is shown.',
  MAINTENANCE_GOAL_NO_ARRIVAL_DATE:
    'Maintenance goals do not have an arrival date; the estimate focuses on sustaining a range.',
}

function resultErrorMessage(error: unknown): string {
  if (!isHealthApiError(error)) {
    return error instanceof Error ? error.message : 'The result could not be loaded.'
  }
  if (error.code === 'SESSION_REQUIRED' || error.code === 'SESSION_EXPIRED') {
    return 'This result belongs to a private session that is no longer available in this browser.'
  }
  if (error.code === 'ASSESSMENT_NOT_FOUND') {
    return 'This assessment was not found for the current private session.'
  }
  return error.message
}

export function ResultExperience({ assessmentId }: { assessmentId: string }) {
  const [result, setResult] = useState<ResultAccessData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isPaying, setIsPaying] = useState(false)
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const paymentKeyRef = useRef<string | null>(null)

  const loadResult = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    try {
      const response = await getAssessmentResult(assessmentId)
      setResult(response.data)
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
      setIsDialogOpen(false)
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
          <p className="eyebrow">Server-calculated snapshot</p>
          <h1>Loading your saved result…</h1>
          <p>Access is checked live; the browser does not decide which fields you can see.</p>
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
          <p>{loadError ?? 'The server did not return a result.'}</p>
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
              ? 'The full picture, with its limits.'
              : 'A useful first look—not a verdict.'}
          </h1>
          <p>
            Built from the answers you confirmed and calculated on the server with the versioned
            health-v1 model.
          </p>
          <span
            className={
              result.access === 'full' ? 'access-badge access-badge--full' : 'access-badge'
            }
          >
            {result.access === 'full' ? 'Full demo access active' : 'Free preview'}
          </span>
        </header>

        <section className="result-overview" aria-label="BMI overview">
          <div className="bmi-orbit" aria-hidden="true">
            <span>{result.bmi}</span>
            <small>BMI</small>
          </div>
          <div>
            <p className="metric-label">BMI reference category</p>
            <h2>{BMI_LABELS[result.bmiCategory]}</h2>
            <p>
              BMI is a broad screening ratio, not a diagnosis. It does not distinguish muscle, fat
              distribution, pregnancy, or individual clinical context.
            </p>
          </div>
        </section>

        {result.access === 'preview' ? (
          <PreviewResult result={result} onUnlock={() => setIsDialogOpen(true)} />
        ) : (
          <FullResult result={result} />
        )}

        <EducationalFooter />
      </div>

      <UpgradeDialog
        open={isDialogOpen}
        isPaying={isPaying}
        error={paymentError}
        onClose={() => setIsDialogOpen(false)}
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
          <p className="metric-label">Educational calorie range</p>
          {result.calorieRange === null ? (
            <strong>Individual guidance recommended</strong>
          ) : (
            <strong>
              {result.calorieRange.min.toLocaleString()}–{result.calorieRange.max.toLocaleString()}
              <small> kcal / day</small>
            </strong>
          )}
          <p>
            {result.summary} This range is intentionally broader than the protected exact estimate.
          </p>
        </article>
        <article className="metric-card">
          <p className="metric-label">What this preview tells you</p>
          <h2>Gradual beats dramatic.</h2>
          <p>
            The model caps weekly change and refuses to invent an exact prediction outside its
            safety envelope.
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
          <p className="eyebrow">Protected detail</p>
          <h2 id="locked-title">Understand how the estimate was built.</h2>
          <p>
            The API has not sent the exact calories, BMR, TDEE, target date, or projection to this
            page. Demo access changes the server entitlement, then fetches a different response.
          </p>
          <button className="primary-action" type="button" onClick={onUnlock}>
            Unlock full demo result
            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path d="m7.5 4.5 5 5-5 5" />
            </svg>
          </button>
          <small>No real payment, card, or renewal.</small>
        </div>
        <div className="locked-stack" aria-label="Locked result sections">
          {['Energy calculation', 'Target-date estimate', 'Weekly projection'].map((label) => (
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
          label="Basal energy estimate"
          value={result.bmrKcal.toLocaleString()}
          unit="kcal / day"
        />
        <MetricCard
          label="Daily energy estimate"
          value={result.tdeeKcal.toLocaleString()}
          unit="kcal / day"
        />
        <MetricCard
          label="Goal-aligned estimate"
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
                ? 'Maintain a steady range.'
                : `An estimated target date of ${formatDate(result.targetDate)}.`}
            </h2>
            <p>
              This is a mathematical projection, not a promise. Real progress varies with adherence,
              adaptation, health, sleep, medication, and many other factors.
            </p>
            {result.calorieRange !== null && (
              <p className="range-note">
                Preview range: {result.calorieRange.min.toLocaleString()}–
                {result.calorieRange.max.toLocaleString()} kcal/day
              </p>
            )}
          </div>
          {result.weightProjection.length > 1 ? (
            <ProjectionChart points={result.weightProjection} />
          ) : (
            <div className="chart-empty">No arrival curve is needed for this goal.</div>
          )}
        </section>
      ) : (
        <section className="guidance-panel" aria-labelledby="guidance-title">
          <p className="eyebrow">Model boundary reached</p>
          <h2 id="guidance-title">An exact calorie or date estimate would be misleading here.</h2>
          <p>
            The server deliberately returned no exact calorie target, target date, or curve.
            Consider discussing the goal with a qualified clinician or dietitian.
          </p>
        </section>
      )}

      <Warnings warnings={result.warnings} />

      <section className="method-note">
        <div>
          <p className="metric-label">Calculation provenance</p>
          <h2>Versioned and reproducible</h2>
        </div>
        <dl>
          <div>
            <dt>Algorithm</dt>
            <dd>{result.algorithmVersion}</dd>
          </div>
          <div>
            <dt>Formula</dt>
            <dd>Mifflin–St Jeor + activity factor</dd>
          </div>
          <div>
            <dt>Rounding</dt>
            <dd>Decimal half-up</dd>
          </div>
        </dl>
      </section>
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
        <p className="eyebrow">Keep the context</p>
        <h2>Use this as a conversation starter.</h2>
        <p>
          This demo cannot account for medical history, body composition, pregnancy, eating-disorder
          risk, medication, disability, or personal nutritional needs.
        </p>
      </div>
      <Link className="secondary-action" href="/">
        Return to the start
      </Link>
    </footer>
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
