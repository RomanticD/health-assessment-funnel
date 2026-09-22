'use client'

import Link from 'next/link'
import type { Route } from 'next'
import { useRouter } from 'next/navigation'
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react'

import {
  getAssessment,
  getCurrentAssessment,
  isHealthApiError,
  quizDestination,
  recoverOrCreateAssessment,
  saveAssessmentStep,
  submitAssessment,
} from '@/client/health-api'
import { SiteHeader } from '@/components/site-header'
import { QuizProgress } from '@/components/quiz/quiz-progress'
import {
  ASSESSMENT_STEP_KEYS,
  type ActivityLevel,
  type AssessmentProgress,
  type AssessmentStepKey,
  type BodyStepData,
  type PrimaryGoal,
  type SexForCalorieEstimation,
  type StepUpdateCommand,
} from '@/shared/contracts'
import { bodyStepDataSchema, HEALTH_INPUT_BOUNDS } from '@/shared/contracts/health'

const STEP_COPY: Record<
  AssessmentStepKey,
  { eyebrow: string; title: string; description: string }
> = {
  sex: {
    eyebrow: 'Your profile',
    title: 'Which formula should we use for your estimate?',
    description:
      'The current Mifflin equation uses a female or male constant. This choice is only for that calculation and does not define your gender identity.',
  },
  goal: {
    eyebrow: 'Your direction',
    title: 'What would feel like meaningful progress?',
    description:
      'Choose the direction that best matches your intention. We will check whether the final target is internally consistent and within the demo’s safety limits.',
  },
  body: {
    eyebrow: 'Your starting point',
    title: 'A few measurements make the estimate personal.',
    description:
      'We use these values only to calculate this educational snapshot. Enter metric values; nothing is stored in browser storage.',
  },
  activity: {
    eyebrow: 'Your weekly rhythm',
    title: 'How active is a typical week for you?',
    description:
      'Choose the closest sustainable average, not your busiest week. This adjusts the daily energy estimate.',
  },
}

const SEX_OPTIONS: ReadonlyArray<{
  value: SexForCalorieEstimation
  label: string
  description: string
}> = [
  {
    value: 'female',
    label: 'Use the female equation',
    description: 'Applies the female constant in the Mifflin–St Jeor estimate.',
  },
  {
    value: 'male',
    label: 'Use the male equation',
    description: 'Applies the male constant in the Mifflin–St Jeor estimate.',
  },
]

const GOAL_OPTIONS: ReadonlyArray<{
  value: PrimaryGoal
  label: string
  description: string
}> = [
  {
    value: 'lose_weight',
    label: 'Lose weight gradually',
    description: 'Explore a conservative calorie deficit and estimated timeline.',
  },
  {
    value: 'maintain_weight',
    label: 'Maintain my weight',
    description: 'Estimate the daily energy needed to support your current direction.',
  },
  {
    value: 'gain_weight',
    label: 'Gain weight gradually',
    description: 'Explore a measured calorie surplus and estimated timeline.',
  },
]

const ACTIVITY_OPTIONS: ReadonlyArray<{
  value: ActivityLevel
  label: string
  description: string
}> = [
  {
    value: 'sedentary',
    label: 'Mostly seated',
    description: 'Little structured exercise in a typical week.',
  },
  {
    value: 'light',
    label: 'Lightly active',
    description: 'Light exercise or purposeful movement 1–3 days per week.',
  },
  {
    value: 'moderate',
    label: 'Moderately active',
    description: 'Moderate exercise 3–5 days per week.',
  },
  {
    value: 'active',
    label: 'Very active',
    description: 'Hard exercise or a physical routine 6–7 days per week.',
  },
  {
    value: 'very_active',
    label: 'Extra active',
    description: 'Very hard training, a physical job, or both.',
  },
]

const SEX_LABELS: Record<SexForCalorieEstimation, string> = {
  female: 'Female equation',
  male: 'Male equation',
}

const GOAL_LABELS: Record<PrimaryGoal, string> = {
  lose_weight: 'Lose weight gradually',
  maintain_weight: 'Maintain weight',
  gain_weight: 'Gain weight gradually',
}

