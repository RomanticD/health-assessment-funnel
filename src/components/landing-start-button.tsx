'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { isHealthApiError, quizDestination, recoverOrCreateAssessment } from '@/client/health-api'

export function LandingStartButton() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function startAssessment() {
    if (isLoading) return
    setIsLoading(true)
    setMessage(null)

    try {
      const progress = await recoverOrCreateAssessment()
      router.push(quizDestination(progress))
    } catch (error) {
      setMessage(
        isHealthApiError(error) &&
          (error.code === 'SESSION_EXPIRED' || error.code === 'SESSION_REQUIRED')
          ? 'Your previous session is no longer available. Clear this site’s stored data, then try again to start a fresh assessment.'
          : error instanceof Error
            ? error.message
            : 'We could not start the assessment. Please try again.',
      )
      setIsLoading(false)
    }
  }

  return (
    <div className="cta-stack">
      <button
        className="primary-action primary-action--large"
        type="button"
        onClick={startAssessment}
        disabled={isLoading}
        aria-describedby={message === null ? 'start-helper' : 'start-error'}
      >
        <span>{isLoading ? 'Restoring your progress…' : 'Build my wellness snapshot'}</span>
        {!isLoading && (
          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path d="m7.5 4.5 5 5-5 5" />
          </svg>
        )}
      </button>
      <p id="start-helper" className="action-helper">
        About 2 minutes · No account or real payment
      </p>
      {message !== null && (
        <p id="start-error" className="inline-alert inline-alert--error" role="alert">
          {message}
        </p>
      )}
    </div>
  )
}
