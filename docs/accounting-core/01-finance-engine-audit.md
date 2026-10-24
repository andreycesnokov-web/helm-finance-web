# 01 — Finance Engine audit (baseline `64746eb`)

**Finding:** CFO AI has a reliable **single-entry cash subledger** with good write discipline, and a set of
operational registers around it (bills, payroll runs, funding, assets, tax treatments). It has **no double-entry
journal, chart of accounts, general ledger, trial balance, balance sheet or accounting period** in any branch.
Reports are computed from cash rows by several independent formulas that do not all agree.

Production scale today (aggregate counts, 24 Oct): 2 companies, 17 operations (income/expense only), 2 IDR
accounts, 3 bills, 1 funding record, 0 payroll runs, 0 assets, 0 tax treatments, 0 withholding records,
0 category→P&L-group confirmations. The beta (26 Oct – 1 Nov) will add real volume; a ledger designed now has
little history to backfill.

## 1. Write path (unchanged since the 22 Oct audit, re-verified)

All business money rows go through PostgreSQL functions that take `fn_ledger_writer_lock()` (global
`pg_advisory_xact_lock(7070,1)`), check the actor (`fn_balance_actor`), write a receipt in
`financial_write_requests` where keyed, and leave the balance to be derived. Triggers on `transactions`:
`ledger_writer_gate` (writes outside a writer are refused), `business_balance_guard` (no manual outflow below zero),
`bank_import_provenance_guard`, `import_pair_constraint`, `payroll_bank_evidence_guard`,
`active_business_wallet_write`. `audit_events`, `document_audit` and `access_audit` are append-only (triggers).

Balance formula (authoritative): `fn_ledger_signed(type, native, idr)` = income +, expense/payroll −,
correction signed, any other type 0; `fn_wallet_ledger_balance(wallet)` sums it over rows whose `wallet_id` is the
wallet **or** (legacy) whose `wallet_id IS NULL AND source = wallet.name`.

## 2. Source-of-truth map

