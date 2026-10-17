# CFO AI V2 — P1 closure report

**Branch:** `feat/v2-email-password-auth` · **Head:** `575d9ec` · **Date:** 2026-10-17
Source of the four P1s: `V2_CLEAN_INSTALL_REHEARSAL_REPORT.md` (NO-GO, 2026-10-16). No P1 was downgraded.

| ID | Title | Status |
|---|---|---|
| INST-01 | No reproducible clean installation | **CLOSED** |
| COMM-01 | Commercial plan matrix undefined / not dynamic | **OPEN** — implementation done; owner approval of PENDING values and feature matrix outstanding |
| AUTH-CFG-01 | Hosted Supabase Auth configuration unverified | **OPEN** — checklist ready; needs an authorized hosted test project |
| REVIEW-01 | Mandatory Codex review + MiMo audit | **OPEN** — both tools unavailable on this machine (credentials); package prepared |

## INST-01 — CLOSED

- **Root cause:** production had been built by applying migrations by hand over years; the repository had no way to
  produce that schema in an empty project, and reference rows lived inside old migrations with non-idempotent inserts.
- **Fix:** `install/000_baseline_public_schema.sql` (the production public-schema snapshot, structure only, identical to
  the test fixture), `install/001_reference_data.sql` (generated, every insert guarded, NULL-key tables guarded by
  `IF NOT EXISTS`), `scripts/install-v2.mjs` (EMPTY / INSTALLED / FOREIGN; baseline + ledger in one transaction;
  checksum check on re-run; V2 chain through `migrate-v2.mjs`; 13 postflight checks; private bucket
  `financial-documents`; customer/Auth/Storage/test-data gate), runbook §0.
- **Tests:** `tests/cleanInstallArtifacts.test.js` (3: baseline = fixture, structure only, seed current and guarded),
  `tests/integration/cleanInstallSafety.test.js` (2: install, idempotent re-run, data gate, changed-baseline refusal,
  foreign-database refusal).
- **Evidence:** rehearsal from an empty stack three times today: `install OK (EMPTY)` → 84 tables, 176 reference rows,
  22 migrations, postflight 13/13, bucket created private, data clean; re-run `0 rows added`, `0 applied`;
  `--verify-empty` OK; `migrate-v2 --check` OK; backup → restore into a second instance → postflight equal to source.

## COMM-01 — OPEN (owner decision)

- **Root cause:** limits were fixed in code/seed; unknown keys meant "unlimited"; the admin could not change commercial
  quantities without SQL; the website and app had separate numbers.
- **Fix (done):** value contract with "absent = undecided, never unlimited"; five new meters; owner-approved values in
  v2 drafts; Super-Admin-only catalog writes; effective-terms diff and affected companies in preview; public catalog
  endpoint + website loader; billing-paused flag-OFF mode; customer page shows every limit. Details:
  `V2_PLAN_MANAGEMENT_IMPLEMENTATION.md`.
- **Tests:** `billingPlanMatrixHttp` 8/8, `billingPausedHttp` 6/6, `billingEnforcementHttp` 9/9,
  `billingManagementCenterHttp` 6/6, `commercialBillingHttp` 9/9; browser scenarios 1–10 (`V2_BILLING_TEST_REPORT.md` §3).
- **Why still OPEN:** the drafts cannot be published until the owner decides the PENDING limits (imports, statement
  rows, accounts, storage, integrations, MCP, AI Accountant, AI document reading, companies) and the feature matrix
  (`V2_DYNAMIC_PLAN_MATRIX.md` §2–3). The website also advertises items the product does not back (Telegram employee
  channel on Control/Pro, audit-log retention tiers, priority support, "Manual vs Reconciled" import) — owner must
  approve wording before the loader goes on the real site. Closing this requires the owner's approval, not more code.

## AUTH-CFG-01 — OPEN

- **Root cause:** the product depends on hosted Supabase Auth settings (email confirmation, custom SMTP, redirect
  allow-list, rate limits sized for a single backend IP) that cannot be verified from code.
- **Fix (done):** `V2_AUTH_HOSTED_SUPABASE_CHECKLIST.md` (exact settings, the shared-IP problem with two options,
  key handling, 8-step hosted E2E); backend support for forwarding the client IP (`AUTH_FORWARD_CLIENT_IP`,
  `Sb-Forwarded-For`, default off); runbook §3.
- **Tests:** `tests/passwordAuth.test.js` 11 (incl. forwarding header on/off), `tests/sessionUser.test.js` 9, rehearsal
  `auth_e2e` 23/23 against a real GoTrue v2.195.0 + Mailpit; browser: password reset end to end (no extra 401).
- **Why still OPEN:** no authorized hosted test project; real email may not be sent without separate permission. To
  close: apply the checklist to the new production project (or a test project) and pass its §8.

## REVIEW-01 — OPEN

- **Attempted 2026-10-17** on a throwaway detached worktree at `575d9ec`:
  Codex CLI 0.160.0 → `refresh_token_invalidated` (401, stored login revoked);
  MiMo CLI 0.1.13 → "MiMo free API service has ended. Sign in or configure a third-party API."
- No result was imitated. Package: `review-package/` (diff, commits, prompt, both failed transcripts, commands).
- **To close:** owner signs in to both tools; run the two commands in `review-package/README.md`; fix confirmed P0/P1
  as a new batch; re-run the regression.

## New findings during this batch

| Severity | Finding | Status |
|---|---|---|
| P1 | Plan editor wrote absent features as `false`, silently switching off six modules for new subscribers on publish | **Fixed** `575d9ec` |
| P1 | Preview diff hid exactly that change (missing = off) | **Fixed** `575d9ec` + regression test |
| P2 | Undecided limit saved as 0 ("Not available") | Fixed `575d9ec` |
| P2 | Customer billing page omitted transactions and the newer meters | Fixed `575d9ec` |
| P2 | Admin Security screen: super admins saw the read-only view (no `current_role` in the list API); audit read the wrong key; internal user ids shown | Fixed `5f83660` |
| P2 | Password reset screen called logout with a revoked token (401) | Fixed `5f83660` |
| P2 | Operation-recovery widget and one validation message not localized | Fixed `5f83660` |
| P2 | Company wizard shows "some fields are unavailable in this schema" on every new company (`business_type` column absent in production too) | Open — pre-existing |
| P2 | Overrides/grants allowed to any platform admin (catalog is super_admin only) | Open — owner decision |
| P2 | Admin billing form inputs and checkboxes lack accessible names | Open |
| P2 | CI suites `postgresBankImportBatchHttpApi` (2) and `postgresBankReconciliationFlow` (4) fail identically on base `1f51422` (their minimal schema fails the existing session check → 503) | Open — pre-existing |
