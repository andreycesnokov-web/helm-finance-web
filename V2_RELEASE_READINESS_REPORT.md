# CFO AI V2 — Release readiness report

**Verdict: NO-GO.** Three P1s remain open (COMM-01, AUTH-CFG-01, REVIEW-01). Zero open P0. GO requires zero open P0/P1
with verifiable evidence; the remaining three need owner action (approvals, a hosted test project, reviewer sign-in),
not more code in this branch.

This report closes the "Final Billing Architecture, Dynamic Plan Management & Release Readiness" brief and replaces the
planned `V2_FINAL_RELEASE_READINESS.md` from the "Release Hardening" brief (same scope, merged).

## 1. Candidate

| | |
|---|---|
| Branch | `feat/v2-email-password-auth` (local only — not pushed, not merged) |
| Base | `1f51422` (V2 security fix report) |
| HEAD | `575d9ec` (+ the docs commit containing this report) |
| Size | 73 files, +13,692 / −140 (≈6,900 lines are the schema snapshot copied into `install/000`) |

Commits since base:

```
575d9ec fix(billing): plan editor never switches features off or decides limits silently; diff shows effective terms; customer sees every limit
5f83660 fix(ui): reset screen without a revoked-token logout call, Platform Admin security screen fixes, RU/ID strings
840d58c test(rehearsal): keep shell scripts LF on every checkout
b71ae02 docs(release): clean-install runbook, hosted Supabase Auth checklist, AUTH_FORWARD_CLIENT_IP
69518e0 test(rehearsal): clean-install rehearsal toolkit on a disposable local Supabase-equivalent stack
69474ec test(install): clean-install artifact and installer safety tests; billing audit and plan matrix docs
9a7b619 feat(billing): dynamic plan matrix enforcement, Super-Admin plan changes, public catalog, billing-paused mode
178ac42 feat(install): clean installation of an empty Supabase project + billing plan-matrix schema
652f3be docs(release): V2 clean-install rehearsal report (NO-GO, 4 open P1)
9750a51 fix(billing): keyed payment and import-confirm replays are not re-admitted
97fae11 feat(auth-ui): email + password screens in the v2 sign-in (flagged)
71aa0a8 feat(auth): email + password sign-in through Supabase Auth (flagged, off by default)
88c94a3 test(contracts): supply stable keys and the full migration chain in writer contracts
```

## 2. Migrations (forward-only; none applied anywhere live)

| File | Purpose | Down |
|---|---|---|
| `migrations/074_supabase_auth_password_link.sql` | immutable `auth_user_links`, server-side `auth_app_sessions`, service_role-only RPCs | — |
| `supabase/migrations/20261018090000_billing_plan_matrix.sql` | value contract, 5 meters, i18n texts, public catalog, owner-value drafts | `_down.sql` (rehearsal only; refuses when usage exists; needs explicit confirmation) |
| `install/000_baseline_public_schema.sql`, `install/001_reference_data.sql` | clean installation only (empty project); not run on existing databases | n/a |

No historical migration was edited. 037–039/040/041/043 untouched.

## 3. Flags and environment

| Flag | Default | Meaning |
|---|---|---|
| `PASSWORD_AUTH_ENABLED` | false | Email + Password via Supabase Auth; passwordless sign-in answers 404 while on |
| `EMAIL_MAGIC_LINK_LOGIN_ENABLED` | unset | fallback only; keep unset in production |
| `AUTH_FORWARD_CLIENT_IP` | false | send the end-user IP to Auth (`Sb-Forwarded-For`); new, documented in `.env.example` + runbook |
| `COMMERCIAL_BILLING_ENABLED` | false | OFF = billing paused for commercial companies, legacy unchanged |
| `VITE_PASSWORD_AUTH_ENABLED`, `VITE_EMAIL_AUTH_ENABLED`, `VITE_DESIGN_V2` | false | build-time UI flags |

