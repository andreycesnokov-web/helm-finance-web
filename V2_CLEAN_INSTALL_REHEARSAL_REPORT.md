# CFO AI V2.0 — Clean Production Installation Rehearsal

- **Date:** 2026-10-16/17.
- **Executor:** Claude.
- **Mode:** isolated engineering rehearsal on disposable local resources only.

**Workspace types affected**
- Personal identity: sign-in.
- Business: onboarding, billing, finance, documents.
- Platform/admin.
- Telegram: not affected (legacy login untouched).

**What was not touched**
- No deploy.
- No Kamatera, staging or production database.
- No live Supabase project.
- No Railway, Cloudflare or DNS.
- No real email.
- Nothing pushed or merged.

> **Verdict: NO-GO for production** (section 17).
>
> The clean install works end to end on a production-equivalent Supabase stack, including real Email + Password sign-in that was built in this rehearsal. Launch is still blocked by:
> - owner decisions: the plan feature/limit matrix;
> - an install procedure that does not exist yet;
> - Supabase Auth production configuration that has to be verified on a real (non-production) project.
>
> None of the blockers is a data-loss, cross-tenant or auth-bypass defect.

---

## 1. Commit and branch

| | |
|---|---|
| Audited candidate | `1f514220b3ea148ad8a9582103e33f38981f9b17` (`fix/v2-rc1-claude-security`), unchanged |
| Rehearsal branch | `feat/v2-email-password-auth` (worktree `C:/tmp/cfo-auth`), **local only** |
| Branch head | the latest commit on the branch: this report, on top of `9750a51` |

**Commits on the branch (in order)**

| Commit | Change |
|---|---|
| `88c94a3` | `test(contracts)`: the approved test-only fix. It supplies stable keys and the full migration chain; `financialWriterContracts` goes to **21/21**. |
| `71aa0a8` | `feat(auth)`: Email + Password through Supabase Auth, backend plus migration 074. Flagged OFF by default. |
| `97fae11` | `feat(auth-ui)`: sign-in, register, confirm, forgot and reset screens (V2, RU/EN/ID). Flagged. |
| `9750a51` | `fix(billing)`: keyed payment and import-confirm replays are no longer re-admitted. This is a P1 defect found here (see 7.4). |

The diff from the candidate (before this report) is 26 files, +1,225/−15, and touches:
- server:
  - `passwordAuth.js` (new);
  - `sessionUser.js`;
  - `index.js` (gates and wiring);
  - `commercialAdmission.js`;
- `scripts/migrate-v2.mjs` (MANIFEST plus postflight);
- `migrations/074_*` (plus down);
- client:
  - `AuthApp.jsx`;
  - `App.jsx`;
  - `useAuth.jsx`;
  - `actions.js`;
  - i18n ×3;
  - icon;
  - CSS;
- tests;
- `.env.example` ×2.

---

## 2. Environment

The environment is disposable and every port listens on `127.0.0.1` only. The Supabase-equivalent stack was built from Supabase's own images, the same set the Supabase CLI runs.

| Service | Image | Port |
|---|---|---|
| PostgreSQL | `public.ecr.aws/supabase/postgres:17.6.1.158` | 55440 |
| Auth (GoTrue) | `public.ecr.aws/supabase/gotrue:v2.195.0` (email confirmation ON, SMTP → Mailpit) | 55443 |
| PostgREST | `public.ecr.aws/supabase/postgrest:v14.16` | 55444 |
| Storage | `public.ecr.aws/supabase/storage-api:v1.68.10` (file backend) | 55445 |
| Test inbox | `public.ecr.aws/supabase/mailpit:v1.30.2` (no email leaves the machine) | 55441 |
| Gateway | Node process, Kong-equivalent: apikey required except `/auth/v1/verify` and `/storage/v1/*`, as in Supabase's `kong.yml` | 55450 |
| Backend | candidate branch, `NODE_ENV=production`, real `@supabase/supabase-js` against the gateway. No test adapter and no minted JWTs. | 55460 |
| Client | `vite build` with `VITE_DESIGN_V2`, `VITE_EMAIL_AUTH_ENABLED` and `VITE_PASSWORD_AUTH_ENABLED` = true, served with `/api` proxied | 55470 |

**Isolation and egress**
- **Egress guard.** The backend ran with a preloaded guard that refuses every non-loopback socket. Over the whole run it blocked only the FX-rate scheduler (`bi.go.id`, `open.er-api.com`, `api.coingecko.com`).
- **No external calls.** There were no AI, email-provider, Telegram or payment calls.
- **Secrets.** All secrets were generated for this rehearsal: DB password, Supabase JWT secret, anon/service keys and a separate app JWT secret. They were stored in the session scratchpad and deleted at cleanup.

