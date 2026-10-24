# 09 — Testing strategy (proposal)

## 1. Invariants that must always hold (property tests over random event sequences)

| # | Invariant |
|---|---|
| T1 | every posted entry: Σ debit = Σ credit, ≥ 2 lines, one side per line |
| T2 | trial balance of every company and period nets to zero |
| T3 | for every wallet and date: GL bank balance = `fn_wallet_ledger_balance` (txn currency for foreign wallets) |
| T4 | AR / AP control = Σ open bill remaining; `debts.paid_amount` = Σ payment rows |
| T5 | each source event version has exactly one non-void entry; replays never add one |
| T6 | posted entries and lines cannot be updated or deleted by any role, including service_role |
| T7 | no entry exists in a closed period except the close's own entries |
| T8 | assets = liabilities + equity (with current-year profit) at every date |
| T9 | cash-flow statement closing cash = Σ wallet balances |
| T10 | no money arithmetic in floating point (static check on accounting modules) |
| T11 | Pulse, Radar, burn/runway and the cash P&L return byte-identical results with the ledger on or off |

## 2. Scenario tests (golden, from 05)

Each worked scenario in 05 is a fixture with hand-computed expected lines and reports: cash revenue; credit sale,
partial payments with PPh 23; expense with and without faktur; supplier bill and payment; transfers (same day and in
transit); capital injection; owner personal purchase; loan and principal; interest accrual; asset and depreciation;
payroll accrual and payment; BPJS and PPh 21 remittance; PPN offset both directions; advances; foreign-currency
receipt; realised and unrealised FX; refunds; reversal and re-post on a source edit; accrued and prepaid expenses;
opening balance and its clearing; interest income with final tax; gateway settlement.

Required negative cases: unbalanced entry refused; zero or negative line refused; posting to a header, inactive or
other company's account refused; posting into a closed period refused; transfer produces no revenue/expense; owner
capital produces no revenue; loan principal produces no revenue/expense; tax payment without an obligation goes to
suspense, not expense; AI-created draft cannot be posted without a human approver.

## 3. Concurrency and idempotency (native PostgreSQL, like `postgresFinancialWriterRaces`)

Concurrent posting of the same event (one entry wins); concurrent manual posts with the same request key; close vs
post into the same period (serialised, posting refused after close); bill payment and statement import touching the
same bill; duplicate statement import (no second cash row, no second entry); backfill run twice (no-op); poster
crash mid-batch (resume without duplicates).

## 4. Security

Cross-tenant: every `/api/accounting/*` route and every `rpc_gl_*` with another company's ids → 403/404 and no rows.
Roles: manager/employee cannot create, approve, post, reverse, close or reopen. Grants: `anon` and `authenticated`
have no privilege on GL tables and functions (catalog test, also in the runner postflight). Audit: each action
leaves one `audit_events` row; failed audit → failed action.

## 5. Synthetic companies

| Company | Shape |
|---|---|
| A — services PKP, IDR | invoices with PPN and PPh 23, payroll with BPJS, one loan, laptop asset |
| B — non-PKP small (SAK EMKM candidate) | cash sales, expenses without documents, owner personal purchases |
| C — PT PMA with USD account | USD receipts, USD supplier, month-end revaluation, capital injection pending deed |
| D — two related companies | intercompany funding and settlement |
| E — messy history | edits after posting, reversed transfer, duplicate statement upload, unmapped categories, missing receipts |

All synthetic: no real names or data. They extend the rcAcceptance harness (`tests/integration/rcAcceptance`) and the
native runner DB; nothing runs against production.

## 6. Preservation of existing calculations

Before and after every Accounting Core migration, run the existing suites unchanged (profitLoss*, financialInsights,
v2CashClass, v2RadarSeries, v2PulseModel, payrollSchedule, postgresBusinessBalance, financialWriterContracts,
rcAcceptance) and a snapshot test: Pulse, Radar, Performance and AI CFO responses for the synthetic companies are
identical with `ACCOUNTING_CORE` off and on (T11).