No Railway, Cloudflare, DNS, Supabase or VPS setting was read or changed.

## 4. P0 / P1 / P2

- **P0:** none open.
- **P1:** INST-01 **CLOSED**; COMM-01 **OPEN** (owner approval of PENDING limits + feature matrix + website wording);
  AUTH-CFG-01 **OPEN** (hosted project verification); REVIEW-01 **OPEN** (Codex login revoked; MiMo free API ended).
  Two new P1s found in this batch (plan editor silently switching features off; diff hiding it) — **fixed** with a
  regression test. Details: `V2_BILLING_P1_CLOSURE_REPORT.md`.
- **P2 open:** company wizard "schema" notice (pre-existing); overrides/grants allowed to any platform admin (owner
  decision); admin billing inputs without accessible names; 2 CI suites failing identically on base; 3 design-test
  files with the same failures as base; 9 admin tests on `ADMIN_TELEGRAM_IDS`; Windows/Node 24 exit assertion in
  CLI processes (environment).

## 5. Tested on the real UI

Plan Management end to end (edit → draft → diff → confirm → publish → audit), public pricing via the loader on a
scratch copy of the website page (live, fallback, mobile), new client registration through the inbox → company →
Starter trial with 2,000 transactions, existing client pinned to the old version, temporary override and its expiry,
password reset (RU) without the extra 401, Platform Admin → Security as super admin. Evidence and full tables:
`V2_BILLING_TEST_REPORT.md`.

## 6. Could not be verified

Hosted Supabase Auth (SMTP, confirmation, rate limits, forwarding); Codex review and MiMo audit; real staging and
production; multi-instance cache timing (documented, ≤ ≈90 s worst case); online payments (not built).

## 7. Owner decisions required

1. Approve or change the PENDING limits and the feature matrix (`V2_DYNAMIC_PLAN_MATRIX.md` §2–3); then a super admin
   publishes in Platform Admin → Billing (no code or SQL).
2. Approve website wording for unbacked claims (Telegram employee channel on Control/Pro, audit retention tiers,
   priority support, "Manual vs Reconciled"), and the loader on the real site.
3. Provide/authorize a hosted Supabase test project and permission to send test email (AUTH-CFG-01).
4. Sign in to Codex and MiMo so REVIEW-01 can run (`review-package/README.md`).
5. Decide whether company overrides/free access should be super_admin only.

## 8. AGENTS.md report

- **Files changed:** see §1 (73 files; key: `server/lib/{passwordAuth,sessionUser,commercialBilling,commercialAdmission,billingPaused,billingRoutes}.js`,
  `server/index.js`, `scripts/{install-v2,migrate-v2}.mjs`, `install/*`, the two migrations, `client/src/v2/{auth,admin,pages}/*`,
  `client/public/embed/cfo-pricing.js`, tests, docs).
- **Tests/checks:** §5 and `V2_BILLING_TEST_REPORT.md`.
- **Workspace type:** Business (billing, onboarding) and Platform/admin; auth affects all users' sign-in (Email +
  Password, flagged). Personal workspaces: no data-path change; no business record is created for Personal.
- **Flags:** new `AUTH_FORWARD_CLIENT_IP` (documented); others unchanged in meaning except flag-OFF billing paused.
- **Migrations:** two new forward-only (above); nothing applied to live databases.
- **Risks reduced:** reproducible clean install; no silent unlimited limits; no silent feature switch-off on publish;
  server-side password sessions revoked at once.
  **Risks introduced:** Supabase Auth becomes a dependency for sign-in when the flag is on (hosted config must match the checklist).
- **Production impact:** none — nothing pushed, merged or deployed.

## 9. Housekeeping done in this session

Local rehearsal stack and preview servers stopped at the end; throwaway review/base worktrees removed; a disposable
`testdb` on the local test cluster created and dropped. `git worktree prune` also removed seven stale worktree records
whose directories no longer existed (metadata only).