**Final evidence run.** `run_all.sh` built the stack from **empty** and ran every phase in order (2026-10-17 06:50:51 → 06:52:02):
1. migrations;
2. Auth;
3. Admin;
4. onboarding;
5. finance;
6. documents;
7. security;
8. billing OFF;
9. backup/restore.

Browser checks (section 11) ran against the same build earlier in the session.

---

## 3. Migration results (Phase B)

### 3.1 Empty start (verified)

| Check | Result |
|---|---|
| `public` tables | 0 |
| `auth.users` | 0 |
| `storage.buckets` / `storage.objects` | 0 / 0 |
| Companies, transactions, invoices, trials, subscriptions, administrators | none |

### 3.2 Installation steps

| Step | What | Result |
|---|---|---|
| 1 | Public schema baseline = `tests/fixtures/schema/prod_public_schema_2026-10-08.sql` (schema only) | 83 tables, 323 ms |
| 2 | Reference data = the top-level `INSERT`s of legacy migrations 002/005/020/054/062. Their DDL is **not** replayed, because it would overwrite newer function bodies. | 176 rows, 0 errors. Tables: `activity_types`, `cashflow_categories`, `business_directions`, `plan_limits`, `official_sources`, `tax_rules`, `onboarding_flows`, `onboarding_steps`, `industry_templates` |
| 3 | `migrate-v2 --plan` | 21 PENDING, 0 UNKNOWN/CHANGED |
| 4 | `--apply` | exit 0, **517 ms**, 21 applied, ledger 21 rows with sha256 |
| 5 | second `--apply` | exit 0, 194 ms, nothing applied (idempotent) |
| 6 | `--check` | **12/12** postflight invariants: the 11 from the candidate plus *password sign-in bridge is service_role only* |
| 7 | Private bucket `financial-documents` | the documented manual step; the app never creates it |

### 3.3 Post-migration security posture (verified in K1)

- RLS is enabled on every `public` table, and the RLS fingerprint is identical after restore.
- There are **0 policies** in `public` and `storage`. So `anon` and `authenticated` see nothing and only `service_role` (the backend) reads or writes.
- Admin, auth-bridge, billing and money RPCs are not executable by `anon` or `authenticated`.

### 3.4 Bootstrap data classification

| Class | Content | How on a clean install |
|---|---|---|
| Required system configuration | migration ledger, billing schema versions, catalog items (`billing_catalog_items`) | created by migrations |
| Subscription catalog | Starter $59 / Control $149 / Pro $299, USD, monthly, 168 h trial. Plus legacy `plan_limits` rows free/business/founder/enterprise | prices from migrations; legacy rows from the 005 seed. **Plans are drafts with an empty feature/limit matrix** (see 7.1). |
| Regulatory reference data | `official_sources`, `tax_rules`, `industry_templates`, cashflow categories, onboarding flows | seed from the legacy migrations' INSERTs. **Not an approved artifact yet** (see 17). |
| Platform Admin bootstrap | first `super_admin` | CLI `scripts/bootstrapPlatformAdmin.mjs` after the owner registers (section 5) |
| Customer business data | — | **empty**; verified 0 rows before onboarding |

---

## 4. Authentication: Email + Password

### 4.1 Finding before the change

- Sign-in was **Magic Link + 6-digit OTP** with a custom app JWT. There were no passwords anywhere, which made it a release blocker per the brief.
- The owner approved implementing it on Supabase Auth (GoTrue), with eight mandatory requirements.

### 4.2 Design (`server/lib/passwordAuth.js`, migration 074)

**Credentials stay with Supabase Auth**
- Supabase Auth owns the credential: bcrypt hash, confirmation email, reset email.
- The backend forwards the password to GoTrue once and never stores or logs it.
- GoTrue is called over REST, so the shared admin client is never put into a user session.

**Identity and session contract are unchanged**
- After GoTrue accepts a **confirmed** email, `rpc_auth_password_session` runs as one serialized transaction:
  - it links the immutable GoTrue user id to the existing app identity (`users` / `user_email_identities`, negative ids);
  - it opens a server-side session.
- The app JWT keeps the same contract (`userId`, `firstName`, `auth_channel:'email'`) and adds `auth_method:'password'` and `sid`.
- Roles, memberships, RLS and every route are unchanged.

**Linking rules (requirement 2)**
- A link is made only for a GoTrue-confirmed email.
- An existing app identity is reused **only if its own email is verified**.
- An unverified match is refused with 409 `account_link_required`; there is no workaround.
- A link never changes: a DB trigger refuses UPDATE and DELETE.

