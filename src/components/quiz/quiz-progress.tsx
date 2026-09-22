import type { AssessmentStepKey } from '@/shared/contracts'

const STEPS: ReadonlyArray<{ key: AssessmentStepKey; label: string }> = [
  { key: 'sex', label: 'Profile' },
  { key: 'goal', label: 'Goal' },
  { key: 'body', label: 'Body' },
  { key: 'activity', label: 'Routine' },
]

type QuizProgressProps = {
  current: AssessmentStepKey | 'review'
}

export function QuizProgress({ current }: QuizProgressProps) {
  const currentIndex =
    current === 'review' ? STEPS.length : STEPS.findIndex(({ key }) => key === current)
  const completedPercent = current === 'review' ? 100 : ((currentIndex + 1) / STEPS.length) * 100

  return (
    <div
      className="quiz-progress"
      aria-label={`Assessment progress: ${Math.round(completedPercent)}%`}
    >
      <div className="progress-meta">
        <span>
          {current === 'review' ? 'Ready to review' : `Step ${currentIndex + 1} of ${STEPS.length}`}
        </span>
        <span>{Math.round(completedPercent)}%</span>
      </div>
      <div className="progress-track" aria-hidden="true">
        <span style={{ width: `${completedPercent}%` }} />
      </div>
      <ol className="progress-labels" aria-hidden="true">
        {STEPS.map((step, index) => (
          <li key={step.key} className={index <= currentIndex ? 'is-reached' : undefined}>
            {step.label}
          </li>
        ))}
      </ol>
    </div>
  )
}
