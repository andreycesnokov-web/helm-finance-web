# CFO AI V2.0 — Security Fix Report (P0/P1 release blockers)

Executor: Claude · Date: 2026-10-16 · Source review: `V2_CROSS_REVIEW_CLAUDE.md`

## 1. Branch, worktree, commits

| | |
|---|---|
| Branch | `fix/v2-rc1-claude-security` (local only — not pushed, not merged) |
| Worktree | `C:/tmp/cfo-sec` |
| Base | `fix/v2-rc1-p1-hardening` @ `a48b761a688ad89a7b0aaeeea069e7dd43db255f` |
| `38e1b86` | Merge of `feat/billing-enforcement` @ `be22c97` into this branch only. Same tree as the clean `merge-tree` preview `05a7f54`. Needed to prove Billing Enforcement 8/8 on an integration tree. |
| `b259357` | Security fix batch (073, atomic admin audit, guarded migration runner, runbook, tests) |
| report commit | this file (see `git log`) |

Unchanged:
- AntiGravity worktree `C:/tmp/cfo-p1-hardening` — `a48b761`, clean.
- `feat/billing-enforcement` — `be22c97`.
- `release/cfo-v2-rc1` — `405827f`.
- `main` and `integration/pilot-rc1-main`.

Not touched at all: staging, production, any live database. Every database in this work was disposable (production schema snapshot + migrations) and dropped after use.

## 2. Files changed by the security batch (`b259357`)

| File | Change |
|---|---|
| `migrations/073_platform_admins_security.sql` | **new**, forward-only correction for 072 (072 is left unchanged) |
| `migrations/073_platform_admins_security_down.sql` | **new**, fail-closed rehearsal down (restores the 072 definitions verbatim) |
| `server/lib/platformAdmin.js` | grant / revoke / bootstrap call only the atomic RPCs; no JS fallback; stable error codes |
| `server/index.js` | admin grant/revoke routes map SQL error codes; `isAdminUser` has no default auth channel |
| `scripts/migrate-v2.mjs` | **new** guarded migration runner (manifest, ledger, probes, stop rules, postflight) |
| `scripts/bootstrapPlatformAdmin.mjs` | no JS-side audit; the SQL transaction writes it |
| `V2_PRODUCTION_RUNBOOK.md` | migration, recovery, bootstrap, deployment, smoke, rollback and checklist sections rewritten |
| `tests/integration/platformAdminSecurityPg.test.js` | **new** (real PostgreSQL) |
| `tests/integration/platformAdminPostgrest.test.js` | **new** (supabase-js → PostgREST → PostgreSQL) |
| `tests/integration/migrationRunnerSafety.test.js` | **new** (real PostgreSQL, behaviour of payments/transfers) |
| `tests/integration/billingEnforcementHttp.test.js` | admin through `platform_admins` + email session (072+073); `ADMIN_TELEGRAM_IDS` removed |
| `tests/integration/billingManagementCenterHttp.test.js`, `commercialBillingHttp.test.js` | apply 073 (part of the release chain) |
| `tests/platformAdminAuth.test.mjs` | mock implements the new RPCs; scenarios 12/16 assert the new codes and atomic audit |
| `tests/hardening_adversarial_suite.mjs` | disposable database per run (was the long-lived `cfo_hardening_test`); applies 073 |

## 3. P0 / P1 table