const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: 'Mostly seated',
  light: 'Lightly active',
  moderate: 'Moderately active',
  active: 'Very active',
  very_active: 'Extra active',
}

type RetryOperation =
  | { kind: 'save'; command: StepUpdateCommand; idempotencyKey: string }
  | { kind: 'submit'; idempotencyKey: string }

type QuizFlowProps = {
  stepKey: AssessmentStepKey | 'review'
}

function backDestination(stepKey: AssessmentStepKey | 'review'): Route {
  const index =
    stepKey === 'review' ? ASSESSMENT_STEP_KEYS.length : ASSESSMENT_STEP_KEYS.indexOf(stepKey)
  if (index <= 0) return '/'

  const previousStep = ASSESSMENT_STEP_KEYS[index - 1]
  // `index` is derived from the fixed assessment-step tuple, so a nonzero
  // index always has a valid prior route segment.
  return `/quiz/${previousStep}` as Route
}

function errorMessage(error: unknown): string {
  if (!isHealthApiError(error)) {
    return error instanceof Error ? error.message : 'Something interrupted this request.'
  }

  if (error.code === 'SESSION_EXPIRED' || error.code === 'SESSION_REQUIRED') {
    return 'This private session is no longer available. Return home to start again.'
  }
  if (error.code === 'UNREASONABLE_TARGET') {
    return 'That target and goal direction do not form a safe estimate. Review your goal and body values, then try again.'
  }
  if (error.code === 'ASSESSMENT_INCOMPLETE') {
    return 'One or more sections are incomplete. Reload the latest saved progress before submitting.'
  }
  return error.message
}

function fieldErrorsFrom(error: unknown): Record<string, string> {
  if (!isHealthApiError(error) || error.fieldErrors === undefined) return {}
  return Object.fromEntries(
    error.fieldErrors.map((fieldError) => {
      const segments = fieldError.path.split('.')
      return [segments.at(-1) ?? fieldError.path, fieldError.message]
    }),
  )
}

