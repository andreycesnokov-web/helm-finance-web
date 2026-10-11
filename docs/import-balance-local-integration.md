# Local import/balance integration — 2026-10-10

Candidate only. No approval to deploy, push, migrate an external database or touch actual company records.

## Reproduce on a disposable PostgreSQL instance

Use PostgreSQL 17 staging parity and Node 22 (Node 20 CI parity remains to repeat). Install repository root and client dependencies using their lockfiles. The `react-test-renderer` dependency used by V2 tests is an audit-only dependency; install it separately if running that suite and supply REACT_TEST_RENDERER_PATH.

Example commands in a new checkout after applying the cumulative patch:

```sh
npm ci
(cd client && npm ci)
# This admin DB must be disposable, loopback only, allow CREATE/DROP DATABASE
# and role setup. No hosted/production URL is accepted by the new runner.
export DATABASE_URL=postgresql://postgres:local_password@127.0.0.1:5432/postgres
node tests/integration/runImportBalanceAudit.cjs ./audit-results
```

The runner creates/drops synthetic test databases, applies the production schema fixture plus migrations and saves complete TAP logs, summary and SQL load JSON. Never use an admin URL for a valuable local database cluster: role setup is cluster-wide. The historical schema fixture contains DDL, not real financial rows. Existing separate suites may use older minimal fixtures; the new combined SQL and HTTP suites use the full fixture. A nonzero exit is intentional while the three legacy currency assertions remain red. Do not change expectations to obtain a green release signal.

## Required migration order

1. 069_bank_import_atomic_confirm.sql
2. 070_atomic_business_balance.sql
3. 071_financial_records_restrict_user_delete.sql
4. 20261010143341_import_balance_compat.sql

The restrict migration was renamed from 070 only in this unapplied local candidate. Verify actual remote migration history before any deployment plan; do not rename or replay an already-applied remote migration. Repository legacy numbering is mixed with a timestamped compatibility migration. The new migration was created with the Supabase CLI and then moved to the repository's existing migrations directory. A separate deployment procedure must explicitly enumerate order; do not assume CLI discovery of this legacy layout.

Deploying the new backend before its RPCs/columns/guards exist is incompatible. New backend must fail closed without RPC; no row-by-row fallback. This runbook authorizes no deployment.

## Guarantees tested and limits

The compatibility migration sets bank_import_row_id during atomic confirm, validates provenance, enforces reciprocal row/ledger links at COMMIT, checks create/link scope/currency/wallet/date/amount/direction, freezes imported money fields, enforces global ledger gate before import locks, and computes partial reconciliation over all linked rows. Service-role invoker privileges and RLS are preserved. Test-only local service_role BYPASSRLS matches the Supabase service role.

Authenticity of uploaded bank statements is not proven by row IDs. A privileged writer able to forge both source bank evidence and ledger data remains within the trust boundary.

The global gate is intentionally retained; independent companies queue. Raw privileged code that locks a wallet before entering the ledger gate can still deadlock with a ledger writer. Wallet metadata/currency/alias writes and every other entry point require a complete lock-order review before broad production release. New fixtures are not proof of all application paths or all V2 features.

SQL load is single-machine loopback, not HTTP end-to-end. Long import A includes deliberate test-only row delays. Gate times include query round trips. A first TRUNCATE-based run hit PostgreSQL XX000/storage behaviour and is invalid; logs are retained. Fresh database per trial completed. Repeat on ordinary PostgreSQL 17 with production-like schema volume before capacity claims.

## V2 regression/build reproduction

With audit-only react-test-renderer 18.3.1 installed next to React 18.3.1:

```sh
export REACT_TEST_RENDERER_PATH=/absolute/path/audit-deps/node_modules/react-test-renderer
node --test --test-concurrency=1 tests/integration/v2BankImportScope.test.js tests/integration/v2CompanyScope.test.js tests/v2BusinessRequest.test.mjs tests/integration/v2CompanyProfileHttp.test.js tests/profileColumns.test.js tests/design/v2Nav.test.mjs tests/statementInsights.test.mjs tests/statementParsers.test.js
(cd client && VITE_DESIGN_V2=true VITE_EMAIL_AUTH_ENABLED=true node node_modules/vite/bin/vite.js build)
(cd client && VITE_DESIGN_V2=false VITE_EMAIL_AUTH_ENABLED=true node node_modules/vite/bin/vite.js build)
```

The load result must have 12 complete steady trials with attempts equal to successes and empty error maps. Controlled 55P03 and residual 40P01 diagnostics are separately reported and are not counted as steady-load successes. The runner keeps the release result red for the legacy currency failures; a fresh load JSON is required on each invocation.
