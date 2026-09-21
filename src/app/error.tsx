'use client'

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Something interrupted this step</p>
        <h1>We could not load the assessment.</h1>
        <p className="lede">Your last confirmed server save is still the source of truth.</p>
        <button className="primary-action" onClick={reset} type="button">
          Try again
        </button>
      </section>
    </main>
  )
}