**Sessions and revocation**
- Every request checks the `sid` row: it must exist, belong to the same user, and be neither revoked nor expired. The check is not cached.
- Logout revokes that one session.
- A password reset revokes **all** app sessions and every GoTrue session.
- Lifetime is 30 days, as for every channel today. There is no refresh token by design (see 17).

**No browser-held Supabase session**
- The confirmation and reset links land on `/auth/confirmed` and `/auth/reset`.
- The token leaves the address bar immediately and goes only to the server, which discards the GoTrue session.

**Flags**
- `PASSWORD_AUTH_ENABLED=false` (default) keeps today's behaviour.
- `true` makes magic-link/OTP **sign-in** answer 404 (requirement 5). The `/api/me/*` account routes stay available, and email verification and reset links remain.
- `EMAIL_MAGIC_LINK_LOGIN_ENABLED=true` is a documented fallback switch only.

**Abuse controls**
- Per IP: all attempts count. The right-most `X-Forwarded-For` entry is used (the one the platform proxy appends).
- Per account: **failed** attempts only, 10 per 15 min.
- GoTrue's own rate limits and per-address email interval apply on top.

### 4.3 Results

The E2E ran on the clean install with real GoTrue and the Mailpit inbox: **23/23**. A UI walkthrough in the browser covered the same flows.

| Area | Verified |
|---|---|
| Registration | Email format; password ≥10 chars, ≤72 bytes, not the email. Confirmation email received; nothing created in the app before confirmation. Duplicate unconfirmed and duplicate confirmed registrations give an identical answer: one GoTrue user, no new email, password unchanged. |
| Verification | Tampered link refused. Expired link (controlled clock) refused. Resend issues a working link. The link is single-use. The GoTrue session from the link is discarded. |
| Unverified | Correct password → 403 `email_not_confirmed`, no token. Wrong password → the generic 401. |
| Login | Correct → app session, one user, identity, profile and link. Wrong password and unknown email return byte-identical 401 bodies (no enumeration). 6 concurrent first sign-ins → exactly one user, identity, profile and link. |
| Session | Logout revokes at once (401 after). Other sessions survive a single logout. A server-expired session is refused although its JWT is valid. A `sid` is bound to its user. A password token without `sid` is refused. Refreshing the browser keeps the session. |
| Password recovery | Reset email → link → new password. All old sessions → 401. Old password → 401, new → 200. Reset link reuse refused; tampered link refused; expired link refused. A GoTrue session obtained **with the password** (`amr=password`) can never set a password; only an emailed-link session can (GoTrue 2.195 marks reset sessions `amr=otp`). |
| Existing users | A verified legacy identity links (`verified_email_match`) and keeps its user id and companies. An **unverified** legacy identity is refused with 409 and gets no session or access. |
| Brute force | The 11th failed attempt for one account is 429. The correct password also waits. Other accounts are unaffected. |
| Storage of secrets | The full data dump of `public` and `auth` contains no plaintext password. GoTrue stores only `$2a$` bcrypt hashes. App and GoTrue logs contain no password and no JWT. |
| Passwordless routes | `/api/auth/email/start`, `/verify` and `/accept-invite` → 404 |
| Legacy bypass | Forged Telegram login → 401. Magic-link routes off. A Supabase session is refused by every backend route (401). |

### 4.4 Repository tests

| Suite | Result |
|---|---|
| `tests/passwordAuth.test.js` (fake GoTrue) | 10/10 |
| `tests/sessionUser.test.js` (+2 for `sid`) | 9/9 |
| `migrationRunnerSafety` (074 in the full target) | 5/5 |
| `v2Guards` (7 new writes in the reviewed allow-list) | pass |

---

## 5. Platform Super Admin bootstrap (Phase D)

**Admin E2E: 8/9 in the final run.** The ninth check ("one-time / idempotent") failed only because of a regex escaping error in the test script.

The CLI printed `SUCCESS (Idempotent)`. A re-run of exactly that check on the final database showed:
- a second person was refused, with no `SUCCESS` line;
- the repeat was idempotent;
- exactly **1** active `super_admin`.

| Check | Result |
|---|---|
| Starting state | No administrator on a clean install. No hardcoded admin credential in the code. No HTTP bootstrap route (`/admin/bootstrap` → 404). |
| Unverified identity | Bootstrap refuses an email with no verified app identity. |
| First super_admin | The owner registers with email + password, then runs the CLI `scripts/bootstrapPlatformAdmin.mjs --email=…` with the service key. The result is the first `super_admin`, audited in the same transaction. |
| One-time | A second person is refused; a repeat is idempotent. |
| Admin surfaces | 13 read surfaces → 200: dashboard, businesses, users, administrators, administrators audit, access audit, billing overview/catalog/companies/audit/settings, tax rules. Billing Center UI rendered all sections. |
| Ordinary customer | 403 on every admin read and write. |
| Role management | `super_admin` grants `platform_admin` (audited). A `platform_admin` cannot grant (403). Revocation is immediate. The last `super_admin` cannot revoke itself. |
| Separation | Admin rights give no company membership. |

