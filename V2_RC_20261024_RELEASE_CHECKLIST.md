# CFO AI V2 — release candidate 2026-10-24: preflight, backup/restore, rollback

Status: **prepared, not deployed.** Nothing in this document has been run against production. Every production step
needs the owner's explicit approval at the time it is run. Read with `V2_PRODUCTION_RUNBOOK.md` (Sections 2, 4, 7–9)
and `V2_AUTH_HOSTED_SUPABASE_CHECKLIST.md`.

## 1. Candidate

| | |
|---|---|
| Branch | `claude/v2-stabilization-20261024` |
| Exact SHA | recorded in the final acceptance report (the commit that carries this file or its successor on the branch) |
| Production now | `a55876d` (`integration/cfo-v2-production-ready`) — an ancestor of the candidate (fast-forward) |
| Contents | Codex RC `0b24eff` (Picker `1a9cb3a` → Payroll `a4cbffc` → OCR `c5c7295` → P&L `2809cc2`), Claude fixes `bb460d6`…`634b748` (OCR-OFF guard, real-stack P&L acceptance, credential vault GCM tag, Telegram escaping, receipt proxy), `52bb47c` (payroll sheet + BPJS split), `8adaef9` (P&L groups of system categories, financing summary), `eedd98d` (reset/resend enumeration, password acceptance), `b00a514` (accountant handoff package) |
| OCR | **off**: `DOCUMENT_OCR_VISION_ENABLED=false`, `DOCUMENT_OCR_NANONETS_ENABLED=false` (paid readers guarded since `bb460d6`) |
| Sign-in | Email + Password: server `PASSWORD_AUTH_ENABLED=true`, `EMAIL_AUTH_ENABLED=true`, `EMAIL_MAGIC_LINK_LOGIN_ENABLED` unset; client build `VITE_DESIGN_V2=true VITE_EMAIL_AUTH_ENABLED=true VITE_PASSWORD_AUTH_ENABLED=true` |

## 2. Database changes in this candidate (order is mandatory)

Applied ONLY with the guarded runner (`node scripts/migrate-v2.mjs --plan`, then `--apply`), never `psql -f`:

| # | File | What it does | Rollback |
|---|---|---|---|
| 21 | `supabase/migrations/20261022165230_payroll_runs_receipt_contract_compat.sql` | Payroll runs (draft → approve → link bank debit), no cash movement | none (forward only); before go-live only, by restoring the backup into a NEW database |
| 22 | `supabase/migrations/20261024090000_payroll_bpjs_breakdown.sql` | BPJS Kesehatan / TK JP / TK JHT kept per line | `…_down.sql` restores #21's function byte for byte (existing split rows stay valid) |
| 23 | `supabase/migrations/20261024120000_business_category_pnl_groups.sql` | Per-company P&L group of shared system categories | `…_down.sql` drops the table only |
| 24 | `supabase/migrations/20261024150000_transaction_classifications.sql` | Business purpose / accountant review marks of operations (management vs accounting preparation) | `…_down.sql` drops the table only; operations keep their category treatment |

- **Never apply `migrations/20261020163121_payroll_runs_no_cash.sql`** (superseded; aborts on the D4 receipt contract).
- #21 refuses to run if `payroll_runs` already exists or the receipt contract/reader differs from the inspected one
  (`payroll_applicability_review_required`, `payroll_receipt_contract_review_required`,
  `payroll_receipt_reader_contract_review_required`). A refusal = stop and review; never edit the file to pass.
- The ledger hash is computed by the runner on LF-normalised text. Never insert ledger rows by hand: a hand-made hash of a
  CRLF checkout shows as `CHANGED` (seen and corrected on the local stack only).

## 3. Preflight (read-only, staging first, then production with approval)