| ID | Original problem | Fix | Test | Status |
|---|---|---|---|---|
| **P0 R-01/R-02** | Runbook pre-flight referenced 9 non-existent objects, so `has_071` was always false. Re-running Stage A silently replaced `rpc_record_debt_payment_guarded` / `rpc_execute_wallet_transfer_guarded` with versions that accept unkeyed payments and transfers. | `scripts/migrate-v2.mjs`:<br>• ledger with SHA-256 per file;<br>• multi-probe state detection (objects + function definitions), each probe proven false before and true after its file;<br>• UNKNOWN / CHANGED stop the run;<br>• the first error stops the run;<br>• never re-applies;<br>• postflight checks idempotency enforcement by definition.<br>Runbook rewritten with real names. | `migrationRunnerSafety` 5/5:<br>• old procedure reproduced: key check removed, unkeyed payment accepted;<br>• runner on a fully migrated DB: applies nothing; function hashes and balances unchanged; keyed payment and transfer repeats are replays; unkeyed ones refused;<br>• partial state stops;<br>• fresh DB applies all 20 in order and a second run is a no-op;<br>• failing file leaves nothing behind;<br>• changed checksum stops. | **FIXED** |
| **P0 R-04** | `20261017120000_billing_enforcement.sql` missing from the manifest | Manifest entry #20 + postflight "billing schema versions 3/3" | `migrationRunnerSafety` (fresh run applies it) | **FIXED** |
| **P1 R-03** | `psql -f` without `ON_ERROR_STOP` | The runner replaces hand-run psql; it stops at the first error (equivalent). Runbook forbids running files by hand. | `migrationRunnerSafety` (failing-file case) | **FIXED** |
| **P0 rollback** | Tier-2 rollback to `dd9b569`:<br>• reopens Telegram admin via `ADMIN_TELEGRAM_IDS`;<br>• locks out real admins;<br>• expires non-168h trials;<br>• drops overrides;<br>• false claim about commercial routes. | Runbook §9:<br>• rollback to `dd9b569` / pre-V2 code **forbidden**;<br>• `ADMIN_TELEGRAM_IDS` must be unset;<br>• **"Safe backend rollback target: unavailable"** until sign-off;<br>• rollback matrix A–D;<br>• kill switch `COMMERCIAL_BILLING_ENABLED=false`;<br>• restore into a new DB with reconciliation;<br>• no down migrations in production. | Evidence from the cross review (`xrRollback` scenario) | **FIXED (procedure)** |
| **P1 V-01** | 072 guard `RETURN NEW` on DELETE: every DELETE was a no-op; user deletion left an active orphan admin row (id reuse → admin again) | 073: `RETURN OLD` on DELETE; orphans removed and audited | `platformAdminSecurityPg`:<br>• 072 orphan reproduced, then removed by 073;<br>• DELETE works;<br>• last super protected (row and user);<br>• cascade removes the admin row;<br>• re-created id is not an admin. | **FIXED** |
| **P1 V-02** | Write skew: two concurrent revocations left 0 super_admins | 073: advisory lock for any change that can remove an active super_admin; REPEATABLE READ refused (SERIALIZABLE detects the conflict itself) | `platformAdminSecurityPg`:<br>• **25 rounds** direct SQL on two connections: exactly 1 remains each time;<br>• **25 rounds** via `rpc_platform_admin_revoke`: ≥1 remains;<br>• RR refusal. | **FIXED** |
| **P1 V-03** | Audit not atomic (bootstrap audit after commit; grant/revoke audit best-effort, errors swallowed) | 073:<br>• bootstrap writes `role_bootstrap` in the same transaction;<br>• `rpc_platform_admin_grant` / `rpc_platform_admin_revoke` write role + audit atomically and re-check the acting super_admin in SQL.<br>JS calls only these RPCs; any error fails closed. | `platformAdminSecurityPg`: injected audit failure (trigger on `audit_events`) → bootstrap, grant and revoke change nothing; after the fault is removed: exactly the expected audit rows. `platformAdminAuth` scenario 16. | **FIXED** |
| **P1 SEC-defs** | SECURITY DEFINER without `search_path` (072); DEFINER helpers from 046/047 | 073:<br>• no SECURITY DEFINER in admin functions (INVOKER, service_role only);<br>• `search_path = pg_catalog, public` on all;<br>• EXECUTE revoked from PUBLIC/anon/authenticated (incl. `apply_notification_grants`);<br>• stray `(integer)` bootstrap overload dropped.<br>Runbook pre-flight checks `anon` EXECUTE on every DEFINER. | `platformAdminSecurityPg` C: inventory, privileges, exactly one overload, attacker schema first in `search_path` cannot fake a verified email. | **FIXED** |
| **P1 re-apply** | Safety of 072/073 on new and existing databases | 073 is idempotent; it corrects databases that already ran 072. The runner never re-runs 072 (a re-run would revert the guard and bootstrap; proven). | `platformAdminSecurityPg` D | **FIXED** |
| **P1 PostgREST** | RPC never verified through the real request path | `platformAdminPostgrest`: throwaway PostgREST container (local Supabase image `postgrest:v14.16`, nothing downloaded) + `@supabase/supabase-js`. | 2/2, 0 skipped:<br>• unverified refused;<br>• concurrent first bootstrap via two HTTP clients → exactly one;<br>• repeat idempotent, audited once;<br>• grant/revoke through the real client;<br>• platform_admin cannot grant;<br>• last super protected;<br>• anon/authenticated keys refused for RPCs and table;<br>• missing function → `PGRST202` → `bootstrap_rpc_failed`, nothing written. | **FIXED (local PostgREST)** — repeat on staging |
| **P1 harness** | `billingEnforcementHttp` 0/8 on the integration tree (`ADMIN_TELEGRAM_IDS`) | Admin via `platform_admins` + email JWT (072+073); production RBAC unchanged | **8/8** on the integration tree | **FIXED** |
| P2 V-05 | `isAdminUser(userId, authChannel = 'email')` | Default removed | `platformAdminAuth` 17/17 | FIXED |
| P2 V-06 | Adversarial suite on a long-lived shared DB | Disposable DB per run, dropped at the end | adversarial 16/16 | FIXED |

