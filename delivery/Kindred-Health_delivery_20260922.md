# Kindred Health · 2026-09-22 release summary

Kindred Health is a recoverable 15-question wellness assessment funnel with server-side calculations, entitlement-gated results and a persisted test-environment checkout flow.

- Live application: <https://health-assessment-funnel.vercel.app>
- API reference: <https://health-assessment-funnel.vercel.app/api-docs>
- GitHub: <https://github.com/RomanticD/health-assessment-funnel>
- Release verification: [delivery/README.md](README.md)

The current release includes incremental answer persistence, refresh recovery, BMI and energy estimates, target-date projection, preview/full result projections, idempotent `/pay` activation, Supabase PostgreSQL storage, automated tests and GitHub Actions CI. The result page exposes a clear checkout entry; successful activation triggers a fresh server read so the full energy values and projection become available only when the entitlement is active.

The delivery index contains the acceptance paths, source/test locations, OpenAPI contract, ERD, the captured Supabase schema snapshot, production smoke evidence, screenshots and the detailed AI collaboration review. All published health values are synthetic; no Supabase secret or publishable key is committed.
