# Transaction Picker V2 + Payroll V2 â€” local review candidate

Business workspace only. No deployment, push, merge, production writes, OCR branch edits, paid AI calls or staging mutations.

## Existing / working / broken / missing / fix

| Area | Reused | Result / evidence | Remaining gate |
|---|---|---|---|
| Picker | Recovered `90ab5e6` working diff; existing DocumentDrawer | Search amount, explicit counterparty, ISO date, description/reference; date/account/direction/unmatched filters; score only recorded evidence | Real authenticated API acceptance |
| Large ledgers | Existing `/transactions` array contract | Opt-in 500-row cursor pages, strict progress/order checks, bounded batches and explicit partial status; 1205-row browser fixture | Native HTTP pagination/scoping checks |
| Link status | Existing document links | Optional per-page read pages past 1000 links; failed reads stay unknown; 200-document list no longer proves absence | Real PostgREST metadata check |
| Linking | Existing link/unlink RPC and document audit | Link/readback/unique duplicate/unlink/cross-company/audit failure/unchanged ledger verified with full-schema embedded SQL | JWT/RBAC/Storage and concurrent requests |
| Picker callers | Documents; bills/AP/AR deep-link to their document; operation folders start from an already selected transaction | One reusable component; Payroll consumes it too. No independent replacement matcher | Real end-to-end flows |
| Employees | Existing V2 form and payroll_employees | Atomic scoped create/update/archive + audit; current membership and account/currency checks; optional stale timestamp; rapid-click guard | Native role/concurrency checks |
| Monthly payroll | Existing F2 layout and payment/items tables | One atomic run; manual accountant-entered PPh21 including zero; earnings/bonus/employee deductions; employer BPJS stored separately | Authorized real API/database run |
| Payroll lifecycle | Existing draft/scheduled/paid/cancelled vocabulary | Draft editing with version; approval metadata + pending payment; actual bank debit link; cancellation only while unpaid | Native approval/link races |
| Payroll cash | Existing bank ledger and import evidence | Saving/approval create **zero** bank transactions. Link changes payroll only. Old POST `/payroll/payments` refuses with 409 | Recheck retained callers in real app |
| Recovery | Existing financial_write_requests and client financial intents | Stable actor/company/key; mismatch refusal; commit-loss recovery reads original audited result; role downgrade blocks early receipt replay | Native commit-loss + real session renewal |
| Mobile/accessibility | Existing design tokens, Modal and picker keyboard behavior | Desktop/mobile UI fixtures; mobile employee cards; searchable buttons; explicit comparison before link; loading/error/empty | Real owner journey remains unverified |
| Tax | Existing PPh21 obligation reader | Draft/cancelled entries are not paid withholding; no guessed TER rate or new tax engine | PTKP/NIK/NPWP/BPJS profiles and regulatory automation remain outside this change |
| Graphify | Existing installed plugin + official hosted MCP | Plugin 1.0.2 enabled, `graphify` URL registered | OAuth/session tools unavailable; **0 Graphify analysis calls** |

## Data paths and impact

- Documents â†’ DocumentDrawer â†’ TransactionPicker/model â†’ existing `linkDocument` action â†’ authenticated Documents route â†’ `rpc_document_link` â†’ document_transaction_links + document_audit. Unlink uses the retained inverse route/RPC. No accounting writer is invoked by selection/linking.
- Bills/vendor/customer/AP/AR evidence â†’ existing document deep link â†’ same drawer/picker. Bank import preserves its review/confirm mechanism; operation-folder/reconciliation flows already know the transaction and select a supporting document instead.
- Payroll â†’ existing EmployeeDialog / replacement F2 PayrollRunDialog â†’ savePayrollRun â†’ existing apiFetch financial-intent manager â†’ `/payroll/runs/action` â†’ `rpc_payroll_run_action` â†’ payroll_runs + existing payroll_payments/items + audit_events + existing financial_write_requests, atomically.
- PayrollRunHistory â†’ same picker â†’ explicit amount/account/currency comparison â†’ action `link` â†’ confirmed imported/matched bank debit. No INSERT/UPDATE to ledger amounts or balances. Already allocated debit, mismatched company/account/currency/net, debt payment and transfer are refused.
- Employee CRUD keeps the existing URLs but now delegates to `rpc_payroll_employee_action`; no unaudited fallback. Existing manager-role policy is retained (owner/ceo/admin/cfo). Accountant-supplied tax input is not accountant approval.
- Existing commercial payroll feature admission is reused through its `/payroll/.+` rule. Billing/pricing files and flags are untouched; accrual/link actions do not consume newly fabricated bank transactions.
- OCR overlap: `server/index.js` is also changed by the separately retained OCR branch. This candidate changes payroll routes, installation and opt-in transaction reads; it does not edit OCR/extraction modules or merge OCR. Integration must review these hunks explicitly. Old settlement-allocation document-link side effects are an existing separate flow, not rewritten here.

## Validation boundaries

Final targeted command is recorded in `TEST_COMMANDS.md`. Node test totals include legacy scripts as single test files; Documents/Bills also report 76 internal checks, V2 guards 16, Document access 16. Embedded PostgreSQL executes the real full-schema SQL, constraints and RPC bodies, but is single-session: it is **not** native race, PostgREST, GoTrue, Storage or production RLS proof. Browser fixtures use the actual built V2 frontend with synthetic routed APIs and are UI evidence only.

Native independent-session tests are prepared in `tests/integration/postgresPayrollRunRaces.test.js`. They refuse a missing/nonlocal/shared database and have no embedded fallback. They have not passed here: Windows loopback TCP times out, including Chromeâ†’local fixture server and pg_isreadyâ†’the retained local PG17 cluster. Its identifier was `7695158167404558200`, different from the protected production/Kamatera identifiers. No database migration was applied to that cluster.

## Migration, release and rollback

Only new migration: `migrations/20261020163121_payroll_runs_no_cash.sql`, timestamp generated by the installed Supabase CLI. It reuses the writer gate and receipt ledger; adds payroll_runs and the minimal run/employer/tax-source fields; service-role-only invoker RPCs; audit, version/duplicate checks and paid-evidence protection. Applicability refuses an existing run table or an evolved receipt-operation constraint instead of replacing it silently. Already committed migrations are not reapplied.

**NO-GO for production/staging promotion.** Before any application: confirm exact target schema and migration history, review grants/callers with OCR owner, create and verify a fresh backup, execute on a new disposable synthetic target, then run native SQL races and real API/Auth/Storage/browser acceptance. Existing nonempty Kamatera and production are not disposable test targets. See `LOCAL_INTEGRATION_GATE.md`.

Rollback preparation: keep pre-migration backup and exact application artifact; stop payroll writes first. Do not restore the old cash-creating payroll endpoint during an application rollback. Retain its fail-closed refusal until a reviewed alternative is ready. Additive tables/receipts remain for audit; no destructive down migration, receipt deletion, historical reclassification, or restore into a shared existing database is authorized. A restore would require its own reviewed target plan.

Known limitations: prototype supports new IDR runs with whole rupiah amounts, up to 500 selected employees; run history shows the latest 100 with a visible limit. It does not send bank transfers, calculate unverified tax, invent missing employee tax profiles, split one bank debit across employees, amend paid salary or auto-confirm document matches. Legacy manual payout callers now receive a clear 409 and must use the V2 accrual/reconciliation workflow.
