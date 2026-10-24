# 05 — Posting rules for real business events (worked examples)

Synthetic company: PT Contoh Solusi Digital, IDR functional currency, PKP, services. Amounts in IDR unless stated.

**Tax amounts below are illustrations, not rules.** PPN is shown as 12% × 11/12 of DPP (PMK 131/2024, non-luxury)
and PPh 23 as 2% of DPP for services. Neither applies automatically: the engine posts tax lines only from an
accountant-reviewed `tax_treatment` / `withholding_record` / payroll run, with the treatment's own amounts. Without a
reviewed treatment, a bill posts gross and the tax part waits in review.

Columns of the effects lines: **Mgmt P&L** = today's cash-basis management P&L (`profitLoss.js`, unchanged);
**Acct P&L** = accrual P&L from the journal; **BS** = balance sheet; **Cash** = actual cash
(`fn_wallet_ledger_balance`, unchanged).

---

### 1. Cash revenue
Event: service sold and paid at once to BCA. Source: `transactions` (income, category → 4-2000), or a receivable
bill + payment on the same day. Date: payment date = recognition date. Docs: invoice or receipt. Review: none
(system rule); missing document flagged.

| Dr | Cr | Amount |
|---|---|---|
| 1-1201 Bank BCA | 4-2000 Service revenue | 5,000,000 |

Mgmt P&L +5.0M revenue · Acct P&L +5.0M revenue · BS bank +5.0M, equity (current profit) +5.0M · Cash +5.0M.
If the company charged PPN, the reviewed treatment splits the credit into revenue and 2-1510 PPN output.

### 2. Credit sale — invoice issued, paid later
Event: receivable bill approved (`debts.type = receivable`, `approval_status = approved`) on invoice date 3 Oct.
Source: `debts` row + reviewed `tax_treatment`. Docs: commercial invoice, faktur pajak keluaran. Review: treatment
reviewed by accountant.

| Dr | Cr | Amount |
|---|---|---|
| 1-1300 Trade receivables | | 11,100,000 |
| | 4-2000 Service revenue | 10,000,000 |
| | 2-1510 PPN output | 1,100,000 |

Mgmt P&L 0 (nothing paid) · Acct P&L +10.0M revenue in October · BS AR +11.1M, PPN output +1.1M · Cash 0.

### 3. Customer partial payment (with PPh 23 withheld by the customer)
Event: 10 Oct customer pays 5,000,000 (`rpc_record_debt_payment`); 2 Nov pays 5,900,000 and sends bukti potong
PPh 23 200,000 (`withholding_record` allocated to the bill). Docs: bank statement, bukti potong.

| Date | Dr | Cr | Amount |
|---|---|---|---|
| 10 Oct | 1-1201 Bank BCA | 1-1300 AR | 5,000,000 |
| 2 Nov | 1-1201 Bank BCA | 1-1300 AR | 5,900,000 |
| 2 Nov | 1-1630 Prepaid PPh 23 | 1-1300 AR | 200,000 |

