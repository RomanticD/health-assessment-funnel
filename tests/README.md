# Automated test system

The suite proves the required behavior at the lowest layer that can provide credible evidence. Formula and projection rules are pure unit tests. Persistence, ownership, concurrency, idempotency, entitlement, HTTP validation, and redaction run through a real Next.js server and a freshly migrated local Supabase database. The browser test uses Chromium against that same stack.

No test points at the hosted Supabase project. `tests/support/with-test-stack.mjs` discovers local credentials from the Supabase CLI, resets the local database from `supabase/migrations`, starts Next.js on `127.0.0.1:3110`, and always terminates the Next.js child process.

## One-command entry points

Prerequisites are Node 22, pnpm 10, Docker, and a Chromium binary installed by Playwright.

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium

pnpm test              # unit + fresh-DB API integration/contract tests
pnpm test:unit         # fast algorithm/projection tests
pnpm test:integration  # fresh local Supabase + real HTTP API tests
pnpm test:e2e          # fresh local Supabase + Chromium funnel
pnpm test:stack        # integration and browser tests on one fresh stack
pnpm test:coverage     # unit coverage with enforced thresholds
pnpm verify            # formatting, lint, types, coverage, build, integration, e2e
```

If Docker is unavailable, the Supabase CLI exits with its direct diagnostic rather than letting the HTTP suite time out. A pre-existing local project stack is reused when it exposes the required API credentials; an older ultra-minimal stack without Auth credentials is replaced. Local database contents are test data and are reset.

## Covered scenarios

### Algorithm and data validation

- Frozen golden example for BMI, BMR, TDEE, calorie estimate/range, date, and 30-point projection.
- All activity factors; raw BMI boundaries at 18.5, 25, and 30; maintenance behavior; low/high calorie-envelope refusal; 104-week horizon refusal.
- Missing, null, wrong-type, fractional, non-finite, under-minimum, over-maximum, and over-precision measurements.
- Ages under 18 are rejected by the V1 input contract. The product does not calculate a calorie estimate for minors.
- All target plausibility reasons: direction conflicts, over-40% change, target BMI guards, and maintenance tolerance.
- Determinism, activity monotonicity, finite positive metrics, and weekly monotone target-bounded projections with fixed property-test seeds.
- Preview projection is recursively scanned so protected keys do not exist anywhere in the JSON tree.

### Persistence and API contract

- New anonymous session, secure cookie attributes, assessment creation, incremental save, concrete/current recovery, and ETag response headers.
- Interrupted progress restores only server-confirmed answers.
- Out-of-order writes are rejected without a revision change.
- Same-key/same-payload replay is stable even with the original ETag; same-key/different-payload conflicts.
- Stale ETag and two concurrent writes: exactly one succeeds and one receives `412`, with no lost update.
- Cross-session read/write/payment attempts return `404` (BOLA/IDOR resistance).
- Repeated submit is idempotent and produces one stable result.
- Unpaid result is recursively checked for protected fields; `/pay` changes the same session to a complete full result; repeated payment is idempotent.
- Public Data API credentials cannot read business tables directly.
- RFC 7807 content type, stable error code/status/trace ID, `private, no-store`, `Vary`, and ETag behavior.
- Missing/malformed auth, conflicting bearer/cookie credentials, exact cookie Origin enforcement, bearer CLI behavior, missing/unsafe headers, unknown fields, illegal numeric injection, unsupported media type, malformed JSON, and bodies over 16 KiB.

### Browser flow

- Mobile-width landing → 15 independently saved questions → editable review → submit → preview → accessible demo-pay dialog → full result.
- Expanded draft API: partial measurement recovery, same-value replay, concurrent revisions, cross-session denial, numeric validation, and exclusive multi-select answers.
- No repeated session requests while advancing questions; loading feedback stays in the active control.
- Reload after an intermediate step proves recovery; reload after payment proves entitlement persistence.
- Invalid minor age stays on the body step and marks the field invalid.
- Health answers/session credentials are absent from `localStorage` and `sessionStorage`.
- The mobile document has no horizontal overflow; dialog receives focus before payment.

## Coverage policy and artifacts

`test:coverage` enforces at least 90% lines/statements/functions and 85% branches across the versioned algorithm and preview/full projection modules. API/repository confidence comes from real-stack scenarios rather than mocks or inflated global percentages.

GitHub Actions runs two independent jobs on Node 22:

1. `quality`: immutable install, format, lint, types, unit coverage, and production build.
2. `integration-e2e`: fresh local Supabase migrations, API/DB tests, and Chromium E2E.

Coverage and Playwright failure artifacts are uploaded. Generated `coverage/`, `playwright-report/`, and `test-results/` directories remain ignored.

## Intentionally out of scope

- Real payment-provider signatures, declines, refunds, and chargebacks: the assignment specifies a simulated `/pay` callback.
- Clinical validation of BMI/calorie formulas: tests prove deterministic implementation of `health-v1`, not medical efficacy.
- Load/soak, disaster recovery, every browser engine, and pixel-diff visual regression: these exceed the two-day challenge; concurrency, Chromium, mobile layout, and core accessibility behavior are prioritized.
- Production data and production secrets: CI is hermetic and migrates a local Supabase instance from zero.
