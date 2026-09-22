# Frontend and Route Layer

`src/app` contains the Next.js App Router UI and thin HTTP route adapters.

Rules:

- UI never calculates health results or decides entitlement.
- Health answers stay in component memory until a successful server save; they are not persisted in Web Storage.
- Route handlers validate HTTP concerns and call `src/server/application`; they do not contain SQL or domain formulas.
- Dynamic `params`, `cookies()` and `headers()` are awaited per Next.js 16 conventions.
- Personalized responses use `private, no-store`; the health endpoint is liveness only.

## Implemented funnel

- `/` explains the educational value and initializes or resumes the HttpOnly-cookie session only after the visitor chooses the CTA.
- `/quiz/[stepKey]` restores the server-authoritative assessment, prevents URL-based step skipping, saves one complete step with `If-Match` and an idempotency key, and submits from review.
- `/results/[assessmentId]` renders the structurally different preview/full result DTOs. The mock-pay modal calls `/api/v1/pay`, then refetches the result instead of granting access in client state.
- Health answers and the bearer credential are never written to `localStorage` or `sessionStorage`; unsaved form characters live only in React memory.
- Ambiguous network failures retain the same `crypto.randomUUID()` idempotency key for an explicit retry. A `412 REVISION_MISMATCH` reads the concrete assessment resource (including a concurrently completed assessment), then either loads that server copy or takes the visitor to its result; it never overwrites silently.

## UI system and accessibility decisions

The visual direction is soft-minimal wellness rather than clinical sterility or aggressive conversion design: warm neutral surfaces, a dark sage/teal accent, restrained shadows, organic radial backgrounds, and no neon, “AI purple,” or glass-heavy effects. CSS custom properties in `globals.css` are the semantic color/spacing source of truth.

Interaction constraints:

- Native buttons, links, fieldsets, legends, labels, descriptions, and inline errors provide the semantic base.
- Interactive targets are at least 44×44 CSS pixels with visible high-contrast focus rings and at least 8px separation in repeated choice groups.
- Body copy starts at 16px with 1.5+ line height; foreground/background pairs are chosen for WCAG AA contrast.
- The layout is mobile-first and explicitly adapts across 375, 768, 1024, and 1440px without horizontal overflow.
- Loading and server-save states use polite live regions; errors use focused summaries or `role="alert"`.
- Back links are deterministic, deep links are reconciled with the server’s `nextStep`, and refreshed pages restore confirmed progress.
- The paywall dialog moves focus inside, traps Tab/Shift+Tab, closes with Escape or its close control, restores prior focus, and prevents background scrolling.
- Motion is limited to state communication and subtle elevation; `prefers-reduced-motion` disables it.
- The paid-result projection chart uses `IntersectionObserver`: its line/fill animation starts once the chart enters the viewport, rather than during initial page render.
- Icons are inline CSS-styled SVGs with decorative icons hidden from assistive technology; no emoji are used as controls.

See `plan/09-frontend-funnel-plan.md` for the product rationale and acceptance flow.
