# Personal Funding — Testing Tiers & Local-Supabase Validation

## Two tiers (NOT interchangeable)

| Tier | What it is | What it proves | What it CANNOT prove |
|------|-----------|----------------|----------------------|
| **PGlite** (`tests/migrations/ci_*.js`, `tests/integration/fundingHttpE2E.test.js`) | In-process Postgres-compatible engine + a thin supabase shim that mounts the real router. | Fast SQL/migration compatibility, RPC logic, router access/boundary/privacy logic. | PostgREST serialization, role grants (anon/authenticated/service_role), RLS, schema-cache, real default-privilege behavior. |
| **Local Supabase** (`tests/integration/fundingLocalSupabase.test.js`) | Real Docker Supabase (Postgres + PostgREST + GoTrue + Storage) driving the real `server/index.js`. | The **integration source of truth**: end-to-end HTTP → auth → resolver → entitlement → supabase-js/PostgREST → real RPC → Postgres. | — |

PGlite is **fast compatibility / SQL CI**. Local Supabase is the **final integration source of truth**. PGlite is *not* functionally equivalent to Supabase — the gate below found two real defects PGlite masked.

## Defects found against real local Supabase (and fixed)

1. **Missing table grants + no RLS on new tables.** The 039 RPCs are `SECURITY INVOKER`; the invoker (service_role) had `EXECUTE` on the functions but **no table DML grant**, so every RPC failed with `permission denied for table exchange_rate_quotes`. The migrations had relied on ambient Supabase default privileges — which would *also* auto-grant the new tables to `anon`/`authenticated`, exposing funding data directly via PostgREST and bypassing the Express privacy layer.
   **Fix:** 037 & 038 now `ENABLE ROW LEVEL SECURITY` on every new table (service_role bypasses RLS; anon/authenticated denied even if granted) + explicit role-guarded `GRANT … TO service_role` + `REVOKE … FROM anon, authenticated`. Verified: `relrowsecurity=t`, grants only `postgres`+`service_role`, `anon` PostgREST read/RPC → 401.

2. **PostgREST numeric precision loss.** PostgREST serializes `NUMERIC` as JSON numbers; supabase-js then parses them as JS doubles, truncating beyond ~17 significant digits (`0.123456789012345678` → `0.12345678901234568`). PGlite returns numerics as strings, so it never showed this.
   **Fix:** the router reads every money/rate column with a `::text` cast and re-reads rows after a mutating RPC (whose composite return is parsed lossily). Verified end-to-end: ETH 18-decimal and 10^17 IDR survive HTTP→PostgREST→DB→HTTP exactly.

## Other real-Supabase facts PGlite did not surface
- A function returning a single composite row yields a JSON **object** via PostgREST (PGlite shim returned an array). The router handles both; seed/util code must too.
- The persisted local Docker volume initially contained a **stale minimal test base** (`wallets.id` bigint, missing `currency`/`scope`/etc.) — not production-faithful. The gate resets the local `public` schema to a production-shaped base (`supabase/.local-base.sql`, gitignored) before applying 037→038→039.

## Running the local-Supabase gate
```
npx supabase start
# reset local public schema, apply supabase/.local-base.sql then migrations 037→038→039,
# NOTIFY pgrst 'reload schema', then:
SUPABASE_URL=<local> SUPABASE_SECRET_KEY=<local sb_secret> BOT_TOKEN=x JWT_SECRET=<local> PORT=3011 node server/index.js &
BASE_URL=http://127.0.0.1:3011 JWT_SECRET=<same> SUPABASE_URL=<local> SUPABASE_SECRET_KEY=<local> \
  DB_CONTAINER=supabase_db_helm-finance-web DOCKER=<docker path> node tests/integration/fundingLocalSupabase.test.js
```
Local keys come from `npx supabase status`; never commit them (`supabase/.local-env`, `supabase/.local-base.sql` are gitignored).