export function QuizFlow({ stepKey }: QuizFlowProps) {
  const router = useRouter()
  const [progress, setProgress] = useState<AssessmentProgress | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [operation, setOperation] = useState<'idle' | 'saving' | 'submitting'>('idle')
  const [notice, setNotice] = useState<string | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [retryOperation, setRetryOperation] = useState<RetryOperation | null>(null)
  const [reloadSequence, setReloadSequence] = useState(0)
  const errorSummaryRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let active = true

    async function loadProgress() {
      setProgress(null)
      setLoadError(null)
      setNotice(null)
      setRequestError(null)

      try {
        const recovered = await recoverOrCreateAssessment()
        if (!active) return

        if (recovered.status === 'completed') {
          router.replace(`/results/${recovered.assessmentId}`)
          return
        }

        const requestedIndex =
          stepKey === 'review' ? ASSESSMENT_STEP_KEYS.length : ASSESSMENT_STEP_KEYS.indexOf(stepKey)
        const nextIndex =
          recovered.nextStep === 'review'
            ? ASSESSMENT_STEP_KEYS.length
            : ASSESSMENT_STEP_KEYS.indexOf(recovered.nextStep)

        if (requestedIndex > nextIndex) {
          router.replace(`/quiz/${recovered.nextStep}`)
          return
        }

        setProgress(recovered)
      } catch (error) {
        if (active) setLoadError(errorMessage(error))
      }
    }

    // Defer network-driven state changes until after the initial client paint.
    // This avoids a synchronous effect cascade while retaining cancellation when
    // the visitor changes a deep-linked step before the request begins.
    const taskId = window.setTimeout(() => {
      void loadProgress()
    }, 0)
    return () => {
      active = false
      window.clearTimeout(taskId)
    }
  }, [reloadSequence, router, stepKey])

  function focusErrorSummary() {
    window.requestAnimationFrame(() => errorSummaryRef.current?.focus())
  }

  async function refreshAfterConflict(assessmentId: string) {
    try {
      // `/current` deliberately excludes completed assessments. Read the
      // concrete resource instead so a concurrent submit in another tab
      // takes this visitor directly to its result rather than a dead-end.
      const latest = await getAssessment(assessmentId)
      setProgress(latest.data)

      if (latest.data.status === 'completed') {
        router.replace(`/results/${latest.data.assessmentId}`)
        return
      }

      setNotice(
        'Another tab saved a newer version. We loaded that confirmed server copy and did not overwrite it.',
      )
      setRequestError(null)
      setRetryOperation(null)
    } catch (error) {
      setRequestError(errorMessage(error))
      focusErrorSummary()
    }
  }

  async function runSave(command: StepUpdateCommand, idempotencyKey: string) {
    if (progress === null || operation !== 'idle') return
    setOperation('saving')
    setNotice(null)
    setRequestError(null)
    setFieldErrors({})
    setRetryOperation(null)

    try {
      await saveAssessmentStep(progress.assessmentId, progress.revision, command, idempotencyKey)
      const latest = await getCurrentAssessment()
      setProgress(latest.data)
      setNotice('Saved securely. Your server-side progress is up to date.')
      window.setTimeout(() => router.push(quizDestination(latest.data)), 220)
    } catch (error) {
      if (isHealthApiError(error) && error.code === 'REVISION_MISMATCH') {
        await refreshAfterConflict(progress.assessmentId)
      } else {
        setFieldErrors(fieldErrorsFrom(error))
        setRequestError(errorMessage(error))
        setRetryOperation({ kind: 'save', command, idempotencyKey })
        focusErrorSummary()
      }
    } finally {
      setOperation('idle')
    }
  }

  async function runSubmit(idempotencyKey: string) {
    if (progress === null || operation !== 'idle') return
    setOperation('submitting')
    setNotice(null)
    setRequestError(null)
    setRetryOperation(null)

    try {
      const submitted = await submitAssessment(
        progress.assessmentId,
        progress.revision,
        idempotencyKey,
      )
      router.push(`/results/${submitted.data.assessmentId}`)
    } catch (error) {
      if (isHealthApiError(error) && error.code === 'REVISION_MISMATCH') {
        await refreshAfterConflict(progress.assessmentId)
      } else {
        setRequestError(errorMessage(error))
        setFieldErrors(fieldErrorsFrom(error))
        setRetryOperation({ kind: 'submit', idempotencyKey })
        focusErrorSummary()
      }
    } finally {
      setOperation('idle')
    }
  }

  function retryLastRequest() {
    if (retryOperation?.kind === 'save') {
      void runSave(retryOperation.command, retryOperation.idempotencyKey)
    } else if (retryOperation?.kind === 'submit') {
      void runSubmit(retryOperation.idempotencyKey)
    }
  }

  if (progress === null) {
    return (
      <main className="quiz-page">
        <SiteHeader compact />
        <section className="center-state" aria-live="polite">
          {loadError === null ? (
            <>
              <span className="loading-ring" aria-hidden="true" />
              <p className="eyebrow">Checking your last confirmed save</p>
              <h1>Restoring your assessment…</h1>
              <p>Health answers remain on the server and are never copied into browser storage.</p>
            </>
          ) : (
            <>
              <p className="eyebrow">We could not restore this step</p>
              <h1>Your saved progress has not been changed.</h1>
              <p>{loadError}</p>
              <div className="button-row button-row--centered">
                <button
                  className="primary-action"
                  type="button"
                  onClick={() => setReloadSequence((sequence) => sequence + 1)}
                >
                  Try again
                </button>
                <Link className="secondary-action" href="/">
                  Return home
                </Link>
              </div>
            </>
          )}
        </section>
      </main>
    )
  }

  const backHref = backDestination(stepKey)

  return (
    <main className="quiz-page">
      <SiteHeader compact />
      <div className="quiz-frame">
        <nav className="quiz-nav" aria-label="Assessment navigation">
          <Link className="back-link" href={backHref}>
            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path d="m12.5 4.5-5 5 5 5" />
            </svg>
            Back
          </Link>
          <span className="save-state" aria-live="polite">
            {operation === 'saving'
              ? 'Saving securely…'
              : operation === 'submitting'
                ? 'Calculating on the server…'
                : (notice ?? 'Server-saved progress')}
          </span>
        </nav>

        <QuizProgress current={stepKey} />

        {requestError !== null && (
          <div className="error-summary" ref={errorSummaryRef} role="alert" tabIndex={-1}>
            <div>
              <strong>This request was not applied.</strong>
              <p>{requestError}</p>
            </div>
            {retryOperation !== null && (
              <button
                className="text-action"
                type="button"
                onClick={retryLastRequest}
                disabled={operation !== 'idle'}
              >
                Retry the same safe request
              </button>
            )}
          </div>
        )}

        {notice !== null && requestError === null && (
          <p className="inline-alert inline-alert--success" role="status">
            {notice}
          </p>
        )}

        {stepKey === 'review' ? (
          <ReviewStep
            progress={progress}
            isSubmitting={operation === 'submitting'}
            onSubmit={() => void runSubmit(crypto.randomUUID())}
          />
        ) : (
          <QuestionStep
            stepKey={stepKey}
            progress={progress}
            isSaving={operation === 'saving'}
            fieldErrors={fieldErrors}
            onSave={(command) => void runSave(command, crypto.randomUUID())}
          />
        )}
      </div>
      <QuizFooter />
    </main>
  )
}