## 4. PostgreSQL results (final sequential run on `b259357`, one suite at a time)

| Suite | Result |
|---|---|
| `platformAdminSecurityPg` (bootstrap / revoke concurrency, DELETE, audit, definer) | **7/7** |
| `platformAdminPostgrest` (real PostgREST) | **2/2**, 0 skipped |
| `migrationRunnerSafety` | **5/5**<br>• In the long sequential run the process did not exit after all 5 passed, and the 900 s timeout reported it as a failed file.<br>• Re-run 5 times (alone, and after `platformAdminPostgrest` in the same order): 5/5, exit in 6–7 s every time. Not reproduced. |
| `billingEnforcementHttp` | **8/8** |
| `billingManagementCenterHttp` | 6/6 |
| `commercialBillingHttp` (Phase 1) | 9/9 |
| `d4DatedOpeningAnchorHttp` / `d4AnchorMigration` | 11/11 / 6/6 |
| `bankImportPeriodGuardHttp` / `postgresBankImportAtomicConfirm` | 3/3 / 13/13 |
| `postgresFinancialWriterRaces` | 15/15 |
| `postgresBusinessBalance` (wallet ledger) | 26/26 |
| `businessIsolation` / `teamIsolation` / `sessionUserHttp` | 1/1 / 1/1 / 5/5 |
| `postgresUserDeleteRestrict` | 14/14 |
| `telegramWorkspace` | 53/53 |
| `financialWriterContracts` | 19/21 — **identical on base `a48b761`** (19/21): pre-existing, not caused by this batch |
| `financialRecoveryContracts` | 0/11 — the suite requires "native independent PostgreSQL"; **identical on base**. Not verified in this environment. |

Unit and design (all pass):
- Unit: `platformAdminAuth` 17, `billingOverrides` 6, `commercialAccess` 23, `commercialBilling` 15, `billingRouteCoverage` 5, `paymentAdapter` 2, `businessAccess` 1, `d4AnchorConsumers` 5, `walletLedger` 10, `financialRecovery` 10, `companyCreationRecovery` 7, `invitationRecovery` 2, `financialInsights` 1, `statementInsights` 7, `defaultCategories` 5, `sessionUser` 7.
- Adversarial suite: 16/16.
- Design guards: `v2Guards` 16, `v2AdminModel` 6, `v2Nav` 10, `v2Release` 3, `v2Review82` 9, `v2UiPilotReadiness` 6.
- Builds: `VITE_DESIGN_V2=true` exit 0, `VITE_DESIGN_V2=false` exit 0.

## 5. Billing Enforcement on the integration tree
`billingEnforcementHttp` **8/8**, all 15 scenarios: module allow/deny, direct API and MCP bypass, trial and paid-period expiry, admin grant, overrides, tenant isolation, hard/soft limits, idempotency, races, period boundary, own-data access after expiry, fail-closed down. Admin is a database-backed `super_admin` with an email session; `ADMIN_TELEGRAM_IDS` is removed from the environment.