1. `git rev-parse HEAD` on the deploy checkout = the approved SHA; `git status` clean.
2. GitHub CI green on that exact SHA (build, native PostgreSQL suites incl. payroll BPJS and P&L mapping).
3. `node scripts/migrate-v2.mjs --plan` against the target: rows 1–20 `APPLIED`/`APPLIED_UNRECORDED`, rows 21–23
   `PENDING`; anything `UNKNOWN`/`CHANGED` = stop.
4. Runbook 2.4 queries (bootstrap overload, SECURITY DEFINER not executable by anon).
5. `SELECT to_regclass('public.payroll_runs'), to_regclass('public.business_category_pnl_groups');` → both NULL.
6. Auth: hosted checklist Sections 2–7 ticked; Section 8 run on a hosted test project with a real test inbox.
7. Environment (Railway, web service): flags of Section 1; `ADMIN_TELEGRAM_IDS` unset; no OCR keys required.
8. Record control values (runbook Section 4): row counts and per-wallet ledger balances.

## 4. Backup and restore

- Before any migration: `pg_dump --format=custom` of the whole database to storage OUTSIDE the database host; record
  path, size and SHA-256; plus `pg_dump --schema-only` for diffing; plus the control values of Section 3.8.
- **Restore test (mandatory before production):** restore the dump into a NEW, empty database (never `--clean` into the
  live one), run `migrate-v2.mjs --check` and compare the control values. Note: in Supabase images the `postgres` role
  does not own `pgrst_drop_watch`; a `--single-transaction` restore aborts on it — restore as the owner role or
  exclude that event trigger, and verify the object count afterwards.

## 5. Deployment sequence (when approved)

1. Maintenance window announced; backup (Section 4) done and verified.
2. `migrate-v2.mjs --apply` → rows 21, 22, 23 applied in order; postflight all `OK`, including
   "payroll and per-company P&L groups are service_role only".
3. Deploy the backend at the approved SHA; then the client build with the flags of Section 1.
4. Smoke (runbook Section 8) plus: sign-in with email + password; Payroll → new run saves a draft with the BPJS split
   and moves no money; Performance → Profit groups lists system categories; AI Accountant → download a month package
   and open its README (label, "Filed: NO").
5. Watch for 30 minutes: 5xx rate, `[password-auth] forgot failed` / `resend failed` log lines (hosted SMTP), 503
   `profit_loss_unavailable`.

## 6. Rollback

| Situation | Action |
|---|---|
| Client regression only | Redeploy the previous client build (build-time flags); backend unchanged. |
| Backend defect, schema healthy | Roll forward with a fix. Previous signed-off build of the SAME schema generation only; never `dd9b569`/pre-V2 (runbook 9.1). |
| P&L group overlay misbehaves | Leave data; deploy a backend that ignores the overlay, or run `20261024120000_…_down.sql` (drops only the overlay table; operations of system categories return to Needs review). |
| Operation classification misbehaves | Leave data; run `20261024150000_…_down.sql` (drops only the marks table; every operation, amount and balance is untouched and P&L returns to category-based treatment) |
| BPJS split misbehaves | `20261024090000_…_down.sql` restores the compat function; stored split rows remain valid deductions. |
| Proven data corruption | Runbook 9.3 state D (restore into a NEW database, reconcile writes since the backup). Never `pg_restore --clean` into the live database. |

Down files are for rehearsal or an approved incident decision; each is its own reviewed step.

## 7. Known limitations shipped with this candidate (not blockers, documented)

- P&L and accountant package are cash-basis estimates; no general ledger, trial balance or balance sheet yet.
- The accountant package is for review, not a Coretax import file; Coretax XML (BPMP/BP21/BPPU/e-Faktur) needs NIK/NPWP,
  NITKU, PTKP and object codes CFO AI does not hold.
- Paying a bill creates an operation without a category until the person sets one (shows under Needs review).
- The tax calendar does not read tax payments: a PPh 21 deposit does not clear its "Overdue" event.
- Loan repayments linked in the funding register stay "Needs review" in the P&L (principal/interest split not verified).
