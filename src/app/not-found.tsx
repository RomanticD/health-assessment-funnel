import Link from 'next/link'

export default function NotFoundPage() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">404</p>
        <h1>This assessment page does not exist.</h1>
        <p className="lede">Return to the start to recover any valid server-side progress.</p>
        <Link className="primary-action" href="/">
          Return home
        </Link>
      </section>
    </main>
  )
}