| Source | Table(s) | API | Service / DB function | Source of truth | Lifecycle | Link to cash | Audit | Reconciliation | Tests |
|---|---|---|---|---|---|---|---|---|---|
| Business transactions | `transactions` | `POST /api/transactions/batch` (index.js:8626), `PATCH /api/transactions/:id` (8325), `PUT …/classification` (8588) | `rpc_insert_business_transactions_once`, `rpc_patch_business_transaction` | the row itself (cash subledger) | insert with request key → **edit in place** (version check); statement/transfer/debt-payment/payroll/opening rows immutable | is the cash | insert receipt; **edit: no `audit_events`**; classification: audited | statement vs ledger (`rpc_wallet_reconciliation`) | postgresBusinessBalance, financialWriterContracts, postgresFinancialWriterRaces, transactionClass |
| Bank and cash accounts | `wallets` | `GET/POST /api/wallets` (10390), `PUT /api/wallets/:id` | `rpc_create_business_wallet`, `rpc_update_business_wallet`, `fn_wallet_metadata_guard` | wallet row; balance **derived**, never stored | create (+ opening row) → metadata edits → deactivate | — | receipts | per-wallet statement reconciliation | walletLedger, postgresBusinessBalance |
| Opening balances | `transactions` (`is_opening_balance`, `source='opening_reanchor'`) | wallet create, `POST /api/wallets/:id/adjust-balance` (10614), `…/reanchor-opening` (openingAnchor.js) | `rpc_reanchor_wallet_opening`, `rpc_adjust_business_wallet`, `cfo_wallet_anchor_state` | dated anchor (D4) | anchor → re-anchor with reversal row | is cash | receipts | anchor vs statement | d4AnchorMigration, d4DatedOpeningAnchorHttp, d4AnchorConsumers |
| Bank statement import | `bank_import_batches/rows/matches`, `bank_import_confirm_requests`, `bank_reconciliations` | `/api/bank-import*`, `POST /api/bank-imports/:batchId/confirm` (6846) | `rpc_confirm_bank_import_reviewed` (review hash, request key, overlap + anchor guards) | statement row → `transactions.bank_import_row_id` (unique) or link to an existing row | upload → review → confirm (create / link / exclude) | only "create" decisions move cash | receipts + immutable confirm requests | `rpc_wallet_reconciliation` | postgresBankImportAtomicConfirm, postgresBankReconciliationFlow, importConfirmOperation |
| Internal transfers | `transactions` ×2 with `transfer_id` | `POST /api/wallets/transfer` (10715) | `rpc_execute_wallet_transfer_guarded` / `_recovery` | the pair | atomic pair; unique `(business_id, transfer_id, type)` | both legs are cash | receipts | — | walletTransfersTask30 |
| Invoices, AR/AP | `debts` (`type` receivable/payable), `bill_creation_requests`, `debt_settlement_allocations` | `POST /api/debts` (1525), `PATCH /api/debts/:id`, `…/approve` (1851), `…/pay` (12039), `…/withholding` (1947) | `rpc_create_business_bill`, `rpc_update_business_bill`, `rpc_record_debt_payment_guarded` | `debts` row (obligation); `paid_amount` **counter** + payment rows (`transactions.debt_payment_id`) | draft/pending → approved → partial/paid; legacy `settle` route refuses (409) | payment creates a cash row | bill receipts; approve route plain update | remaining = amount − paid − withholding allocations (`debtWithholding.js`); **no DB check** that `paid_amount` = Σ payments | debtPaymentIdempotency/Reliability/Concurrency, invoiceSettlement, withholdingSettlement |
| Loans, owner capital | `business_funding_records` (`source_kind`, `instrument`), `business_funding_repayments` | `POST /api/business-funding` (9194), repayments, paid | JS route, **two plain inserts** (record, then schedule) | register row; cash comes from a separate transaction linked by `received_transaction_id` / `paid_transaction_id` | record → schedule → mark paid | link only | paid mark audited | none | businessFunding, fundingHttpE2E, fundingLocalSupabase |
| Owner withdrawals / personal use | `transaction_classifications` (`business_purpose = personal`) | `PUT /api/transactions/:id/classification` | `server/lib/transactionClassifications.js` | the mark on the original row | set / change (clears review) | none (mark only) | audited (mandatory) | register 11 | transactionClassifications, postgresTransactionClassifications |
| Payroll and BPJS | `payroll_runs`, `payroll_payments` (gross, deduction, net, employer_bpjs), `payroll_payment_items`, `payroll_employees` | `POST /api/payroll/runs/action` (payrollRuns.js:65); legacy `POST /api/payroll/payments` refuses (409) | `rpc_payroll_run_action` (keyed, audited) | run → payments; cash = an **existing bank debit** linked to the payment | draft → approved → scheduled → paid (bank link) | link to statement row, never a new cash row | audited | `payroll_bank_evidence_guard` | payrollRunsSql, postgresPayrollRunRaces, postgresPayrollBpjsBreakdown, payrollProductionCompat |
| Tax obligations and payments | `tax_profiles`, `tax_rules` (3 active deadline rules, parameters not defined, unverified), `tax_treatments`, `withholding_records`, `withholding_payment_allocations`, `tax_billing_allocations`, `tax_deposit_*`, `compliance_events` | `/api/accountant/*`, `/api/debts/:id/withholding`, `/api/documents/:id/tax-obligation`, `/api/tax-split/*` | `taxSplit.js` (suggestions, under review), `taxDocMath.js`, `taxDeadlines.js` | treatments per document; tax **payments are ordinary expense rows** | suggested → reviewed | **no link** from a tax payment row to its obligation | treatment review fields | none | taxSplit, taxDocMath, taxDeadlines, taxGate, debtWithholding |
| Fixed assets | `assets` (cost, `useful_life_months`, `depreciation_rule_id`, purchase links) | `GET/POST /api/assets` (9119), dispose | `assetRegister.js` | register row | create → dispose | link to purchase tx / bill | — | none | assetRegister, assetRoutesWiring |
| Currency | `transactions.booked_rate/rate_source/fx_quote_id/rate_effective_date` (no quote table) | — | `fxProvider.js` (JISDOR, ExchangeRate-API, CoinGecko, mock) | booked rate on the row; reports value at **today's** rate | — | — | — | none | multicurrencyFx (known failing), liveFxProvider, coldStartUnvaluedFx, pulseRatesContract |
| Documents, approvals | `financial_documents`, `document_*_links`, `document_audit` | `/api/documents/*` | `rpc_document_*`, `rpc_operation_documents_snapshot` | document + link | upload → intake → review → link | none (evidence) | append-only | operation-document status | documentIntake*, pickerDocumentLinksSql |
| Payment gateways | `incoming_payments` (gross/fee/tax/net), candidates | `/api/incoming-payments/*` (4439) | `incomingPayments.js`, matching | provider record | import → match → reconcile | link to a cash row | — | candidate matching | incomingPayments*, gatewaySettlementImport |
| Intercompany | `business_relationships`, `intercompany_funding_records`, `intercompany_settlement_allocations` | — | guards `fn_ic_*` | records | — | links | — | none | — |

## 3. Calculations