**Runtime note (Windows only).** The CLI completes its work, then Node 24 on Windows can abort in libuv at exit (`0xC0000409`). Linux/Railway is not affected, but the runbook should judge success by the output and the DB, not by the exit code alone.

---

## 6. Customer onboarding and fresh companies (Phases E, F)

Two independent customers, `owner.alpha` and `owner.beta`, registered through the real flow. Three companies were created: A1 (Control), A2 (Pro), B1 (Starter).

**Onboarding E2E: 14/14.** The UI flow was also walked through in the browser: register → confirm → sign in → `/account` → create a company → `/business/trial` → choose Starter → trial.

| Check | Result |
|---|---|
| Ownership | Exactly one membership per company (owner, correct user). |
| Policy | `billing_policy='commercial_v2'`. |
| Books | Empty: 0 wallets, transactions or debts. No inherited data; 3 distinct ids. |
| Before the trial | Every write → 402 with an upgrade path, profile writes included. The V2 wizard therefore goes to `/business/trial` before company setup. |
| Company profile | Saved with optimistic version and request key; a stale version → 409. |
| Isolation | Neither customer can read or act on the other's company (full matrix in sections 8 and 12). |

---

## 7. Billing and trial (Phases E, I)

### 7.1 Catalog vs specification

**Prices match** the specification:

| Plan | Price | Currency | Interval | Trial |
|---|---|---|---|---|
| Starter | 5900 = $59 | USD | month | 168 h |
| Control | 14900 = $149 | USD | month | 168 h |
| Pro | 29900 = $299 | USD | month | 168 h |

**Discrepancy (P1, owner decision).** All three plans ship as **drafts with `features: {}` and `limits: {}`**. Publishing them is refused with `billing_terms_incomplete`, so on a clean install no customer can choose a plan or start a trial.

To test the trial machinery, the admin published the three plans **in the disposable copy only**:
- with the seeded prices unchanged;
- with a clearly labelled rehearsal matrix (`terms_version='rehearsal-only-2026-10-16'`).

This is not a product decision. Prices were not changed.

### 7.2 Flag ON (`COMMERCIAL_BILLING_ENABLED=true`)

| Check | Result |
|---|---|
| Trial length | exactly **168 h** (`trial_ends_at − trial_started_at`) |
| Plan and company | selected plan stored; bound to the company |
| Replay | the same key is a replay |
| One trial per company | a second activation with a new key and another plan opens **no** new window and changes no plan (`already_started: true`) |
| Concurrency | 5 concurrent activations with different keys → exactly 1 starts; one window |
| Who can manage billing | only the owner; a non-member cannot read billing or start a trial (403/404) |
| Entitlements | AI CFO → 402 `billing_feature_denied` on Starter; admitted on Control/Pro. Feature and limit admission is enforced server-side. |
| Expiry (controlled clock) | writes → 402 `billing_restricted` with `billing_url`; own data readable; export package 200 (not blocked by plan) |
| Bypass attempts | no bypass by company switch, missing header or browser storage (UI validated against `/api/workspaces`; server refuses foreign `x-business-id`) |
| Admin grant | restores access for an expired company (audited); revoke removes it again; a customer cannot grant |
| UI | the trial banner shows the plan and the countdown ("Control · 6 дн. 16 ч") |
| Payments | none: "payments not connected", 0 service periods, no provider |

### 7.3 Flag OFF (`=false`, today's production behaviour): 4/4

**Exposure**
- `/api/billing`, the trial route and admin billing → 404.
- Tenant isolation is unchanged.

**Limits (important for a clean-install launch)**
- Commercial admission is off, but the **legacy plan limits** apply: the effective plan is `free`.
  - 1 company;
  - 1 user;
  - **1 wallet**;
  - 30 transactions per month;
  - no export, team or payroll.
- New companies are not commercial, and no legacy trial exists.
- A clean install with the flag OFF therefore gives every new customer the legacy Free plan.

### 7.4 Defect found and fixed: P1 billing enforcement / critical financial workflow

**The defect**
- With the flag ON, a **retried bill payment** with the same `Idempotency-Key` header, which is how the V2 client sends it, got 409 `billing_reservation_terminal`. A retried **bank-import confirm** got 402 the same way.
- Money was booked only once. But after a lost response, the user saw a billing error and could retry with a fresh key and pay twice.

**Cause and fix**
- Admission read the payment key only from the body, and the import confirm has no financial description.
- The fix (`9750a51`):
  - admission reads the payment key where the route does;
  - it lets a confirm through only when a **confirmed receipt** exists for that actor and key; the route then replays it, intent-checked, consuming nothing;
  - unknown keys still go through admission.
