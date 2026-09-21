# Supabase

This directory is the database source of truth.

- `migrations/`: ordered, forward-only schema and RPC changes.
- `seed.sql`: synthetic local/CI reset fixtures only; it is not a production deployment mechanism.
- Production demo data is created by `scripts/provision-demo-session.ts` after a tested migration deployment.

Target project: `kfyqgzuatywmsuruwsei` (`RomanticD's Project` in the `Full Stack Demo` organization).

Security model:

- revoke broad default privileges before creating application objects;
- enable RLS on every public business table with no browser table policies;
- grant only selected RPC/table operations to the server role;
- every write RPC receives a session hash, derives its owner and rejects `demo_readonly` users;
- `SECURITY INVOKER` is a transaction wrapper, not an RLS sandbox, because the server secret maps to a role that bypasses RLS.

Remote migrations are applied only after local reset, automated tests and CI pass. See `plan/05-database-schema-security.md`.