| Metric | Where computed | Definition | Notes |
|---|---|---|---|
| Account balance | SQL `fn_wallet_ledger_balance` / `cfo_wallet_ledger` | Σ `fn_ledger_signed` | authoritative; used by guards and reconciliation |
| Account balance (copies) | `walletLedger.ledgerBalance` (index.js:10269), `/api/pulse` inline (1148–1227), `buildAiCfoContext` (12494), `buildBusinessFinancialSnapshot` (12784), `aiAccountantCore.buildAccountantCompanyFacts` | JS `Number` re-implementations | see I-2 |
| Total cash | `/api/pulse`, AI CFO, decision snapshot | Σ wallet balances valued at **today's** FX quote | Pulse also adds rows with no wallet and an unknown source; AI CFO does not |
| Management P&L (Performance → Profit) | `server/lib/profitLoss.js` via `GET /api/pulse/profit-loss` | exact 18-decimal cash contributions by confirmed `pnl_group`; purpose marks applied; Net Profit null | the only exact-decimal P&L |
| Month figures, Performance → Cash, AI CFO, Advanced Insights | `financialInsights.classifyTransaction` + series | keyword classes with evidence (funding register, purpose, confirmed group) | `Number`; client mirror `cashClass.js` |
| Burn, runway | `burnRunway.computeBurnAndRunway` | operating outflow per day over a window; runway = cash ÷ net burn | same function for Pulse, AI CFO, decisions; cash input differs per caller |
| Radar 30/60/90 | `client/src/v2/lib/radarSeries.js` | expected / best / worst over dated items (debts, funding repayments, payroll schedule, calculated taxes) minus burn | client-side |
| Working capital | — | not computed | missing |
| Receivables / payables | `debtWithholding.js`, `/api/pulse` | remaining = amount − paid − withholding allocations | pending approvals excluded |
| Funding | `businessFunding.summarize` | principal never revenue; interest by due month | register-based |
| Payroll liability | `payrollSchedule.js` | unpaid net pay per date | no liability balance; employer BPJS stored per payment |
| PPN / PPh | `tax_treatments`, `taxSplit.js`, `taxDocMath.js` | per document; rates from an under-review KB | no input/output VAT ledger |
| FX difference | — | not computed | missing |

## 4. Duplicated calculations

1. **Cash balance: seven implementations.** One SQL formula and six JS copies. They differ in arithmetic (SQL numeric
   vs JS `Number`), scope (Pulse adds unlinked rows; AI CFO does not) and **type list**: `aiAccountantCore` counts
   `topup/funding/refund` in and `withdrawal/fee` out, which the SQL formula ignores. `transactions.type` has no CHECK
   constraint, so such a row would make AI Accountant's balance differ from every other screen.
2. **P&L: three definitions.** `profitLoss.js` (exact, cash, confirmed groups) for Performance → Profit;
   `classifyTransaction` series for Pulse months, Performance → Cash and AI CFO; `client/src/v2/lib/pnl.js`
   (accrual at bill issue) whose calculation is no longer rendered (only `GROUPS` is imported). The same month can
   show different revenue on the Profit and Cash tabs.
3. **Classifier: two copies** (`financialInsights.js`, client `cashClass.js`), kept equal by a test.

## 5. Critical inconsistencies (verified on `64746eb`)

| # | Finding | Evidence | Impact |
|---|---|---|---|
| I-1 | A bank transfer description overrides a confirmed revenue category | `classifyTransaction` checks the transfer/opening/correction keywords (financialInsights.js:140–145) before the confirmed group (156). Run: income, confirmed group `revenue`, "TRANSFER OR VIA IB PT KLIEN ABADI INV-091" → `transfer`. The PPN keyword case is fixed. | Pulse revenue, burn, AI CFO understate revenue for the most common Indonesian bank wording |
| I-2 | Seven balance formulas, one with a different type list | §4.1 | latent: today prod has only income/expense rows |
| I-3 | Three P&L definitions | §4.2 | screens can disagree |
| I-4 | Revenue only at payment; an approved invoice creates no revenue; a manual income for the same sale is not blocked | `rpc_record_debt_payment`, profitLoss.js | double revenue possible; no accrual view |
| I-5 | Transaction edits leave no audit | `PATCH /api/transactions/:id` and `rpc_patch_business_transaction` write no `audit_events` | amount/date changes untraceable |
| I-6 | Funding record and schedule are two inserts | index.js:9194 | partial writes on failure |
| I-7 | Hard-delete reset, executable by `anon` | `rpc_reset_business_financial` (SECURITY INVOKER) has EXECUTE for anon/authenticated on prod; `anon` also holds table grants incl. DELETE on 84/105 tables | only RLS (enabled, **0 policies** = deny all) stops it; defence in depth missing |
| I-8 | Tax payments not linked to obligations; tax rules unverified | 3 active `tax_rules`, parameters not defined | no tax liability balance possible yet |
| I-9 | Depreciation never computed | needs a verified `depreciation` rule; none exists | P&L and asset values without depreciation |
| I-10 | No FX history | `fx_quote_id` has no table; balances valued at today's quote | no realised/unrealised FX; past reports move with today's rate |
| I-11 | Weak referential integrity on `transactions` | no FK on `wallet_id` or `cashflow_category_id`; no CHECK on `type`; legacy wallet match by name | a journal cannot rely on these columns without guards |
| I-12 | `debts.paid_amount` is an unchecked counter | no constraint vs payment rows | AR/AP may drift from cash |

## 6. What is solid and should be reused

The writer protocol (lock, actor check, receipts, version checks, recovery RPCs), the D4 opening anchors, the reviewed
bank-import confirm, the keyed payroll run with bank-evidence linking, atomic debt payments with idempotency and
FOR UPDATE, append-only audit tables, the exact-decimal helpers (`transactionClass.js`), `profitLoss.js`, the
category → `pnl_group` mapping and `transaction_classifications` (purpose + reviewer role), versioned `tax_rules`.