- A generic pass-through of committed keys was rejected: it would let a reused key run AI calls for free.

**Evidence**
- New regression test: red without the fix, green with it.
- `billingEnforcementHttp` 9/9.

---

## 8. Financial operations (Phase G): 7/7

All results are on company A1 through the real HTTP API. Every balance was cross-checked against `fn_wallet_ledger_balance`.

| | Result |
|---|---|
| G1 Accounts | Two accounts with dated openings (50,000,000 / 10,000,000). API balance = ledger. A duplicate account name → 409. Rename → 200. |
| G2 Transactions | Income 15,000,000 + expense 4,500,000 → exact balances. Same-key batch replay books nothing. A permitted edit → 200. |
| G3 Transfer | Both legs booked once (2 rows). The same `transfer_id` is a replay. Missing key → 400. Self-transfer → 400. |
| G4 Payable | 10,000,000 bill: partial 4,000,000 (header key; replay paid once) → overpayment refused ("exceeds remaining balance") → full 6,000,000 → settled, paid 10,000,000. Payment on a settled bill refused. Missing key → 400. |
| G5 Invoice (receivable) | 7,500,000, status `open`. Owned by A1; invisible to the other customer and to the owner's other company. The separate `invoices` table (migration 041) is gated and not installed. Receivables are the V2 invoices. |
| G6 Bank statement | Import → review → confirm books each row once; confirm replay books nothing. Re-upload of the same statement: `duplicate_count: 2`, re-confirm refused (409 `statement_overlap_unmatched`). Balance = before + 2,000,000 − 25,000. Reconciliation endpoint 200. |
| G7 Reporting | Pulse `totalBalance` = sum of ledger balances exactly (63,475,000). The UI showed the matching "Деньги сейчас". Another customer gets 403/404 on pulse, transactions, wallets and debts. |

**Observation (P2).** A statement row with the same date and amount as an earlier **manual** entry is not flagged (`matched_count: 0`). Duplicate protection works between statements, not between a statement and manual entries.

---

## 9. Documents (Phase H): 7/7

Results are on real Supabase Storage with a private bucket.

| | Result |
|---|---|
| Upload | init → signed PUT straight to Storage → complete. Object path `businesses/<company>/documents/<document>/<file>`. Stored once. Status `needs_review`. |
| Validation | `.exe` and `.html` → 400 `extension_not_allowed`. 200 MB → 400 `file_too_large`. Both refused before an upload URL is issued. Same file again → 409 `duplicate` with the existing id. |
| Signed URL | Owner gets a 600 s link that serves byte-identical content. A tampered token fails. |
| Private storage | Anonymous key, user key and the app JWT get no object and no listing. The bucket is `public=false`. |
| Isolation | Another customer cannot read, sign, modify, archive or complete into the company (403/404/402). The row is unchanged. |
| Review and audit | `extract` and `identify` → 200 from the PDF text layer, with **no** AI or OCR call (egress guard confirms). Archive → 200. Audit trail: `uploaded`, `signed_url_issued`, `archived`. |
| Clean-install finding (P1) | The bucket **does not exist** after migrations. Document Center answers `documents_unavailable: bucket_missing` until an operator creates it. This is documented in `docs/modules/TAX_DOCUMENTS_RUNTIME_V1.md` but **missing from `V2_PRODUCTION_RUNBOOK.md`**. |

---

## 10. AI and integrations

| Integration | Classification | Basis |
|---|---|---|
| AI CFO / AI Accountant (Anthropic) | **Unverified** | No AI key in the rehearsal and no paid calls. Plan gating verified (402 on Starter); requests on Control/Pro are admitted. Answer quality is not tested. |
| Document extraction/classification | **Limited** | Works from the PDF text layer without OCR or paid AI. OCR stays off (`DOCUMENT_OCR_VISION_ENABLED=false`). |
| Claude / ChatGPT via CFO AI MCP (OAuth connector) | **Limited / Beta** — not re-verified on the clean install | One MCP server for both clients. The OAuth consent page reuses the app session and now signs in with a password. Tool gating covered by the route-coverage test. |
| Telegram | **Legacy / not in launch scope** | The forged login is refused. The bot needs a real `BOT_TOKEN`. Owner policy: Telegram is a future paid add-on. |
| WhatsApp | **Coming Soon** | Only a reserved channel name (`whatsapp_future`); no integration code. |
| Payments (Xendit / Midtrans) | **Coming Soon** | Adapter not connected; no checkout route; nothing charged. |

---

## 11. Browser E2E and responsive QA (Phase J)

