'use client'

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body>
        <main className="shell">
          <section className="hero">
            <p className="eyebrow">Unexpected error</p>
            <h1>The application needs another try.</h1>
            <button className="primary-action" onClick={reset} type="button">
              Reload safely
            </button>
          </section>
        </main>
      </body>
    </html>
  )
}
