# Supabase

This directory is the database source of truth.

- `migrations/`: ordered, forward-only schema and RPC changes.
- `seed.sql`: synthetic local/CI reset fixtures only; it is not a production deployment mechanism.
- Production demo data is provisioned only after a tested migration deployment; plaintext session credentials are never placed in migrations or `seed.sql`.

Target project: `kfyqgzuatywmsuruwsei` (`RomanticD's Project` in the `Full Stack Demo` organization).

Security model:

- revoke broad default privileges before creating application objects;
- enable RLS on every public business table with no browser table policies;
- grant only selected RPC/table operations to the server role;
- every write RPC receives a session hash, derives its owner and rejects `demo_readonly` users;
- `SECURITY INVOKER` is a transaction wrapper, not an RLS sandbox, because the server secret maps to a role that bypasses RLS.

## Local workflow

```bash
pnpm supabase:start
pnpm db:reset
pnpm exec supabase migration list --local
pnpm exec supabase db advisors --local --type all --level warn --fail-on none
```

`db reset` must be able to rebuild an empty database. `seed.sql` intentionally contains no reusable credential; each integration test creates isolated synthetic state.

## Runtime access

The server calls the ten `public.rpc_*` functions with `SUPABASE_SECRET_KEY`. Browser roles have no table/function grants. RPCs are `SECURITY INVOKER` with an empty `search_path`, explicitly qualified objects, owner checks, revision checks and idempotency in one transaction.

Remote migrations are applied only after local reset, database smoke and advisor checks pass. Dashboard is not used for ad-hoc DDL. See `plan/05-database-schema-security.md` and `docs/database.md`.
