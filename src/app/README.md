# Frontend and Route Layer

`src/app` contains the Next.js App Router UI and thin HTTP route adapters.

Rules:

- UI never calculates health results or decides entitlement.
- Health answers stay in component memory until a successful server save; they are not persisted in Web Storage.
- Route handlers validate HTTP concerns and call `src/server/application`; they do not contain SQL or domain formulas.
- Dynamic `params`, `cookies()` and `headers()` are awaited per Next.js 16 conventions.
- Personalized responses use `private, no-store`; the health endpoint is liveness only.

The complete funnel UI is implemented after the backend contracts stabilize. See `plan/09-frontend-funnel-plan.md`.