function QuestionStep({
  stepKey,
  progress,
  isSaving,
  fieldErrors,
  onSave,
}: {
  stepKey: AssessmentStepKey
  progress: AssessmentProgress
  isSaving: boolean
  fieldErrors: Record<string, string>
  onSave: (command: StepUpdateCommand) => void
}) {
  const copy = STEP_COPY[stepKey]

  return (
    <section className="question-card" aria-labelledby="question-title">
      <div className="question-heading">
        <p className="eyebrow">{copy.eyebrow}</p>
        <h1 id="question-title">{copy.title}</h1>
        <p>{copy.description}</p>
      </div>

      {stepKey === 'sex' && (
        <OptionList
          legend="Select the sex-based equation to use"
          options={SEX_OPTIONS}
          selected={progress.answers.sex?.sexForCalorieEstimation}
          disabled={isSaving}
          onSelect={(sexForCalorieEstimation) =>
            onSave({ stepKey: 'sex', data: { sexForCalorieEstimation } })
          }
        />
      )}

      {stepKey === 'goal' && (
        <OptionList
          legend="Select your primary goal"
          options={GOAL_OPTIONS}
          selected={progress.answers.goal?.primaryGoal}
          disabled={isSaving}
          onSelect={(primaryGoal) => onSave({ stepKey: 'goal', data: { primaryGoal } })}
        />
      )}

      {stepKey === 'body' && (
        <BodyForm
          key={`${progress.assessmentId}:${progress.revision}`}
          initialValue={progress.answers.body}
          disabled={isSaving}
          serverErrors={fieldErrors}
          onSave={(data) => onSave({ stepKey: 'body', data })}
        />
      )}

      {stepKey === 'activity' && (
        <OptionList
          legend="Select your typical activity level"
          options={ACTIVITY_OPTIONS}
          selected={progress.answers.activity?.activityLevel}
          disabled={isSaving}
          onSelect={(activityLevel) => onSave({ stepKey: 'activity', data: { activityLevel } })}
        />
      )}
    </section>
  )
}

function OptionList<T extends string>({
  legend,
  options,
  selected,
  disabled,
  onSelect,
}: {
  legend: string
  options: ReadonlyArray<{ value: T; label: string; description: string }>
  selected: T | undefined
  disabled: boolean
  onSelect: (value: T) => void
}) {
  return (
    <fieldset className="option-fieldset">
      <legend className="sr-only">{legend}</legend>
      <div className="option-grid">
        {options.map((option) => {
          const isSelected = selected === option.value
          return (
            <button
              className={isSelected ? 'option-card is-selected' : 'option-card'}
              type="button"
              key={option.value}
              aria-pressed={isSelected}
              disabled={disabled}
              onClick={() => onSelect(option.value)}
            >
              <span className="option-check" aria-hidden="true">
                {isSelected && (
                  <svg viewBox="0 0 20 20" focusable="false">
                    <path d="m5 10 3.1 3.1L15 6.8" />
                  </svg>
                )}
              </span>
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
              <svg
                className="option-arrow"
                viewBox="0 0 20 20"
                aria-hidden="true"
                focusable="false"
              >
                <path d="m7.5 4.5 5 5-5 5" />
              </svg>
            </button>
          )
        })}
      </div>
      <p className="field-helper">
        Selecting an option saves the complete step, then moves forward.
      </p>
    </fieldset>
  )
}

