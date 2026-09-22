import type { Metadata } from 'next'
import Link from 'next/link'

import { ApiExplorer } from '@/components/api-docs/api-explorer'

export const metadata: Metadata = {
  title: 'API reference',
  description: 'Interactive OpenAPI reference for the Health Assessment Funnel API.',
  robots: {
    index: true,
    follow: true,
  },
}

export default function ApiDocsPage() {
  return (
    <main className="api-docs-page">
      <header className="api-docs-header">
        <div>
          <p className="eyebrow">DEVELOPER REFERENCE</p>
          <h1>Health Assessment API</h1>
          <p>
            Versioned session, assessment, result and entitlement endpoints. Requests use JSON;
            errors follow RFC 7807 Problem Details.
          </p>
        </div>
        <nav aria-label="API reference links">
          <a href="/openapi.yaml">OpenAPI 3.1 YAML</a>
          <Link href="/">Back to Kindred Health</Link>
        </nav>
      </header>
      <section aria-label="Interactive API reference">
        <ApiExplorer />
      </section>
    </main>
  )
}