**Setup**
- Real browser with the production build. The pane was hidden, so interaction went through the accessibility tree and DOM (no screenshots).

**Flows**
- Registration, email verification (link opened in the browser), password sign-in with a wrong and then a correct password.
- Forgot → reset → reused link shows "Ссылка больше не действует".
- Company creation → trial page → Starter → trial.
- Main screens; company switching.
- Logout (token cleared; old token 401 on the server), repeat sign-in, reload keeps the session.
- Platform Admin dashboard and Billing Center.

**Screens and widths**
- Pulse, Accounts, Transactions, Payables, Receivables, Documents, Settings, Billing, Radar.
- **1440, 1024, 768, 390 and 360 px.**

| Check | Result |
|---|---|
| Horizontal page overflow | **none** at any width. Segmented tabs in Documents/Settings scroll inside their own `overflow-x:auto` container (intended). |
| Failed API calls | none during the sweep (all 200) |
| Console | "script fetch" errors come from service-worker registration on the static test server (harness). One 401 is the reset screen ending an already-revoked session (P2 noise). |
| Defects fixed during the rehearsal | The password fields had no accessible name. The confirmation text duplicated its title. |
| P2 cosmetic | The admin screens use the classic English UI with business navigation. An "Operation recovery" button is English in the RU UI. |

---

## 12. Security (Phase K1): 9/9

**A new attack surface, checked explicitly.** Supabase Auth is public, so any customer can get a **real** `authenticated` Supabase session from GoTrue with the anon key. The checks below use such a session.

| Check | Result |
|---|---|
| PostgREST reads, `anon` and real `authenticated` | 23 tables give 0 rows or are denied: identity, auth bridge, sessions, admin, companies, members, wallets, transactions, debts, documents, bank import, billing, plans, audit, ledger, OTP codes, write receipts. |
| PostgREST writes and RPCs | Inserts into `transactions`, `business_members`, `platform_admins` and `auth_user_links` refused. 10 RPCs refused: auth bridge, bootstrap, grant, billing admin and trial, debt payment, transfer, bill creation, import confirm. |
| Supabase session on the backend | refused on every route (401) |
| Role escalation | An invited `employee` cannot transfer, adjust a balance, create a wallet, start a trial, invite an owner, promote itself or reach admin. The role is unchanged. |
| JWT tampering | Wrong secret, `alg:none` and a broken signature → 401. A foreign `sid` and a missing `sid` → 401 (section 4). |
| CSRF and cookies | Bearer header only; login sets no cookie. CORS allows only `CLIENT_URL`; it must be set in production, otherwise `http://localhost:5173`. |
| Log redaction | No password and no JWT in the app log. |

---

## 13. Backup and recovery (Phase K2): 6/6

Recovery was tested for all three parts, Postgres, Auth and Storage files, into a separate fresh instance.

| Step | Result |
|---|---|
| Backup | `pg_dump -Fc` of the `public`, `auth` and `storage` schemas (1,084,645 bytes) plus a tar of the Storage file tree (9,728 bytes). Both AES-256-GCM encrypted with sha256 recorded. 654 ms. |
| Restore | A **new** instance (`xr-ci-db2`) received the checksum-verified decrypted dump: **zero** restore errors, 13 s. |
| Equality | Every one of 21 table digests, every wallet balance, billing rows, `auth.users` (ids, emails, bcrypt hashes, confirmation), `storage.objects`, buckets, 136 function definitions, grants, RLS flags and policies are **identical**. |
| Runner | `migrate-v2 --check` on the restored database: 12/12. |
| Auth | A **new GoTrue** on the restored database signs a customer in with the **original password**, and the auth↔app link is intact. |
| Storage | The files were restored into a **new Storage service**. Every object row has its file, and documents download byte-identical. |

**Production requirement.** On Supabase, Postgres backups/PITR cover the `auth` and `storage` **metadata**, but object files live in the Storage backend (S3) and need their own backup and restore. A Postgres dump alone does not recover documents.

---

## 14. Outstanding defects by severity

