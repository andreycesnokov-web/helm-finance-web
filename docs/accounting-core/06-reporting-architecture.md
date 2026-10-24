# 06 — Accounting reporting architecture (proposal)

**Principle:** accounting reports read only **posted** journal lines, in SQL `numeric`, through read-only RPCs with
the existing finance-read roles. Management screens (Pulse, Radar, Performance cash P&L, AI CFO) keep their current
sources and never switch silently; an accounting report is a separate, labelled view.

All reports take `(business_id, period range, basis = 'posted')`, return exact decimal strings, and carry:
framework (`sak_ep` … or "not confirmed"), functional currency, period status (open/closed), snapshot hash for closed
periods, and coverage warnings (suspense balance, unposted outbox items, unreconciled accounts).

## 1. General ledger
`rpc_gl_ledger(business, account?, from, to)` → per account: opening balance (Σ posted lines before `from`), each
line (date, entry no, kind, memo, debit, credit, running balance, source link, document link), period debit/credit
totals, closing balance. Drill-down: line → entry → source row (transaction / bill / payroll run / asset) → document.

## 2. Trial balance
`rpc_gl_trial_balance(business, from, to)` → per account: opening Dr/Cr, period Dr/Cr, closing Dr/Cr.
Checks returned with the report: Σ opening Dr = Σ opening Cr; Σ period Dr = Σ period Cr; Σ closing Dr = Σ closing Cr;
suspense = 0 (warning otherwise); `opening_equity` = 0 after the first close.

## 3. Balance sheet
`rpc_gl_balance_sheet(business, as_of)` → assets (current / non-current), liabilities (current / non-current),
equity. **Current-period profit** = Σ revenue + other income − cost of sales − operating − other expense − income
tax for the fiscal year to date, shown as "current-year profit" (3-2100) — never posted; at year-end close it is
transferred to retained earnings by a `closing` entry. Check: assets = liabilities + equity to the cent, returned
as `balanced: true|false` with the difference.

## 4. Accounting profit and loss
`rpc_gl_profit_loss(business, from, to, compare?)` → revenue, cost of sales, gross profit, operating expenses,
operating profit, other income/expense, profit before tax, income tax, net profit; by month for a range.
Recognition is whatever was posted (accrual rules of 05). The existing cash P&L (`/api/pulse/profit-loss`) stays the
**management** view; the two are shown side by side with a reconciliation line set (§7) rather than merged.

## 5. Statement of cash flows
Direct method from bank/cash account lines (no second source of cash):
each posted line on a `control_kind = bank` account is classified by the **other side** of its entry —
revenue/AR/customer advances → operating receipts; expense/AP/payroll/taxes → operating payments; fixed assets →
investing; loans/equity/dividends → financing; bank ↔ bank (transfers) → excluded. When an entry has several
non-cash lines in different categories, its cash line is split across them in proportion to their amounts (exact
decimals, remainder to the largest line), so the statement still sums to the cash movement. Opening cash + net flows = closing
cash, and closing cash = Σ `fn_wallet_ledger_balance` for the same date (P10). An indirect-method view (profit → cash
via working-capital changes) is a later addition computed from the same trial balance.

## 6. Working capital and aging
From control accounts: AR, AP, customer/supplier advances, accrued expenses, tax payables; aging of AR/AP by the
subledger references (`debt_id`, due date). This replaces nothing today (working capital is not computed anywhere).

## 7. Reconciliation reports

| Report | Compares | Pass rule |
|---|---|---|
| Cash vs GL | each bank/cash GL account vs `fn_wallet_ledger_balance(wallet)` | equal to the cent (txn currency for foreign wallets) |
| Bank statement vs transactions | existing `rpc_wallet_reconciliation` (statement balance vs ledger) | unchanged existing rule |
| AR / AP subledger vs control | Σ open `debts` remaining by type vs 1-1300 / 2-1100 balance; plus `debts.paid_amount` = Σ payment rows | equal; differences listed per bill |
| Payroll | 2-1400/2-1410/2-1420/2-1530 balances vs approved runs not yet paid / remitted; every paid payment has a bank-evidence link | equal |
| Tax | 2-15xx and 1-16xx balances vs `tax_treatments`, `withholding_records`, deposits and linked tax payments | equal; unlinked tax payments listed |
| Fixed assets | 1-21xx…1-27xx and accumulated depreciation vs `assets` register (cost, disposals, depreciation to date) | equal |
| Management vs accounting P&L | cash P&L (management) vs accrual P&L for the same period | explained by: AR/AP movement, accruals, depreciation, capex, VAT, personal marks, suspense |
| Outbox completeness | events with a cash or register change vs posted entries | 0 unposted older than the poster interval |

## 8. Period close checklist (feeds `rpc_gl_period_action('close')`)

Reuses the AI Accountant month-close checklist and adds hard gates: trial balance balanced; suspense = 0; cash vs
GL reconciled for every account; AR/AP subledger = control; payroll and tax reconciliations pass or each difference
has an accountant note; outbox empty for the period; depreciation and revaluation entries posted; no draft or
pending entries dated in the period. Close freezes a trial-balance snapshot (JSON + SHA-256) in
`gl_period_snapshots`.

## 9. What stays as it is
Pulse cash, burn, runway, Radar 30/60/90, Performance cash P&L, AI CFO, the accountant package and its registers.
They gain an optional link "see accounting view" once the GL is validated; they are not re-based on the journal
without a separate owner decision (ADR-AC-003).
