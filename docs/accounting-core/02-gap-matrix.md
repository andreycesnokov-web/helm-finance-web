# 02 — Accounting Core gap matrix (baseline `64746eb`)

Classification: **EXISTING** (usable as is) · **REUSE** (an existing part becomes a building block) · **MODIFY**
(exists, must change) · **MISSING** (nothing to build on).
Maturity of what exists: UI only · partial backend · full backend · tested · production verified.
"Production verified" means it ran on app.cfo-ai.site with real rows; with 17 operations on prod, almost nothing
financial is production-verified at scale.

| # | Capability | Class | What exists (code / DB / tests) | Maturity | Gap |
|---|---|---|---|---|---|
| 1 | Chart of accounts | MISSING · REUSE | `cashflow_categories` (+ `pnl_group`), `business_category_pnl_groups`, `industry_templates`, `defaultCategories.js` | categories: tested | no accounts, codes, types, normal balance, hierarchy, control accounts |
| 2 | Journal entry header | MISSING | — | — | everything |
| 3 | Journal entry lines | MISSING | — | — | everything |
| 4 | Debit/credit validation | MISSING | — | — | balance check, ≥2 lines, one side per line |
| 5 | Posting engine | MISSING · REUSE | writer lock `fn_ledger_writer_lock`, receipts `financial_write_requests`, actor check `fn_balance_actor`, exact decimals `transactionClass.js` | full backend, tested (postgresFinancialWriterRaces) | rules event → lines; posting RPC |
| 6 | Draft / pending / posted states | MISSING · REUSE | approval states on `debts`, `payroll_runs` (draft → approved → paid) | tested | journal status machine |
| 7 | Reversal entries | MISSING · MODIFY | `correction` type, in-place `rpc_patch_business_transaction`, D4 reversal rows for re-anchors | tested | posted = immutable, correction = reversing entry |
| 8 | General ledger | MISSING | — | — | account postings with opening/closing |
| 9 | Trial balance | MISSING | — | — | — |
| 10 | Balance sheet | MISSING (UI only for a management view) | `Assets.jsx` "management balance" from cash, debts, taxes, asset register | UI + partial backend | no equity, no A = L + E check, not from a ledger |
| 11 | Accounting P&L | MODIFY | `profitLoss.js` (cash, exact, confirmed groups, purpose marks; Net Profit null) | full backend, tested (profitLoss*, postgresPnlSystemMapping) | accrual recognition from the GL; keep the cash P&L as the management view |
| 12 | Cash flow statement | MODIFY | Pulse in/out and classifier classes (operating / financing / capex / tax) | partial backend | statement tied to cash accounts, no double counting |
| 13 | Accounting periods | MISSING | client month picker (`accounting.js`) | UI only | period table and states |
| 14 | Period close / reopen | MISSING · REUSE | `closeReadiness` checklist (`is_closed` always false) | UI only | DB lock, snapshot, audited reopen |
| 15 | Accruals, prepayments | MISSING | `pnl.js` accrual at bill issue (not rendered) | dead code | adjusting entries, schedules |
| 16 | Fixed assets, depreciation | MODIFY | `assets`, `assetRegister.js` (straight line from a verified rule only) | partial backend, tested; never produces depreciation (no verified rule) | accounting policy per company (separate from tax groups), depreciation entries |
| 17 | Multi-currency, FX revaluation | MODIFY · MISSING | `booked_rate`, `rate_source`, `fxProvider.js` (JISDOR etc.) | partial backend; multicurrencyFx test failing | rate snapshots table, functional/reporting currency, realised and unrealised FX |
| 18 | Bank reconciliation | EXISTING · REUSE | `rpc_wallet_reconciliation`, `bank_reconciliations`, reviewed import confirm, D4 anchors | full backend, tested | GL bank account must equal the wallet ledger |
| 19 | AR/AP subledger reconciliation | MODIFY | `debts` remaining, `debt_settlement_allocations`, `invoiceSettlement.js` | full backend, tested | control accounts; `paid_amount` invariant |
| 20 | Tax and withholding accounting | MODIFY | `tax_treatments`, `withholding_records`, allocations, `tax_deposit_*` | partial backend, tested; 0 rows on prod; rules unverified | PPN in/out, PPh payable/prepaid accounts, payment ↔ obligation link |
| 21 | Accountant adjustments, approvals | MODIFY | `transaction_classifications` review with role, `debts.accountant_checked_*`, payroll approval | full backend, tested | manual journals with approval; adjusting-entry workflow |
| 22 | Immutable audit history | MODIFY | `audit_events` / `document_audit` / `access_audit` append-only; receipts | full backend, tested | edit route unaudited (I-5); reset hard-deletes (I-7); journal immutability |

## Supported vs unsupported today

Supported: cash per account, statement import and reconciliation, transfers, bills with partial payments and
withholding allocations, payroll runs linked to bank debits, funding register, asset register, management cash P&L,
burn/runway/Radar, purpose and accountant-review marks, document evidence.

Unsupported: anything that needs double entry — accrual P&L, balance sheet, trial balance, GL, period lock,
depreciation, FX gains/losses, VAT ledger, tax liability balances, adjusting entries.

## Reuse list (code that the Accounting Core should call, not copy)

`fn_ledger_writer_lock`, `fn_balance_actor`, `financial_write_requests`, `audit_events`, `transactionClass.js`
decimal helpers, `profitLoss.js` (management view and drill-down UI), `business_category_pnl_groups` +
`categoryGroups.js`, `transactionClassifications.js`, `debtWithholding.js`, `invoiceSettlement.js`,
`payrollRuns.js` / `rpc_payroll_run_action`, `openingAnchor.js`, `rpc_wallet_reconciliation`, `assetRegister.js`
(as the register), `fxProvider.js` (as a rate source), `tax_rules` versioning, `migrate-v2.mjs` runner and ledger,
rcAcceptance harness.
