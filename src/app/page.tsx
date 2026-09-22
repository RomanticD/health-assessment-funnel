import { LandingStartButton } from '@/components/landing-start-button'
import { SiteHeader } from '@/components/site-header'

const trustPoints = [
  {
    title: 'Resume without an account',
    copy: 'A private, short-lived browser session reconnects you to server-saved progress.',
  },
  {
    title: 'Know what is estimated',
    copy: 'The result names its formula, version, safety limits, and places where it should stay silent.',
  },
  {
    title: 'Preview before demo access',
    copy: 'See a useful overview first. Protected details remain absent from the API until access changes.',
  },
]

export default function HomePage() {
  return (
    <main className="landing-page">
      <SiteHeader />

      <section className="landing-hero" aria-labelledby="page-title">
        <div className="hero-copy">
          <p className="eyebrow">A calmer two-minute health check-in</p>
          <h1 id="page-title">Turn a goal into a snapshot you can question.</h1>
          <p className="lede">
            Share four short pieces of context. We will return an educational BMI, energy estimate,
            and gradual timeline—along with the limits behind every number.
          </p>
          <LandingStartButton />
          <div className="privacy-line">
            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path d="M6.5 8V6.5a3.5 3.5 0 0 1 7 0V8M5 8h10v8H5z" />
            </svg>
            <span>Answers are not stored in localStorage or shared with advertising trackers.</span>
          </div>
        </div>

        <aside className="snapshot-preview" aria-label="Example of the result experience">
          <div className="preview-topline">
            <span>Wellness snapshot</span>
            <span className="preview-status">Educational</span>
          </div>
          <div className="preview-orbit" aria-hidden="true">
            <span>4</span>
            <small>clear steps</small>
          </div>
          <h2>Useful numbers, visible boundaries.</h2>
          <p>The server validates the complete picture before it calculates a result.</p>
          <div className="preview-bars" aria-hidden="true">
            <span style={{ width: '84%' }} />
            <span style={{ width: '62%' }} />
            <span style={{ width: '73%' }} />
          </div>
          <div className="preview-foot">
            <span>Progress saved per step</span>
            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path d="m5 10 3 3 7-7" />
            </svg>
          </div>
        </aside>
      </section>

      <section className="trust-strip" aria-labelledby="trust-title">
        <div className="trust-intro">
          <p className="eyebrow">Built to earn context, not clicks</p>
          <h2 id="trust-title">A short funnel with an honest finish.</h2>
        </div>
        <div className="trust-grid">
          {trustPoints.map((point, index) => (
            <article key={point.title}>
              <span aria-hidden="true">0{index + 1}</span>
              <h3>{point.title}</h3>
              <p>{point.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="method-preview" aria-labelledby="method-title">
        <div>
          <p className="eyebrow">What happens behind the page</p>
          <h2 id="method-title">Every answer has a clear job.</h2>
          <p>
            Sex-based equation, age, height, weight, goal, and activity feed a versioned server
            model. The model rejects inconsistent targets and withholds false precision when its
            safety envelope cannot be met.
          </p>
        </div>
        <ol>
          <li>
            <strong>Answer</strong>
            <span>One focused question at a time</span>
          </li>
          <li>
            <strong>Confirm</strong>
            <span>Review the canonical metric values</span>
          </li>
          <li>
            <strong>Understand</strong>
            <span>See the estimate and its limitations</span>
          </li>
        </ol>
      </section>

      <footer className="landing-footer">
        <p>
          Kindred Health is a technical demonstration. It does not provide medical, diagnostic, or
          nutritional advice.
        </p>
        <span>health-v1 · Privacy-minded by design</span>
      </footer>
    </main>
  )
}