| ID | Sev | Status | Summary |
|---|---|---|---|
| — | P0 | — | **None found:** no data loss, cross-tenant access, financial corruption or authentication bypass. |
| AUTH-01 | P1 | **Fixed in branch** | Passwordless-only sign-in replaced by Email + Password (Supabase Auth). |
| BILL-REPLAY-01 | P1 | **Fixed in branch** | Keyed payment and import-confirm replays re-admitted under billing ON (7.4). |
| TEST-01 | P1 | **Fixed in branch** | `financialWriterContracts` outdated test (test-only fix, 21/21). |
| COMM-01 | P1 | **Open, owner decision** | Starter/Control/Pro cannot be published: empty feature/limit matrix. With the flag ON there is no trial on a clean install. With the flag OFF everyone gets the legacy Free plan (1 wallet, 30 tx/month, no export). |
| INST-01 | P1 | **Open** | No approved clean-install procedure. The baseline is a *test fixture* snapshot, reference data comes from legacy migration INSERTs, the document bucket is a manual step, and none of it is in `V2_PRODUCTION_RUNBOOK.md`. |
| AUTH-CFG-01 | P1 | **Open, needs a real Supabase project** | Production Supabase Auth settings are unverified (section 16). Risk: all sign-ins arrive at GoTrue from the backend's IP, so per-IP limits sized for browsers can throttle everyone. |
| REVIEW-01 | P1 | **Open, process** | Per `AGENTS.md`, the auth change (backend auth, migration 074) needs Codex review and a MiMo security audit before merge. |
| UX-01 | P2 | Open | Reset screen fires a logout for an already-revoked session (401 console noise). |
| UX-02 | P2 | Open | Admin screens: classic English UI with business navigation. "Operation recovery" label not translated. |
| API-01 | P2 | Open | With billing ON an unknown `/api` route answers 409 `billing_unavailable` instead of 404 (fail-closed, but misleading). |
| OPS-01 | P2 | Open | Bootstrap CLI may abort at exit on Windows/Node 24 after success. |
| IDN-01 | P2 | Open (pre-existing) | `POST /api/admin/users/:id/link-email` (any `platform_admin`) marks an email verified **without mailbox proof**. A password registrant of that mailbox then links to that user. This is the same trust model as the earlier magic link; recommend `super_admin`-only plus mailbox confirmation. |
| FIN-01 | P2 | Open | A statement row matching a manual entry is not flagged as a duplicate (8, G6). |
| TEST-02 | P2 | Open (pre-existing on `1f51422`) | 9 admin tests in 4 suites (`supportCenterApi` 5, `onboardingApi` 2, `paymentConnectionsApi` 1, `paymentCredentialsApi` 1) still use `ADMIN_TELEGRAM_IDS`, which the security fix removed. The failure set is identical on the candidate and the branch. |
| CFG-01 | P2 | Open | `BOT_TOKEN` is required at start even when Telegram is unused. |

---

## 15. Evidence and test commands

### 15.1 Rehearsal scripts

The scripts were kept in the session scratchpad and deleted at cleanup. Their logic is described above.

| Script | Purpose |
|---|---|
| `stack.sh up` | disposable Supabase-equivalent stack |
| `gateway.cjs` | Kong-equivalent gateway |
| `app.cjs on/off` | candidate app with egress guard |
| `fresh_install.cjs` | baseline + reference data |
| `node scripts/migrate-v2.mjs --plan / --apply / --apply / --check` | migrations |
| `auth_e2e.cjs` | Auth E2E |
| `admin.cjs` | Platform Admin |
| `onboarding.cjs` | onboarding, trial, billing ON |
| `finance.cjs` | financial operations |
| `docs.cjs` | documents and Storage |
| `security.cjs` | K1 security |
| `billing_off.cjs` | flag OFF |
| `backup.cjs` | K2 backup and restore |
| `run_all.sh` | everything from empty, in order |

### 15.2 Final run (from empty)

| Phase | Result |
|---|---|
| migrations | 21 applied, idempotent, 12/12 postflight |
| Auth | 23/23 |
| Admin | 8/9 + re-verified (5) |
| Onboarding / billing ON | 14/14 |
| Finance | 7/7 |
| Documents | 7/7 |
| Security | 9/9 |
| Billing OFF | 4/4 |
| Backup / restore | 6/6 |
| Egress | only the FX scheduler blocked |

### 15.3 Repository suites on the branch head

Run against the rehearsal PostgreSQL 17.6.

| Suite | Result |
|---|---|
| platformAdminSecurityPg | 7/7 |
| platformAdminPostgrest | 2/2 |
| migrationRunnerSafety | 5/5 |
| billingEnforcementHttp | 9/9 |
| billingManagementCenterHttp | 6/6 |
| commercialBillingHttp | 9/9 |
| d4DatedOpeningAnchorHttp | 11/11 |
| d4AnchorMigration | 6/6 |
| postgresFinancialWriterRaces | 15/15 |
| postgresBankImportAtomicConfirm | 13/13 |
| postgresBusinessBalance | 26/26 |
| financialRecoveryContracts (`HF_EMBEDDED_SQL=0`) | 11/11 |
| financialWriterContracts (`HF_EMBEDDED_SQL=0`) | 21/21 |
| passwordAuth | 10/10 |
| sessionUser | 9/9 |
| revokedTokens | 6/6 |
| billingRouteCoverage | 5/5 |
| v2Guards | pass |
| v2Release | pass |
| v2Review82 | pass |
| v2ShouldFix82 | pass |
| aiCfoTranslations | pass |
| v2AcctReasonKeys | pass |

