# Deployment and operations

Production consists of one Vercel Next.js project and one Supabase project. GitHub `main` is the deploy source; database migrations are intentionally a separate, explicit gate.

## Targets

| Component            | Target                                         |
| -------------------- | ---------------------------------------------- |
| GitHub               | `RomanticD/health-assessment-funnel` (private) |
| Vercel project       | `health-assessment-funnel`                     |
| Production origin    | `https://health-assessment-funnel.vercel.app`  |
| Supabase project ref | `kfyqgzuatywmsuruwsei`                         |
| Node                 | 22.x                                           |
| pnpm                 | 10.10.0                                        |

## Required Vercel variables

| Name                    | Type   | Scope              | Purpose                                                |
| ----------------------- | ------ | ------------------ | ------------------------------------------------------ |
| `APP_ORIGIN`            | Config | Production         | exact Origin allowlist for cookie-authenticated writes |
| `SUPABASE_URL`          | Config | Production         | Supabase project Data API origin                       |
| `SUPABASE_SECRET_KEY`   | Secret | Production         | server-only RPC credential                             |
| `VERCEL_GIT_COMMIT_SHA` | System | Production/Preview | liveness release identifier                            |

Never create `NEXT_PUBLIC_SUPABASE_SECRET_KEY`. The browser does not need any Supabase credential in this architecture.

## Release sequence

1. Run local schema reset and verification:

   ```bash
   pnpm supabase:start
   pnpm db:reset
   pnpm test:integration
   pnpm exec supabase db advisors --local --type all --level warn --fail-on none
   ```

2. Run repository gates:

   ```bash
   pnpm format:check
   pnpm lint
   pnpm typecheck
   pnpm test
   pnpm test:e2e
   pnpm build
   ```

3. Commit and push the exact source state. Wait for GitHub Actions to be green.
4. Apply the reviewed migration to Supabase as an explicit operation. Confirm migration history, table count, RLS and advisors.
5. Configure Vercel variables as Config/Secret, then redeploy the exact green commit.
6. Verify `/api/health`, execute the cURL flow in [`api.md`](./api.md), and run the browser funnel against the production alias.
7. Record the deployment ID, commit SHA and paid demo fixture in the delivery README.

Ordinary pull requests never run `supabase db push` against production. CI creates/reset a local Supabase stack, so untrusted code cannot mutate the hosted project.

## Liveness and smoke

`GET /api/health` is a liveness probe only. It does not query the database or return configuration. Database readiness is proven by the production cURL flow:

```text
session → assessment → four step writes → submit
        → preview leak assertion → pay → full assertion
```

After a release, check Vercel runtime error clusters and Supabase API/Postgres logs without logging request bodies or credentials.

## Rollback

Application rollback uses Vercel's previous production deployment. Database migrations are forward-only: do not delete/rewrite an applied migration and do not use `git reset` as a database rollback.

For a database defect:

1. stop/rollback the incompatible application deployment;
2. capture the failing invariant and affected rows;
3. add a new corrective migration with a regression test;
4. run local reset/tests/advisors from zero;
5. deploy the corrective migration, then the compatible application.

No down migration is promised for append-only result/payment data. Destructive cleanup requires a separately reviewed retention operation.

## Secret rotation

1. Create a new Supabase secret key.
2. Replace `SUPABASE_SECRET_KEY` in Vercel Production Secret.
3. Redeploy and run the full smoke flow.
4. Revoke the old key only after the new deployment is verified.

Paid demo session rotation is independent of the Supabase server secret. Update the documented session only after the replacement fixture returns full results and rejects/avoids unintended mutation.
