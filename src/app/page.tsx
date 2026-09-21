import Link from 'next/link'

const capabilities = [
  'Progress is saved after every completed step.',
  'Health estimates are calculated and versioned on the server.',
  'Protected result details are never sent before demo access is active.',
]

export default function HomePage() {
  return (
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">A transparent two-minute check-in</p>
        <h1 id="page-title">A healthier target starts with a plan you can understand.</h1>
        <p className="lede">
          Answer four short sections to receive an educational BMI, calorie estimate, and gradual
          timeline. Your progress can be resumed on this device.
        </p>
        <Link className="primary-action" href="/quiz/sex">
          Start my assessment
        </Link>
        <p className="disclaimer">
          Demo only. This is general wellness education, not medical or nutritional advice.
        </p>
      </section>

      <aside className="trust-card" aria-label="How the assessment works">
        <p className="card-kicker">Designed for clarity</p>
        <ul>
          {capabilities.map((capability) => (
            <li key={capability}>{capability}</li>
          ))}
        </ul>
      </aside>
    </main>
  )
}
