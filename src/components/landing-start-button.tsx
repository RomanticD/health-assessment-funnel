'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import {
  isHealthApiError,
  quizDestination,
  recoverOrCreateAssessment,
  rememberAssessment,
} from '@/client/health-api'

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
      rememberAssessment(progress)
      router.push(quizDestination(progress))
    } catch (error) {
      setMessage(
        isHealthApiError(error) &&
          (error.code === 'SESSION_EXPIRED' || error.code === 'SESSION_REQUIRED')
          ? 'Your session has ended. Refresh this page to start again.'
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
        <span>{isLoading ? 'Starting…' : 'Find my starting point'}</span>
        {!isLoading && (
          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path d="m7.5 4.5 5 5-5 5" />
          </svg>
        )}
      </button>
      <p id="start-helper" className="action-helper">
        3-minute quiz · Made around you
      </p>
      {message !== null && (
        <p id="start-error" className="inline-alert inline-alert--error" role="alert">
          {message}
        </p>
      )}
    </div>
  )
}