Mgmt P&L: revenue counted when paid (today's rule), so the cash P&L shows 5.0M in Oct and 5.9M in Nov · Acct P&L 0
(revenue was recognised at issue) · BS AR → 0, prepaid PPh 23 +0.2M · Cash +5.0M / +5.9M.
The withheld 200,000 is a tax prepayment, never a cost and never a revenue cut.

### 4. Operating expense paid immediately
Event: internet bill paid from BCA. Source: `transactions` (expense, category → 6-2200). Docs: invoice; faktur pajak
masukan if the supplier is PKP.

| Case | Dr | Cr | Amount |
|---|---|---|---|
| no valid faktur | 6-2200 Telecom | 1-1201 Bank | 1,110,000 |
| valid faktur, input VAT creditable (reviewed) | 6-2200 Telecom 1,000,000 · 1-1610 PPN input 110,000 | 1-1201 Bank | 1,110,000 |

Mgmt P&L −1.11M (the cash amount, by the category's group) · Acct P&L −1.0M with a creditable faktur, else −1.11M ·
Cash −1.11M. **Missing receipt:** the expense stays in both P&Ls; register 11 marks "possible fiscal correction —
accountant decides". A receipt never makes it deductible by itself.

### 5. Supplier invoice received, not yet paid
Event: payable bill for consulting approved 15 Oct. Source: `debts` (payable) + reviewed treatment with PPh 23
withholding. Docs: invoice, faktur pajak masukan; bukti potong issued by us later.

| Dr | Cr | Amount |
|---|---|---|
| 6-4000 Professional fees | | 20,000,000 |
| 1-1610 PPN input | | 2,200,000 |
| | 2-1100 Trade payables | 21,800,000 |
| | 2-1540 PPh 23 payable | 400,000 |

Mgmt P&L 0 until paid · Acct P&L −20.0M in October · BS AP +21.8M, PPh 23 payable +0.4M, PPN input +2.2M · Cash 0.

### 6. Supplier payment
Event: 30 Oct pay the vendor net (`rpc_record_debt_payment`). Docs: bank statement.

| Dr | Cr | Amount |
|---|---|---|
| 2-1100 Trade payables | 1-1201 Bank | 21,800,000 |

Mgmt P&L −21.8M (the cash paid, by the bill's category group; the management view does not split VAT) · Acct P&L 0 ·
BS AP → 0 ·
Cash −21.8M. The PPh 23 is paid to the state separately (scenario 15).

### 7. Transfer between company bank accounts
Event: `rpc_execute_wallet_transfer_guarded`, one `transfer_id`, two cash legs. One journal entry per transfer.

| Dr | Cr | Amount |
|---|---|---|
| 1-1202 Bank Mandiri | 1-1201 Bank BCA | 50,000,000 |
| 6-7000 Bank charges | 1-1201 Bank BCA | 6,500 (only if the fee is recorded) |

Mgmt P&L 0 (fee −6,500) · Acct P&L 0 (fee −6,500) · BS bank ↔ bank · Cash total unchanged (−fee).
Transfers on different days use 1-1290 cash in transit: Dr in-transit / Cr BCA, then Dr Mandiri / Cr in-transit.

### 8. Shareholder capital injection (PT PMA)
Event: funding register `source_kind = equity`, cash linked by `received_transaction_id`. Docs: deposit slip, then
the notarial deed and Ministry of Law approval for the capital change.

| Stage | Dr | Cr | Amount |
|---|---|---|---|
| money received | 1-1201 Bank | 3-1200 Capital contributions not yet issued | 1,000,000,000 |
| shares issued (accountant adjustment) | 3-1200 | 3-1000 Paid-in share capital | 1,000,000,000 |

Mgmt P&L 0 (financing, never revenue) · Acct P&L 0 · BS bank +1.0B, equity +1.0B · Cash +1.0B.

### 9. Owner personal purchase with company money
Event: expense row marked `business_purpose = personal` (`transaction_classifications`). Docs: receipt if any.
Review: accountant decides the final treatment.

| Dr | Cr | Amount |
|---|---|---|
| 1-1350 Due from shareholders | 1-1201 Bank | 3,000,000 |

Mgmt P&L: shown on the separate "personal" line, not an operating cost (today's rule) · Acct P&L 0 · BS receivable
from the shareholder +3.0M · Cash −3.0M. The accountant may reclassify to dividends or employee benefit; that is a
tax decision and is never automatic.

### 10. Loan received and principal repayment
Event: bank loan in the funding register (`instrument = bank_loan`), repayment schedule rows with principal and
interest. Docs: loan agreement, bank statement.

| Date | Dr | Cr | Amount |
|---|---|---|---|
| receipt | 1-1201 Bank | 2-2100 Long-term bank loans | 200,000,000 |
| repayment (principal part) | 2-2100 Long-term bank loans | 1-1201 Bank | 10,000,000 |
| period close | 2-2100 | 2-1610 Current portion | portion due in 12 months |

Mgmt P&L 0 · Acct P&L 0 · BS loan +200M / −10M · Cash +200M / −10M.

### 11. Interest payment
Event: same repayment row, interest part; accrued at month end when the bank debits later.

| Date | Dr | Cr | Amount |
|---|---|---|---|
| 31 Oct (accrual) | 8-1000 Interest expense | 2-1800 Interest payable | 1,500,000 |
| 5 Nov (payment) | 2-1800 Interest payable | 1-1201 Bank | 1,500,000 |

Mgmt P&L −1.5M in November (cash, below EBITDA) · Acct P&L −1.5M in October · Cash −1.5M in November.
A single bank debit with principal and interest is split by the schedule row; without one, the line goes to suspense.

### 12. Fixed asset purchase and monthly depreciation
Event: laptop bought (asset register row with purchase transaction or bill). Depreciation from the company's
**accounting policy** (here straight line, 48 months, no residual), separate from the tax depreciation groups.
Docs: invoice, faktur pajak masukan.

| Date | Dr | Cr | Amount |
|---|---|---|---|
| purchase | 1-2500 Office and IT equipment 24,000,000 · 1-1610 PPN input 2,640,000 | 1-1201 Bank | 26,640,000 |
| each month end | 6-6000 Depreciation | 1-2600 Accumulated depreciation | 500,000 |

Mgmt P&L: asset purchase excluded (capex) · Acct P&L −0.5M per month · BS asset +24.0M less accumulated
depreciation · Cash −26.64M at purchase. Today the register produces no depreciation (no verified rule, I-9); the
journal's depreciation needs a policy setting, not a tax rule.

### 13. Salary accrual and salary payment
Event: payroll run for October approved (`rpc_payroll_run_action`); employees paid 28 Oct by a bank debit linked to
the payments. Amounts from the run: gross 30,000,000, PPh 21 withheld 600,000, employee BPJS 600,000, employer BPJS
1,800,000, net pay 28,800,000.

| Date | Dr | Cr | Amount |
|---|---|---|---|
| run approved | 6-1000 Salaries 30,000,000 | 2-1400 Salaries payable 28,800,000 · 2-1530 PPh 21 payable 600,000 · 2-1410/2-1420 BPJS payable 600,000 | 30,000,000 |
| run approved | 6-1100 Employer BPJS | 2-1410/2-1420 BPJS payable | 1,800,000 |
| bank debit linked | 2-1400 Salaries payable | 1-1201 Bank | 28,800,000 |

Mgmt P&L −28.8M when paid (today's cash rule) · Acct P&L −31.8M in October · BS liabilities for PPh 21 and BPJS
until paid · Cash −28.8M.

### 14. BPJS and PPh 21 payments
Event: payments to BPJS and to the state (expense rows linked to the run's obligations). Deadlines come from the tax
calendar, not from the journal.

| Dr | Cr | Amount |
|---|---|---|
| 2-1410/2-1420 BPJS payable | 1-1201 Bank | 2,400,000 |
| 2-1530 PPh 21 payable | 1-1201 Bank | 600,000 |

Mgmt P&L −3.0M (cash) · Acct P&L 0 (already accrued) · BS liabilities → 0 · Cash −3.0M.
A tax payment without a linked obligation posts to suspense: tax payments are never guessed as expenses.

### 15. PPN input/output, PPh withholding and settlements
Month end (period close step, accountant-reviewed). October: PPN output 1,100,000; PPN input 2,200,000 + 110,000 +
2,640,000 = 4,950,000.

| Case | Dr | Cr | Amount |
|---|---|---|---|
| offset (input ≥ output) | 2-1510 PPN output | 1-1610 PPN input | 1,100,000 (remaining input 3,850,000 carried forward) |
| offset (output > input, other month) | 2-1510 PPN output | 1-1610 PPN input · 2-1520 PPN payable | output total |
| PPN payment | 2-1520 PPN payable | 1-1201 Bank | net payable |
| PPh 23 withheld from supplier, paid to the state | 2-1540 PPh 23 payable | 1-1201 Bank | 400,000 |
| PPh 25 instalment | 1-1640 Prepaid PPh 25 | 1-1201 Bank | per notice |

Mgmt P&L: tax payments shown in the "tax" group (cash) · Acct P&L 0 (VAT and withholding are balance-sheet items) ·
Cash −payments. Corporate income tax expense (9-1000) is an annual accountant adjustment.

---

## Additional cases

| Case | Entries | Notes |
|---|---|---|
| Customer advance | receipt: Dr Bank / Cr 2-1300 Customer advances; invoice: Dr 2-1300 / Cr AR (revenue and PPN on the invoice) | PPN on an advance follows the reviewed treatment (faktur for uang muka) |
| Supplier advance | payment: Dr 1-1510 Advances to suppliers / Cr Bank; bill: Dr expense / Cr 1-1510 (+ AP for any balance) | |
| Foreign-currency bank receipt | USD wallet receives USD 1,000 at 16,000: Dr Bank USD (txn USD 1,000; 16,000,000) / Cr 4-2000 16,000,000 | rate from the statement or BI for that date, frozen in `fx_rate_snapshots` |
| Realised FX difference | USD invoice booked at 16,000 (AR 16,000,000), paid at 16,250: Dr Bank USD 16,250,000 / Cr AR 16,000,000 / Cr 7-2000 250,000 | loss → Dr 7-2000 |
| Unrealised FX (close) | USD bank balance revalued at the closing rate: Dr/Cr Bank USD vs 7-2100; reversed on day 1 of next period | foreign AR/AP/loans the same way |
| Refund to a customer | Dr 4-9000 Sales returns (+ Dr PPN output per credit note) / Cr Bank | refunds reduce their original group in the management P&L (today's rule) |
| Refund from a supplier | Dr Bank / Cr the original expense (or AP) | |
| Correction of a wrong entry | reversal entry (mirror lines, `reversal_of`) + corrected entry, both in an open period | when a source row changes version, the engine reverses version n and posts version n+1 |
| Accrued expense | 31 Oct: Dr 6-2100 Utilities / Cr 2-1200 Accrued expenses; Nov bill: Dr 2-1200 / Cr AP | |
| Prepaid expense | Jan: Dr 1-1500 Prepaid / Cr Bank 12,000,000; monthly Dr 6-4100 / Cr 1-1500 1,000,000 | schedule entries are `adjustment` kind |
| Opening balance | wallet anchor: Dr Bank / Cr 3-9000 Opening balance equity; the accountant clears 3-9000 into capital, retained earnings, AR/AP openings | 3-9000 must be zero before the first close |
| Interest income with final tax | Dr Bank 80,000 · Dr 8-2000 Final tax 20,000 / Cr 7-1000 Interest income 100,000 | |
| Payment-gateway settlement | Dr Bank 9,710,000 · Dr 6-7100 Gateway fees 290,000 / Cr AR (or revenue) 10,000,000 | from `incoming_payments` gross/fee/net |
