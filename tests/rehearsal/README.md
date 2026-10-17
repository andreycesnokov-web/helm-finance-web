# Clean-install rehearsal (local, disposable)

End-to-end proof that CFO AI V2 installs into an **empty** Supabase-equivalent stack and works with Email + Password
sign-in, without touching any real environment.

```bash
bash tests/rehearsal/run_all.sh            # full run from an empty stack; results in $REHEARSAL_HOME/final
bash tests/rehearsal/run_all.sh --cleanup  # remove the containers and REHEARSAL_HOME
```

Requirements: Docker, Node 20+, `npm install` in the repo root, a built client (`client/dist`) for UI checks.

## Safety

- Everything binds to `127.0.0.1` (ports 55440–55470, `env.cjs`). Containers are named `xr-ci-*`.
- Secrets are generated per machine into `REHEARSAL_HOME` (default `<tmp>/cfo-rehearsal`), never into the repo.
- The app runs under `netguard.cjs`: every non-loopback outbound connection is refused and logged
  (`final/egress-blocked.txt`), so nothing reaches Telegram, Resend, Anthropic or FX providers.
- Email goes to the local Mailpit inbox; accounts use `@rehearsal.test` addresses.
- No production, staging or customer data is read or copied.

## Phases

| Script | Covers |
|---|---|
| `stack.sh` | PostgreSQL 17 (Supabase image), GoTrue v2.195.0, PostgREST, Storage API, Mailpit |
| `gateway.cjs` | Kong-equivalent gateway on 55450 (`/auth/v1`, `/rest/v1`, `/storage/v1`) |
| `scripts/install-v2.mjs` | plan → install → re-run (idempotent) → verify-empty; then `migrate-v2 --check` |
| `app.cjs` | backend + built client on one origin; `on`/`off` = `COMMERCIAL_BILLING_ENABLED`; `--forward-ip` |
| `auth_e2e.cjs` | registration, confirmation, login, wrong password, reset, existing-user collision, sessions, logout |
| `admin.cjs` | CLI super_admin bootstrap (one-time), Platform Admin read surfaces, customer refused |
| `onboarding.cjs` | plan publication (owner-approved + REHEARSAL-ONLY pending values), trial, entitlements, expiry |
| `finance.cjs` | wallets, transactions, transfers, debts, imports, Pulse vs ledger, isolation |
| `docs.cjs` | private Storage upload, company-scoped paths, cross-company isolation, review audit |
| `security.cjs` | JWT tampering, PostgREST anon/authenticated access, CORS, log hygiene |
| `billing_off.cjs` | billing paused semantics with the flag OFF |
| `backup.cjs` | `pg_dump` → restore into a second instance → ledger, postflight and sign-in on the restore |

Values marked REHEARSAL-ONLY in `onboarding.cjs` are test data for limits that are still PENDING APPROVAL; they are
not proposals and must not be copied into production.