## 6. Final migration manifest (apply only through `scripts/migrate-v2.mjs`)
1. `migrations/069_bank_import_atomic_confirm.sql`
2. `migrations/070_atomic_business_balance.sql`
3. `migrations/071_financial_records_restrict_user_delete.sql`
4. `migrations/20261010143341_import_balance_compat.sql`
5. `migrations/20261011001823_financial_writer_protocol.sql`
6. `migrations/20261011222631_intercompany_balances_security_invoker.sql`
7. `migrations/20261012032717_durable_financial_recovery.sql`
8. `migrations/20261012110000_durable_company_creation.sql`
9. `migrations/20261012123000_atomic_team_membership.sql`
10. `migrations/20261013001000_atomic_business_profile.sql`
11. `migrations/20261013031755_historical_bank_import_review_receipts.sql`
12. `migrations/20261013062733_private_import_receipt_immutability.sql`
13. `migrations/20261013114500_atomic_bill_creation.sql`
14. `migrations/20261014040810_operation_document_control.sql`
15. `migrations/20261016090000_dated_opening_anchor.sql` (D4)
16. `migrations/072_platform_admins.sql`
17. `migrations/073_platform_admins_security.sql` (**mandatory after 072**)
18. `supabase/migrations/20261015033808_cfo_commercial_trial.sql`
19. `supabase/migrations/20261017090000_billing_management_center.sql`
20. `supabase/migrations/20261017120000_billing_enforcement.sql`

Probes, dependencies and reversibility are in `V2_PRODUCTION_RUNBOOK.md` §2.2.

Procedure: `--plan` → `--apply` → `--check`. Any UNKNOWN or CHANGED entry stops the run, and only the release owner may `--adopt` after a written diff review. There is no way to force a re-run.

No separate data migration is required.

## 7. Safe rollback strategy (runbook §9)
- **Forbidden:**
  - backend rollback to `dd9b569`, `cc3af8b` or any pre-V2 commit;
  - restoring `ADMIN_TELEGRAM_IDS`;
  - down migrations on live data;
  - re-applying migrations;
  - `pg_restore --clean` into the live database.
- **Safe backend rollback target: unavailable** until this release is signed off. Afterwards, the previous signed-off build of the same schema generation (tag recorded in the runbook).
- **Matrix:**
  - **A. Frontend:** rebuild; `VITE_DESIGN_V2` needs a build and does not change backend enforcement.
  - **B. Billing:** kill switch `COMMERCIAL_BILLING_ENABLED=false`.
  - **C. Backend:** roll forward, or redeploy a same-generation signed-off build; maintenance page while fixing.
  - **D. Corruption:** maintenance page → dump the current DB → restore the backup into a NEW database → reconcile post-backup writes with D4 balance checks → switch → `--check`.
- **Before reopening, verify:**
  - admin list;
  - subscription and trial statuses;
  - financial postflight;
  - control balances.

## 8. Remaining risks
1. **Staging state is unknown.** `--plan` on a staging copy will show it. Any UNKNOWN entry needs a human decision; that is the intended stop.
2. **New operational table.** The runner creates `public.cfo_migration_ledger` (RLS enabled, no public grants) on first `--apply`.
3. **Single probe for `069`.** It creates only that function, and the runner never re-runs it anyway.
4. **Pre-existing failures, unchanged from base.**
   - `financialWriterContracts`: 2 tests fail. One concerns the "unchecked settled flag and legacy settle endpoint"; the other is the `businessIsolation` script inside a harness.
   - `financialRecoveryContracts`: requires native independent PostgreSQL and was not verified here.
   - Both need separate attention before production.
5. **PostgREST verified locally (v14.16).** Repeat `platformAdminPostgrest` against staging before production.
6. **ACLs of `apply_notification_grants` in production are unknown** (the snapshot has no ACLs). 073 revokes defensively, and the runbook pre-flight checks it read-only.
7. **One non-reproduced test-process hang** (`migrationRunnerSafety`) under the long sequential run.
8. **Billing limits from the enforcement report.**
   - Vision OCR in `extract` is not metered.
   - AI is metered per request, not per token.
   - The companies limit and the export count are not enforced.
   - Eventstripe is not usable for SaaS subscriptions.

## 9. Verdict — integration
**READY FOR INTEGRATION.** All P0 and P1 are fixed and covered by tests. The integration tree (this branch) passes every suite except the two pre-existing environment failures. Integration into `release/cfo-v2-rc1` still needs the owner's approval; it was not performed.

## 10. Verdict — staging
**READY FOR STAGING REHEARSAL**, under these conditions:
1. Owner approval.
2. `--plan` and `--apply` on a staging **copy** first, then staging.
3. `platformAdminPostgrest` repeated against staging.
4. `COMMERCIAL_BILLING_ENABLED=false` and `ADMIN_TELEGRAM_IDS` unset during migration.

**Production: NOT READY** until the staging rehearsal passes, a signed-off rollback target exists, and the pre-existing `financialWriterContracts` / `financialRecoveryContracts` items are resolved or explicitly accepted.
