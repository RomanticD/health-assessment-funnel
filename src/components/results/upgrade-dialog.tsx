'use client'

import { useEffect, useRef } from 'react'

type UpgradeDialogProps = {
  hasEstimate: boolean
  hasTimeline: boolean
  open: boolean
  isPaying: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => void
}

export function UpgradeDialog({
  open,
  isPaying,
  error,
  onClose,
  onConfirm,
  hasEstimate,
  hasTimeline,
}: UpgradeDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    confirmRef.current?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || dialogRef.current === null) return

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      )
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable.at(-1)
      if (first === undefined || last === undefined) return

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [onClose, open])

  if (!open) return null

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="upgrade-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="upgrade-title"
        aria-describedby="upgrade-description"
      >
        <button
          className="modal-close"
          type="button"
          onClick={onClose}
          aria-label="Close unlock dialog"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path d="m5 5 10 10M15 5 5 15" />
          </svg>
        </button>

        <div className="modal-icon" aria-hidden="true">
          <svg viewBox="0 0 28 28" focusable="false">
            <path d="M9.5 12V8.75a4.5 4.5 0 0 1 9 0V12M7 12h14v11H7z" />
          </svg>
        </div>
        <p className="eyebrow">YOUR PERSONAL PLAN</p>
        <h2 id="upgrade-title">Unlock the complete picture.</h2>
        <p id="upgrade-description">
          Your preview is ready. Unlock the rest of your personal profile for this session. No
          payment is collected here.
        </p>

        <ul className="unlock-list">
          <li>Your daily energy overview</li>
          {hasEstimate && <li>Your daily energy target</li>}
          {hasTimeline ? (
            <li>Your estimated timeline and weekly outlook</li>
          ) : (
            <li>Personal movement suggestions; no target-date prediction for this goal</li>
          )}
        </ul>

        <div className="demo-price">
          <span>Checkout</span>
          <strong>$0</strong>
          <small>No card. No charge. No renewal.</small>
        </div>

        {error !== null && (
          <p className="inline-alert inline-alert--error" role="alert">
            {error}
          </p>
        )}

        <button
          className="primary-action primary-action--full"
          ref={confirmRef}
          type="button"
          onClick={onConfirm}
          disabled={isPaying}
        >
          {isPaying ? 'Opening your summary…' : 'Unlock full summary — no charge'}
        </button>
        <button className="secondary-action secondary-action--full" type="button" onClick={onClose}>
          Keep the free preview
        </button>
      </div>
    </div>
  )
}
