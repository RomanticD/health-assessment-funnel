'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import {
  getAssessment,
  getFunnel,
  isHealthApiError,
  recoverOrCreateAssessment,
  rememberAssessment,
  saveAssessmentStep,
  saveFunnel,
  submitAssessment,
  takeWarmAssessment,
} from '@/client/health-api'
import { SiteHeader } from '@/components/site-header'
import { type AssessmentProgress, type StepUpdateCommand } from '@/shared/contracts'
import {
  funnelAnswerSchemas,
  type FunnelAnswers,
  type FunnelSnapshot,
} from '@/shared/contracts/funnel'
import { QUESTIONS, answerLabel } from './questions'

const firstMissing = (answers: FunnelAnswers) => {
  const i = QUESTIONS.findIndex((q) => answers[q.key] === undefined)
  return i < 0 ? QUESTIONS.length : i
}

export function PersonalQuiz() {
  const router = useRouter()
  const [progress, setProgress] = useState<AssessmentProgress | null>(null)
  const [snapshot, setSnapshot] = useState<FunnelSnapshot | null>(null)
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const pending = useRef(false)
  const editing = useRef(false)
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const current = takeWarmAssessment() ?? (await recoverOrCreateAssessment())
        if (!live) return
        if (current.status === 'completed') {
          router.replace(`/results/${current.assessmentId}`)
          return
        }
        const saved = await getFunnel(current.assessmentId)
        if (!live) return
        setProgress(current)
        setSnapshot(saved.data)
        setIndex(firstMissing(saved.data.answers))
        setError(null)
      } catch {
        if (live) setError('We couldn’t load your answers. Please try again.')
      }
    })()
    return () => {
      live = false
    }
  }, [router, reload])

  useEffect(() => {
    if (snapshot) heading.current?.focus()
  }, [index, snapshot])

  async function save(value: unknown) {
    if (!progress || !snapshot || pending.current) return
    const question = QUESTIONS[index]
    if (!question) return
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      const response = await saveFunnel(progress.assessmentId, snapshot, question.key, value)
      setSnapshot(response.data)
      setIndex(editing.current ? QUESTIONS.length : index + 1)
      editing.current = false
    } catch (cause) {
      if (isHealthApiError(cause) && cause.code === 'REVISION_MISMATCH') {
        try {
          const saved = await getFunnel(progress.assessmentId)
          setSnapshot(saved.data)
          setError('Your answers changed in another tab. Review this answer, then continue.')
        } catch {
          setError('We couldn’t refresh your answers. Please try again.')
        }
      } else setError('That answer couldn’t be saved. Please check your connection and try again.')
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  async function finish() {
    if (!progress || !snapshot || pending.current) return
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      // Re-read canonical core revision. Draft answers stay recoverable if any write fails.
      let current = (await getAssessment(progress.assessmentId)).data
      if (current.status === 'completed') {
        router.push(`/results/${current.assessmentId}`)
        return
      }
      const latest = (await getFunnel(progress.assessmentId)).data
      if (latest.revision !== snapshot.revision) {
        setSnapshot(latest)
        setError(
          'Your answers changed in another tab. Please review the updated summary before continuing.',
        )
        pending.current = false
        setBusy(false)
        return
      }
      const a = snapshot.answers
      const commands = [
        { stepKey: 'sex', data: { sexForCalorieEstimation: a.sexForCalorieEstimation } },
        { stepKey: 'goal', data: { primaryGoal: a.primaryGoal } },
        {
          stepKey: 'body',
          data: {
            ageYears: a.ageYears,
            heightCm: a.heightCm,
            weightKg: a.weightKg,
            targetWeightKg: a.targetWeightKg,
          },
        },
        { stepKey: 'activity', data: { activityLevel: a.activityLevel } },
      ] as StepUpdateCommand[]
      for (const command of commands) {
        const result = await saveAssessmentStep(current.assessmentId, current.revision, command)
        current = { ...current, ...result.data }
      }
      const result = await submitAssessment(current.assessmentId, current.revision)
      rememberAssessment({ ...current, status: 'completed' })
      router.push(`/results/${result.data.assessmentId}`)
    } catch (cause) {
      setError(
        isHealthApiError(cause) && cause.code === 'UNREASONABLE_TARGET'
          ? 'Your target weight doesn’t match your goal, or is outside a suitable range. Please review your weight goal and measurements.'
          : 'We couldn’t finish your summary. Your answers are saved—please try again.',
      )
      pending.current = false
      setBusy(false)
    }
  }

  const question = QUESTIONS[index]
  return (
    <main className="studio-quiz">
      <SiteHeader compact />
      <div className="studio-quiz-shell">
        <div className="studio-quiz-top">
          <button
            className="quiz-back"
            disabled={busy}
            aria-label="Previous question"
            onClick={() => {
              if (index === 0) router.push('/')
              else {
                editing.current = false
                setIndex(index - 1)
                setError(null)
              }
            }}
          >
            ←
          </button>
          <span>{question?.section ?? 'Your personal summary'}</span>
          <span>
            {Math.min(index + 1, QUESTIONS.length)} / {QUESTIONS.length}
          </span>
        </div>
        <div
          className="studio-progress"
          role="progressbar"
          aria-label="Your progress"
          aria-valuemin={0}
          aria-valuemax={QUESTIONS.length}
          aria-valuenow={index}
        >
          <span style={{ transform: `scaleX(${index / QUESTIONS.length})` }} />
        </div>
        {snapshot === null ? (
          <div className="quiz-skeleton" aria-label="Loading questions" aria-busy="true">
            <div />
            <div />
            <div />
            <div />
            {error && (
              <>
                <p role="alert">{error}</p>
                <button className="primary-action" onClick={() => setReload((n) => n + 1)}>
                  Try again
                </button>
              </>
            )}
          </div>
        ) : question ? (
          <section key={question.key} className="question-panel">
            <p className="eyebrow">{question.section}</p>
            <h1 ref={heading} tabIndex={-1}>
              {question.title}
            </h1>
            <p className="question-hint">{question.hint}</p>
            {question.key === 'experience' && (
              <div className="quiz-photo-strip" aria-hidden="true" />
            )}
            <QuestionInput
              key={`${question.key}-${snapshot.revision}`}
              question={question}
              value={snapshot.answers[question.key]}
              busy={busy}
              onSave={save}
            />
            {error && (
              <p className="inline-alert inline-alert--error" role="alert">
                {error}
              </p>
            )}
            <p className="question-footnote">
              {question.type === 'multi'
                ? 'Choose your answers, then continue'
                : question.type === 'number'
                  ? 'You can review your answers at the end'
                  : 'Select an answer to continue'}
            </p>
          </section>
        ) : (
          <section className="question-panel">
            <p className="eyebrow">A routine that fits your life</p>
            <h1 ref={heading} tabIndex={-1}>
              Does everything look right?
            </h1>
            <p className="question-hint">
              Your starting point is uniquely yours. Take a moment to check your answers.
            </p>
            <div className="answer-review">
              {QUESTIONS.map((q, i) => (
                <button
                  key={q.key}
                  disabled={busy}
                  onClick={() => {
                    editing.current = true
                    setIndex(i)
                    setError(null)
                  }}
                >
                  <span>
                    {q.title}
                    <strong>{answerLabel(q.key, snapshot.answers[q.key])}</strong>
                  </span>
                  <span className="review-edit">Edit</span>
                </button>
              ))}
            </div>
            {error && (
              <p role="alert" className="inline-alert inline-alert--error">
                {error}
              </p>
            )}
            <div className="question-cta">
              <button
                className="primary-action primary-action--full"
                disabled={busy}
                onClick={() => void finish()}
              >
                {busy ? (
                  <>
                    <span className="button-spinner" /> Preparing your summary…
                  </>
                ) : (
                  'See my personal summary →'
                )}
              </button>
            </div>
          </section>
        )}
      </div>
      <footer className="quiz-bottom">
        <Link href="/privacy">Privacy</Link>
        <span>Kindred · A little time for you</span>
      </footer>
    </main>
  )
}

