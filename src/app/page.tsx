import Image from 'next/image'
import Link from 'next/link'
import { LandingStartButton } from '@/components/landing-start-button'
import { SiteHeader } from '@/components/site-header'

export default function HomePage() {
  return (
    <main className="studio-home">
      <SiteHeader />
      <section className="studio-hero" aria-labelledby="page-title">
        <div className="studio-hero-copy">
          <p className="eyebrow">YOUR SPACE. YOUR PACE.</p>
          <h1 id="page-title">
            A little movement.
            <br />
            <em>A little more you.</em>
          </h1>
          <p className="studio-lede">
            Find your starting point with Pilates-inspired movement, everyday habits, and a goal
            that feels like yours.
          </p>
          <LandingStartButton />
          <div className="hero-promises">
            <span>Beginner-friendly</span>
            <span>At your own pace</span>
            <span>Made for real life</span>
          </div>
        </div>
        <div className="studio-hero-visual">
          <Image
            src="/pilates-studio.png"
            alt="A gentle seated stretch in a sunlit home studio"
            fill
            priority
            sizes="(max-width: 760px) 100vw, 50vw"
          />
          <div className="photo-caption">
            <span>
              Small moments.
              <br />
              <strong>Meaningful beginnings.</strong>
            </span>
            <span className="caption-arrow" aria-hidden="true">
              ↗
            </span>
          </div>
          <div className="photo-tag">THE EVERYDAY MOVEMENT EDIT</div>
        </div>
      </section>
      <div className="studio-values">
        <span>Move with intention</span>
        <i aria-hidden="true">·</i>
        <span>Build your rhythm</span>
        <i aria-hidden="true">·</i>
        <span>Feel more like yourself</span>
      </div>
      <section className="studio-how" id="how-it-works">
        <div>
          <p className="eyebrow">IT STARTS WITH YOU</p>
          <h2>
            No perfect routine.
            <br />
            Just <em>your next step.</em>
          </h2>
          <p>
            Whether you’re finding your feet or finding your way back, start with a few simple
            questions about you.
          </p>
        </div>
        <div className="studio-how-cards">
          {[
            [
              '01',
              'Tell us what matters',
              'Your goals, your experience, and the rhythm of your everyday life.',
            ],
            [
              '02',
              'Make space for yourself',
              'Choose a time, pace, and setup that feel genuinely doable.',
            ],
            [
              '03',
              'Meet your starting point',
              'Explore your movement preferences, daily energy guide, and estimated progress.',
            ],
          ].map(([n, title, copy]) => (
            <article key={n}>
              <span>{n}</span>
              <div>
                <h3>{title}</h3>
                <p>{copy}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
      <footer className="studio-footer">
        <span>Kindred Health</span>
        <p>A little time for you.</p>
        <Link href="/privacy">Privacy & information</Link>
      </footer>
    </main>
  )
}