### 15.4 Builds

`vite build` passes with `VITE_PASSWORD_AUTH_ENABLED` OFF and ON. The OFF build keeps the passwordless screens.

---

## 16. Required deployment configuration

### Supabase project (Auth)

- Email provider ON.
- **"Confirm email" ON**, autoconfirm OFF.
- Custom SMTP on the sender domain (for example Resend SMTP). The built-in mailer's hourly cap is not for production.
- **Site URL** = `APP_BASE_URL`.
- Redirect allow-list `APP_BASE_URL/auth/**`.
- Email templates branded RU/EN/ID; links point to `{API_EXTERNAL_URL}/auth/v1/verify` (the default).
- Minimum password length 10.
- Leave `secure password change` reauthentication off, or the reset flow fails.
- **Rate limits:**
  - raise the sign-in/sign-up and token limits for **server-side** calls (all from the backend IP), or confirm how the project treats forwarded client IPs;
  - keep the per-address email interval.
- Verify all of this on a non-production Supabase project before launch.

### Supabase project (Storage)

- Private bucket `financial-documents` (or `DOCUMENTS_BUCKET`).
- Object backup separate from Postgres.

### Backend environment

| Variable | Value |
|---|---|
| `SUPABASE_URL` | public project URL; also used in signed upload URLs that browsers call |
| `SUPABASE_SECRET_KEY` | service key |
| `JWT_SECRET` | distinct from the Supabase JWT secret |
| `APP_BASE_URL`, `CLIENT_URL` | production origin |
| `EMAIL_AUTH_ENABLED` | `true` |
| `PASSWORD_AUTH_ENABLED` | `true` |
| `EMAIL_MAGIC_LINK_LOGIN_ENABLED` | unset |
| `COMMERCIAL_BILLING_ENABLED` | `true` **only after COMM-01** |
| `COMMERCIAL_BILLING_FIXTURES` | `false` |
| `PAYMENT_CONNECTIONS_ENABLED`, `INCOMING_PAYMENTS_ENABLED`, `DOCUMENT_OCR_VISION_ENABLED` | `false` |
| `ADMIN_TELEGRAM_IDS` | unset |
| `BOT_TOKEN` | required by the server even when Telegram is unused |
| `NODE_ENV` | `production` |

### Client build

`VITE_DESIGN_V2`, `VITE_EMAIL_AUTH_ENABLED` and `VITE_PASSWORD_AUTH_ENABLED` = `true`.

### Install order

1. Supabase project.
2. Baseline schema (approved artifact).
3. Reference data (approved artifact).
4. `migrate-v2 --plan` → `--apply` → `--check` (12/12).
5. Bucket.
6. Deploy backend and client.
7. Owner registers and confirms.
8. CLI bootstrap.
9. Owner publishes approved plans.
10. Open sign-up.

---

## 17. Production GO / NO-GO

**Recommendation: NO-GO.**

### Criteria

| Criterion | Status |
|---|---|
| Clean migrations | **Pass** (from empty; idempotent; 12/12) |
| Email + Password registration and login | **Pass** (branch; flagged) |
| Email verification and password recovery | **Pass** |
| Super Admin bootstrap secure | **Pass** |
| Customer onboarding | **Pass mechanically**, but on a real clean install it is blocked by COMM-01 (no publishable plan) |
| Trial and billing enforcement | **Pass** after BILL-REPLAY-01 fix (branch) |
| Critical financial workflows | **Pass** |
| Tenant isolation | **Pass** (API, PostgREST with real Supabase sessions, Storage, UI) |
| Document security | **Pass** |
| Recovery procedure validated | **Pass** (Postgres + Auth + Storage files) |
| No unresolved P0 | **Pass** |
| No unresolved P1 | **Fail**: COMM-01, INST-01, AUTH-CFG-01, REVIEW-01 |

### Next actions, in order

1. **Owner:** approve the Starter/Control/Pro feature and limit matrix (COMM-01) and decide the launch flag. ON is recommended; OFF means legacy Free limits.
2. **Engineering (next batch):**
   - turn the clean install into approved artifacts: a `000` baseline schema, a reference-data seed and a bucket step (INST-01);
   - add them to `V2_PRODUCTION_RUNBOOK.md` with the configuration in section 16.
3. **Codex review, then MiMo audit** of `feat/v2-email-password-auth` (REVIEW-01).
4. **Owner-provided non-production Supabase project:** re-run this rehearsal's Auth and Storage phases against real hosted Auth, SMTP and rate limits (AUTH-CFG-01).
5. Only after that: staging deploy and soak, then production.

Nothing was pushed, merged, tagged or deployed.
