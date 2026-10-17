# CFO AI V2 — Billing & release test report

**Branch:** `feat/v2-email-password-auth` · **Head:** `575d9ec` · **Date:** 2026-10-17
All runs are local and disposable: PostgreSQL databases created and dropped per suite, the rehearsal stack on
127.0.0.1 (`xr-ci-*` containers), synthetic `@rehearsal.test` accounts, emails to a local Mailpit inbox, outbound
network blocked for the app. No staging, production, live Supabase, real email or customer data was used.

## 1. Automated suites (final run on `575d9ec` unless noted)

| Suite | Result | Notes |
|---|---|---|
| `tests/integration/cleanInstallSafety` | 2/2 | install, idempotent re-run, data gate, changed baseline, foreign DB |
| `tests/cleanInstallArtifacts` | 3/3 | baseline = fixture, structure only, seed current + guarded |
| `billingPlanMatrixHttp` | 8/8 | contract, Super Admin, public catalog, pinning, 14-day trial for new only, override expiry, new meters, plan change in trial, concurrent publish CAS + audit, **effective-terms diff** |
| `billingPausedHttp` | 6/6 | flag OFF semantics |
| `billingEnforcementHttp` | 9/9 | |
| `billingManagementCenterHttp` | 6/6 | |
| `commercialBillingHttp` | 9/9 | |
| `migrationRunnerSafety` | 5/5 | 1 failure seen only while running concurrently with the full rehearsal; 5/5 alone |
| `financialWriterContracts` | 21/21 | |
| `postgresIndependentConnections` (CI) | 6/6 | throwaway `testdb` |
| `postgresBankImportBatchDocumentLinking` (CI) | 5/5 | throwaway `testdb` |
| `postgresBankImportBatchHttpApi` (CI) | 0/2 | **identical on base `1f51422`** — pre-existing |
| `postgresBankReconciliationFlow` (CI) | 0/4 | **identical on base `1f51422`** — pre-existing |
| `tests/passwordAuth` + `tests/sessionUser` | 20/20 | |
| Design tests (`tests/design/*.test.mjs`, one file at a time) | all pass except 3 files | `accountsMockApi` 18/3, `designPreview` 66/1, `renderedPreview` 116/2 — **same counts on base** |
| Route coverage (`billingRouteCoverage`) | 5/5 | from the previous batch; routes unchanged since |
| Client build, flags ON (`VITE_DESIGN_V2`, `VITE_EMAIL_AUTH_ENABLED`, `VITE_PASSWORD_AUTH_ENABLED`) | OK | |
| Client build, flags OFF | OK | built to a scratch directory |
| `node --check server/index.js` | OK | |

Known test debt (pre-existing, not in this batch): 9 admin tests in 4 suites still configure `ADMIN_TELEGRAM_IDS`.

## 2. Clean-install rehearsal (`bash tests/rehearsal/run_all.sh`, final run 12:20–12:27)

| Phase | Result |
|---|---|
| Empty stack → `install-v2 --plan / --install / --install / --verify-empty`, `migrate-v2 --check` | all exit 0; 84 tables, 176 reference rows, 22 migrations, postflight 13/13, private bucket, clean; re-run adds nothing |
| Auth E2E (registration, confirmation, login, wrong password, reset, collision, sessions, logout, brute force, link immutability) | 23/23 |
| Platform admin (CLI bootstrap one-time, read surfaces, customer refused) | 9/9 |
| Onboarding (owner values in drafts, publication refused while PENDING undecided, REHEARSAL-ONLY publish, trial, entitlements, expiry) | 14/14 |
| Finance (accounts, transactions, transfer, payable, receivable, statement import, Pulse = ledger, isolation) | 7/7 |
| Documents (private Storage upload, company-scoped path, isolation, review audit) | 7/7 |
| Security (PostgREST anon/authenticated, Supabase session ≠ app session, role escalation, JWT tampering, legacy routes, CORS, logs) | 9/9 |
| Billing OFF = paused | 5/5 |
| Backup → restore into a second instance (DB + Auth + Storage) | 6/6 (process then hits the Windows/Node 24 libuv exit assertion, exit 127, after results are written) |
| Outbound network attempts blocked | coingecko, open.er-api, bi.go.id (FX rates) — nothing else |

## 3. Browser scenarios (real UI, built client, Chrome pane)

| # | Scenario | Result |
|---|---|---|
| 1 | Super admin opens Billing → Plans | OK (desktop) |
| 2 | Starter "Transactions per period" 1000 → 2000, **Save draft** | v4 draft; v3 stays current |
| 3 | **Review changes** (diff) | First run exposed the editor/diff defect (six features silently off, hidden by the old diff) → fixed; after fix the diff is exactly `limits.transactions 1000 → 2000`, "1 subscriber stays on its version" |
| 4 | Confirm + **Publish** | v6 current; audit entry `catalog / starter / publish` by the super admin |
| 5 | Public Pricing (scratch copy of `website-design/pricing-page.html`, other origin, loader) | `live`; Starter 2,000 in card and table; API down → `static`, original text, all cards visible |
| 6 | New client: register (inbox), create company, select Starter, start trial | trial 7 days; usage "Операции в месяц: 0 / 2000"; effective terms 2000 |
| 7 | Existing client | stays on Starter v3 (1,000) — admin Subscriptions table and DB |
| 8 | Override: Gamma, transactions 3000, reason, end in 4 min | listed with reason/end; effective 3000; approver recorded |
| 9 | Override expiry | after the end time effective value returns to 2000 without any job |
| 10 | Mobile 375 px | pricing page and admin Plans: no horizontal page scroll; tables scroll in their wrapper |
| + | Password reset (RU) | form → new password works, old refused; no `/api/auth/logout` call, no 401 from the flow |
| + | Admin → Security | super admin sees grant form + revoke; audit shows emails and translated actions (no internal ids) |

## 4. Not verified

- Hosted Supabase Auth (SMTP, rate limits, forwarding) — needs an authorized test project (AUTH-CFG-01).
- Codex review and MiMo audit — tools unavailable (REVIEW-01).
- The flags-OFF bundle was built, not clicked through in the browser this batch.
- Real staging/production behaviour, multi-instance cache timing (described, not measured), real payment flows (none exist).
