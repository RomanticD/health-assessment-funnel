'use client'

import Script from 'next/script'
import { useEffect, useState } from 'react'

type SwaggerUiBundle = (options: {
  deepLinking: boolean
  defaultModelsExpandDepth: number
  displayRequestDuration: boolean
  dom_id: string
  docExpansion: 'list' | 'full' | 'none'
  url: string
}) => unknown

declare global {
  interface Window {
    SwaggerUIBundle?: SwaggerUiBundle
  }
}

export function ApiExplorer() {
  const [scriptReady, setScriptReady] = useState(false)
  const [scriptFailed, setScriptFailed] = useState(false)

  useEffect(() => {
    if (!scriptReady || window.SwaggerUIBundle === undefined) return

    const root = document.getElementById('swagger-ui')
    if (root === null) return
    root.replaceChildren()
    window.SwaggerUIBundle({
      url: '/openapi.yaml',
      dom_id: '#swagger-ui',
      deepLinking: true,
      docExpansion: 'list',
      displayRequestDuration: true,
      defaultModelsExpandDepth: 1,
    })
  }, [scriptReady])

  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
      <Script
        src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
        onError={() => setScriptFailed(true)}
      />
      <div className="api-docs-viewer" id="swagger-ui" aria-live="polite">
        {!scriptFailed && <p className="api-docs-loading">Loading API reference…</p>}
        {scriptFailed && (
          <p className="api-docs-loading">
            The interactive reference could not load. Read the{' '}
            <a href="/openapi.yaml">OpenAPI 3.1 document</a> directly.
          </p>
        )}
      </div>
    </>
  )
}