type BodyDraft = Record<keyof BodyStepData, string>

function initialBodyDraft(value: BodyStepData | undefined): BodyDraft {
  return {
    ageYears: value?.ageYears.toString() ?? '',
    heightCm: value?.heightCm.toString() ?? '',
    weightKg: value?.weightKg.toString() ?? '',
    targetWeightKg: value?.targetWeightKg.toString() ?? '',
  }
}

function BodyForm({
  initialValue,
  disabled,
  serverErrors,
  onSave,
}: {
  initialValue: BodyStepData | undefined
  disabled: boolean
  serverErrors: Record<string, string>
  onSave: (data: BodyStepData) => void
}) {
  const [draft, setDraft] = useState<BodyDraft>(() => initialBodyDraft(initialValue))
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({})
  const errors = { ...serverErrors, ...clientErrors }

  function setField(name: keyof BodyDraft, value: string) {
    setDraft((current) => ({ ...current, [name]: value }))
    setClientErrors((current) => {
      const next = { ...current }
      delete next[name]
      return next
    })
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = bodyStepDataSchema.safeParse({
      ageYears: Number(draft.ageYears),
      heightCm: Number(draft.heightCm),
      weightKg: Number(draft.weightKg),
      targetWeightKg: Number(draft.targetWeightKg),
    })

    if (!parsed.success) {
      const nextErrors: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const field = issue.path[0]
        if (typeof field === 'string' && nextErrors[field] === undefined) {
          nextErrors[field] = issue.message
        }
      }
      setClientErrors(nextErrors)
      return
    }

    setClientErrors({})
    onSave(parsed.data)
  }

  return (
    <form className="measurement-form" onSubmit={handleSubmit} noValidate>
      <div className="measurement-grid">
        <MeasurementField
          name="ageYears"
          label="Age"
          unit="years"
          value={draft.ageYears}
          min={HEALTH_INPUT_BOUNDS.ageYears.min}
          max={HEALTH_INPUT_BOUNDS.ageYears.max}
          step="1"
          error={errors.ageYears}
          disabled={disabled}
          onChange={(value) => setField('ageYears', value)}
        />
        <MeasurementField
          name="heightCm"
          label="Height"
          unit="cm"
          value={draft.heightCm}
          min={HEALTH_INPUT_BOUNDS.heightCm.min}
          max={HEALTH_INPUT_BOUNDS.heightCm.max}
          step="0.1"
          error={errors.heightCm}
          disabled={disabled}
          onChange={(value) => setField('heightCm', value)}
        />
        <MeasurementField
          name="weightKg"
          label="Current weight"
          unit="kg"
          value={draft.weightKg}
          min={HEALTH_INPUT_BOUNDS.weightKg.min}
          max={HEALTH_INPUT_BOUNDS.weightKg.max}
          step="0.1"
          error={errors.weightKg}
          disabled={disabled}
          onChange={(value) => setField('weightKg', value)}
        />
        <MeasurementField
          name="targetWeightKg"
          label="Target weight"
          unit="kg"
          value={draft.targetWeightKg}
          min={HEALTH_INPUT_BOUNDS.targetWeightKg.min}
          max={HEALTH_INPUT_BOUNDS.targetWeightKg.max}
          step="0.1"
          error={errors.targetWeightKg}
          disabled={disabled}
          onChange={(value) => setField('targetWeightKg', value)}
        />
      </div>
      <div className="form-actions">
        <p className="field-helper">
          Metric values are sent only when you choose Save and continue. Up to two decimal places
          are supported.
        </p>
        <button className="primary-action" type="submit" disabled={disabled}>
          {disabled ? 'Saving securely…' : 'Save and continue'}
          {!disabled && (
            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path d="m7.5 4.5 5 5-5 5" />
            </svg>
          )}
        </button>
      </div>
    </form>
  )
}

