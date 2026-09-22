import Link from 'next/link'
import { SiteHeader } from '@/components/site-header'
export default function PrivacyPage() {
  return (
    <main>
      <SiteHeader />
      <article className="privacy-page">
        <p className="eyebrow">YOUR INFORMATION</p>
        <h1>A little clarity.</h1>
        <h2>Your answers</h2>
        <p>
          Your measurements and preferences are saved to let you continue this assessment and build
          your summary. This browser uses a short-lived session cookie. Answers are not saved in
          local or session storage.
        </p>
        <h2>Your choices</h2>
        <p>
          You can review and edit answers before completing your assessment. Your browser session
          expires after seven days. Clearing the site’s cookies disconnects this browser from the
          saved assessment, but does not delete the saved record.
        </p>
        <h2>About your summary</h2>
        <p>
          Energy needs and progress dates are estimates for general wellness education, not medical
          advice. They do not account for individual medical circumstances. A qualified professional
          can help you choose a suitable personal goal.
        </p>
        <h2>About checkout</h2>
        <p>
          This is a demonstration product. Checkout simulates access to the full summary. No money
          is charged and no payment card is required.
        </p>
        <Link className="primary-action" href="/">
          Back to Kindred
        </Link>
      </article>
    </main>
  )
}