function QuestionInput({
  question,
  value,
  busy,
  onSave,
}: {
  question: (typeof QUESTIONS)[number]
  value: unknown
  busy: boolean
  onSave: (value: unknown) => Promise<void>
}) {
  const [selected, setSelected] = useState<string[]>(Array.isArray(value) ? value : [])
  const [text, setText] = useState(typeof value === 'number' ? String(value) : '')
  const [unit, setUnit] = useState(question.unit ?? '')
  const [selectedSingle, setSelectedSingle] = useState(typeof value === 'string' ? value : '')
  const [validation, setValidation] = useState<string | null>(null)
  function numericValue() {
    const n = Number(text)
    return Number((unit === 'lb' ? n / 2.2046226218 : unit === 'in' ? n * 2.54 : n).toFixed(2))
  }
  function changeUnit(next: string) {
    if (text.trim()) {
      const metric = numericValue()
      setText(
        String(
          Number(
            (next === 'lb'
              ? metric * 2.2046226218
              : next === 'in'
                ? metric / 2.54
                : metric
            ).toFixed(2),
          ),
        ),
      )
    }
    setUnit(next)
  }
  if (question.type === 'number')
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const parsed = funnelAnswerSchemas[question.key].safeParse(
            text.trim() ? numericValue() : undefined,
          )
          if (!parsed.success) {
            setValidation(
              question.key === 'ageYears'
                ? 'Please enter an age from 18 to 80.'
                : question.key === 'heightCm'
                  ? 'Please enter a height from 120 to 230 cm (47.25–90.55 in).'
                  : 'Please enter a weight from 35 to 300 kg (77.17–661.38 lb).',
            )
            return
          }
          setValidation(null)
          void onSave(parsed.data)
        }}
      >
        {question.unit !== 'years' && (
          <div className="unit-switch" aria-label="Measurement unit">
            {(question.unit === 'cm' ? ['cm', 'in'] : ['kg', 'lb']).map((u) => (
              <button
                key={u}
                type="button"
                aria-pressed={unit === u}
                disabled={busy}
                onClick={() => changeUnit(u)}
              >
                {u}
              </button>
            ))}
          </div>
        )}
        <label className="measurement-entry">
          <span className="sr-only">{question.title}</span>
          <input
            autoFocus
            inputMode={question.unit === 'years' ? 'numeric' : 'decimal'}
            type="number"
            step={question.unit === 'years' ? '1' : '0.01'}
            value={text}
            placeholder="—"
            disabled={busy}
            aria-invalid={validation !== null}
            aria-describedby={validation ? 'measurement-error' : undefined}
            onChange={(e) => setText(e.target.value)}
          />
          <span>{unit}</span>
        </label>
        <div className="measurement-ruler" aria-hidden="true" />
        {validation && (
          <p id="measurement-error" className="inline-alert inline-alert--error" role="alert">
            {validation}
          </p>
        )}
        <div className="question-cta">
          <button className="primary-action primary-action--full" disabled={busy || !text.trim()}>
            {busy ? (
              <>
                <span className="button-spinner" /> Saving…
              </>
            ) : (
              'Continue →'
            )}
          </button>
        </div>
      </form>
    )
  return (
    <>
      <div className="answer-options">
        {question.options?.map(([option, label, description], i) => {
          const active =
            question.type === 'multi' ? selected.includes(option) : selectedSingle === option
          return (
            <button
              key={option}
              type="button"
              className={`answer-option ${active ? 'is-selected' : ''}`}
              disabled={busy}
              aria-pressed={active}
              onClick={() => {
                if (question.type === 'multi') {
                  const exclusive =
                    question.key === 'focus'
                      ? 'whole_body'
                      : question.key === 'barriers'
                        ? 'none'
                        : ''
                  setSelected((old) =>
                    old.includes(option)
                      ? old.filter((v) => v !== option)
                      : option === exclusive
                        ? [option]
                        : [...old.filter((v) => v !== exclusive), option],
                  )
                } else {
                  setSelectedSingle(option)
                  void onSave(option)
                }
              }}
            >
              <span className="option-number" aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="option-copy">
                <strong>{label}</strong>
                {description && <small>{description}</small>}
              </span>
              <span className="option-check" aria-hidden="true">
                {busy && active ? (
                  <span className="button-spinner" />
                ) : active ? (
                  '✓'
                ) : question.type === 'multi' ? (
                  '+'
                ) : (
                  '→'
                )}
              </span>
            </button>
          )
        })}
      </div>
      {question.type === 'multi' && (
        <div className="question-cta">
          <button
            className="primary-action primary-action--full"
            disabled={busy || selected.length === 0}
            onClick={() => void onSave(selected)}
          >
            {busy ? (
              <>
                <span className="button-spinner" /> Saving…
              </>
            ) : (
              'Continue →'
            )}
          </button>
        </div>
      )}
    </>
  )
}
