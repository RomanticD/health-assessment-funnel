# Backend

`src/server` is the framework-light backend core imported by Next.js Route Handlers.

Planned dependency direction:

```text
http adapters → application use cases → domain
                    ↓
              infrastructure
```

- `domain`: pure health algorithm, state rules, entitlement projection, value types.
- `application`: session, save/restore, submit, result and payment use cases.
- `infrastructure`: Supabase server client, transaction RPC repositories, clock and structured logger.
- `http`: session extraction, Problem Details, preconditions, idempotency and response headers.

The Supabase secret is server-only. RLS makes the public Data API fail closed; BOLA protection comes from RPCs that resolve the session digest and ownership inside the same transaction.