function MeasurementField({
  name,
  label,
  unit,
  value,
  min,
  max,
  step,
  error,
  disabled,
  onChange,
}: {
  name: keyof BodyDraft
  label: string
  unit: string
  value: string
  min: number
  max: number
  step: string
  error: string | undefined
  disabled: boolean
  onChange: (value: string) => void
}) {
  const helperId = `${name}-helper`
  const errorId = `${name}-error`

  return (
    <div className="field-group">
      <label htmlFor={name}>{label}</label>
      <div className={error === undefined ? 'unit-input' : 'unit-input has-error'}>
        <input
          id={name}
          name={name}
          type="number"
          inputMode={name === 'ageYears' ? 'numeric' : 'decimal'}
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-invalid={error !== undefined}
          aria-describedby={error === undefined ? helperId : `${helperId} ${errorId}`}
          onChange={(event) => onChange(event.target.value)}
        />
        <span>{unit}</span>
      </div>
      <small id={helperId} className="field-helper">
        Allowed range: {min}–{max} {unit}
      </small>
      {error !== undefined && (
        <small id={errorId} className="field-error">
          {error}
        </small>
      )}
    </div>
  )
}

function ReviewStep({
  progress,
  isSubmitting,
  onSubmit,
}: {
  progress: AssessmentProgress
  isSubmitting: boolean
  onSubmit: () => void
}) {
  const { sex, goal, body, activity } = progress.answers

  return (
    <section className="question-card review-card" aria-labelledby="review-title">
      <div className="question-heading">
        <p className="eyebrow">One last look</p>
        <h1 id="review-title">Review your confirmed answers.</h1>
        <p>
          The server will validate the complete set before calculating anything. Edit a section if
          it no longer looks right.
        </p>
      </div>

      <dl className="review-list">
        <ReviewRow
          term="Formula"
          value={sex === undefined ? 'Not saved' : SEX_LABELS[sex.sexForCalorieEstimation]}
          href={'/quiz/sex' as Route}
        />
        <ReviewRow
          term="Goal"
          value={goal === undefined ? 'Not saved' : GOAL_LABELS[goal.primaryGoal]}
          href={'/quiz/goal' as Route}
        />
        <ReviewRow
          term="Measurements"
          value={
            body === undefined
              ? 'Not saved'
              : `${body.ageYears} years · ${body.heightCm} cm · ${body.weightKg} kg → ${body.targetWeightKg} kg`
          }
          href={'/quiz/body' as Route}
        />
        <ReviewRow
          term="Activity"
          value={activity === undefined ? 'Not saved' : ACTIVITY_LABELS[activity.activityLevel]}
          href={'/quiz/activity' as Route}
        />
      </dl>

      <div className="review-consent">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M8.5 10V7.75a3.5 3.5 0 0 1 7 0V10M6.75 10h10.5v9H6.75z" />
        </svg>
        <p>
          <strong>Your inputs stay tied to this private session.</strong>
          Results are educational estimates, not a diagnosis or treatment plan.
        </p>
      </div>

      <button
        className="primary-action primary-action--full"
        type="button"
        onClick={onSubmit}
        disabled={isSubmitting}
      >
        {isSubmitting ? 'Validating and calculating…' : 'Calculate my snapshot'}
        {!isSubmitting && (
          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path d="m7.5 4.5 5 5-5 5" />
          </svg>
        )}
      </button>
    </section>
  )
}

function ReviewRow({ term, value, href }: { term: string; value: string; href: Route }) {
  return (
    <div>
      <dt>{term}</dt>
      <dd>{value}</dd>
      <Link href={href} aria-label={`Edit ${term.toLowerCase()}`}>
        Edit
      </Link>
    </div>
  )
}

function QuizFooter() {
  return (
    <footer className="quiz-footer">
      <p>
        This demo uses BMI and calorie equations with important limitations. It is not suitable for
        pregnancy, people under 18, or medical decision-making.
      </p>
    </footer>
  )
}

export function InvalidStepMessage({ children }: { children: ReactNode }) {
  return <>{children}</>
}
