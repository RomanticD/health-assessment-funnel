import Link from 'next/link'

type QuizStepPageProps = {
  params: Promise<{ stepKey: string }>
}

export default async function QuizStepPage({ params }: QuizStepPageProps) {
  const { stepKey } = await params

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Assessment setup</p>
        <h1>The {stepKey} step is being connected to the server contract.</h1>
        <p className="lede">
          The backend persistence flow is implemented before the final funnel interface replaces
          this temporary route.
        </p>
        <Link className="primary-action" href="/">
          Return home
        </Link>
      </section>
    </main>
  )
}
