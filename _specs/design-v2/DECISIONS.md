# Design v2: owner decisions

Decided by the owner (Andrew) on 3 Oct 2026, in reply to the batch 0–7 report (PRs #102–#108) and `PROPOSALS.md`.

## Open questions

1. **Money numerals:** keep the existing token treatment (JetBrains Mono, from `client/src/brand/tokens.css`). Do not switch to Manrope.
2. **Pending approval on Pulse:** items with `approval_status='pending_approval'` are **not** included in Pulse totals. Radar shows them with a "Waiting for approval" tag, as in the design.
3. **Approve and reject from v2 screens:** allowed, through the existing approve and reject endpoints only.
4. **Customer payment reminders:** no channel yet. The button stays "Coming soon" until P-06 is approved.
5. **`/api/accountant/calendar` writes on read:** keep not using it from v2. Fixing the write-on-read is a separate task. Do not change it inside v2 batches.
6. **Runway target:** default 60 days, configurable per business (P-01).

## Proposals

| Proposal | Decision |
|---|---|
| P-01 Per-business runway target | **Approved**: migration allowed. |
| P-08 Targets and alerts (minimum cash, weekly brief schedule) | **Approved**: migration allowed. The brief uses the existing notification policy. |
| P-04 Counterparty tax fields | **Approved**: migration allowed. Rule mapping stays in the verified rule engine. |
| P-05 Bill document checklist status | **Approved**: migration allowed. Writes need the role check and an audit row. |
| P-10 Category → group mapping, accrual profit | Next step. The owner first wants to see the industry template. Prepare the template for review; no migration yet. |
| P-11 Asset register | Next step, not yet. |
| P-03 Funding register | Next step, not yet. No link to Personal until the bridge is approved. |
| P-02, P-07, P-09, P-12 | Later. |
| P-06 Customer reminders, P-13 Support-access grants | Only after a security audit (MiMo). Not now. |

## Rules for the approved migrations

- Additive only: new nullable columns or new tables. No changes to existing columns. Do not touch migrations 037–043 or Reset/R001.
- One migration per proposal, numbered after the latest existing migration, with migration tests in `tests/migrations`.
- Every write path checks the role and writes an audit row, following the existing patterns.
- The UI keeps working when the column is null (the current default behaviour).
- Do not run anything against production. The owner applies migrations.

## P-10 decisions (3 Oct 2026, reply to the batch 8 report, PR #110)

These are the answers to Q1–Q7 in `_specs/design-v2/P10_TEMPLATE.md` (added in PR #110). P-10 is **approved for the next batch**: one additive migration, written only after #110 is merged.

### Groups: 9, not 7

`revenue`, `direct_cost`, `operating_cost`, `interest`, `other_income`, `tax`, `asset_purchase`, `funding`, `transfer`.

The P-10 migration puts a CHECK constraint on exactly these 9 values from the start.

| Group | Meaning | Place in profit |
|---|---|---|
| `revenue` | Sales to customers | Sales |
| `direct_cost` | Costs that grow with each job or sale | Before gross profit |
| `operating_cost` | Running the company | After gross profit, inside EBITDA |
| `interest` | **Only** interest on loans the company owes | Below EBITDA, matching `PERFORMANCE_METRICS.md` |
| `other_income` | Income that is not sales, including deposit and account interest | Below operating profit, labelled "Other income" |
| `tax` | The company's own tax only | Below profit before tax |
| `asset_purchase` | Items over the asset threshold (Q2) | Not in profit; only depreciation counts (P-11) |
| `funding` | Loans in and out (principal), owner money, dividends | Not in profit |
| `transfer` | Between own accounts, including cash withdrawals to the cash box | Never counted |

### Answers

- **Q1. Loan interest.** It gets its own category in the `interest` group. Interest is not `operating_cost`, because then it would fall inside EBITDA. Loan principal stays in `funding`. Until the loan register exists (P-03), repayments can stay in one record; the split into principal and interest comes with P-03.
- **Q2. Asset threshold.** One item over **Rp 5,000,000** that lasts more than a year is `asset_purchase`. Anything smaller is `operating_cost`. The accountant confirms the threshold. Оргтехника and Ремонт ОС follow the same rule. A repair that does not extend the asset's life is `operating_cost`.
- **Q3. Taxes.** The template's proposal is corrected:
  - **Tax we withhold from others is not our tax.** PPh 23 on services and PPh 4(2) on rent, withheld from suppliers and landlords, is part of the cost of that service or rent. It goes into the cost's own group (`direct_cost` or `operating_cost`). The cost is the gross amount, and the withheld part is a payable to the tax office. PPh 21 withheld from staff is part of the wage.
  - **Employer BPJS** goes in the same group as the wage it belongs to: `direct_cost` for field cleaners (see Q4), `operating_cost` for admin.
  - **Only the company's own tax is `tax`:** corporate income tax (PPh 25/29), or the UMKM final tax on turnover (see Turnover tax under UMKM below).
  - **PPN (VAT)** is not a cost if the company is a VAT payer (PKP). If it is not PKP, the VAT on supplier bills is part of the purchase cost.
- **Q4. Direct versus operating.** Agreed.
  - For cleaning contracts: transport, equipment rental and chemicals are `direct_cost`.
  - Field cleaners' wages, their payroll taxes and employer BPJS are also `direct_cost`. Otherwise contract margin is overstated.
  - For vending: site rent and the revenue share to the location owner are `direct_cost`.
- **Q5. Franchise entry fee.** It counts as `revenue` in the month of the invoice. Spreading it over the contract term waits for the accountant and a later rule.
- **Q6. Other income.** Прочие поступления and Прочие инвестиционные доходы go to `other_income`, not `revenue`. This keeps sales and gross margin from being inflated.
- **Q7. Selling an asset.** The sale price reduces `asset_purchase`. The accountant works out the gain or loss at close. This holds until the asset register (P-11) exists.

### Owner's clarifications

1. **PPh 23 withheld from us by a customer.**
   - When a customer pays our cleaning invoice minus PPh 23, the withheld part is **neither a cost nor a reduction of revenue**. Revenue stays at the full invoice amount.
   - The withheld amount is a **prepayment of our own income tax**. It is credited later against PPh 25/29 using the customer's bukti potong.
   - In the data it is **not a cash-flow category and not one of the 9 groups**. It is recorded as a `withholding_record` (migration 031) allocated to the invoice through `debt_settlement_allocations` (`settlement_source_type = 'withholding_record'`). The bukti potong link is `withholding_records.bukti_potong_document_id`. The direction comes from the invoice: `debts.type = 'receivable'` means withheld by the customer. No new migration is needed.
   - **An allocation alone does not change what Pulse and Radar show.** Today the remaining balance comes from `computeDebtStatus` in `server/index.js`: `original_amount − paid_amount`. It does not read `debt_settlement_allocations`, and the existing `/allocate` route is an audit trail only. The next batch must therefore add a server route that records the withholding and also makes the remaining balance 0.
   - **Owner's preferred option: change only how the remaining balance is calculated.**
     - Remaining = invoice amount − `paid_amount` − the sum of allocations with `settlement_source_type = 'withholding_record'`.
     - `transaction` allocations are not subtracted. They are an audit trail of money already counted in `paid_amount`.
     - It is calculated in one place, `computeDebtStatus`, so Pulse, Radar, the old UI and Telegram all see the same remaining balance.
     - "Waiting for the customer's tax slip" comes from `withholding_records.status`. Such an invoice never turns "overdue".
   - **Rejected option: also raising `paid_amount`.** The DB guard in 031 (`fn_debt_settlement_guard`) treats `paid_amount` and allocations as separate money that adds up. The same 10 would be counted twice, and later allocations on the invoice would be rejected. Getting around that would mean changing 031, which is not touched.
   - **Two conflicts Codex must resolve before coding (checked against `main`):**
     1. **The DB guard and transaction allocations.** `fn_debt_settlement_guard` allows allocations up to `ceiling − paid_amount`. It counts **all** allocations, including `transaction` ones. `POST /api/debts/:id/pay` raises `paid_amount`, and `/allocate` then records the same money as a `transaction` allocation.
        - Example: an invoice of 100 is paid 90 through `/pay`, so the room left is 10. Recording the 90 in `/allocate` is already rejected by the DB; this happens today, regardless of v2.
        - If a transaction allocation exists, a withholding allocation of 10 is rejected too: 90 + 10 > 10.
        - The withholding route only works when no transaction allocations exist on the invoice. Codex decides whether that is acceptable or whether the guard needs an approved fix. Changing 031 needs the owner's explicit approval. In both cases the existing `/allocate` conflict is reported as a separate finding.
     2. **`/api/debts/:id/pay` has its own remaining calculation** (`effectiveTotal − alreadyPaid`). It does not use `computeDebtStatus`. After a withholding of 10 on an invoice of 100, it would still accept a payment of 100. The pay route must use the same remaining formula, or overpayment becomes possible.
   - **Tests:**
     - both directions: receivable withheld by the customer, and payable withheld by us;
     - an invoice with no withholding is calculated exactly as before;
     - `/pay` rejects an overpayment after a withholding;
     - a "waiting for slip" invoice is never overdue;
     - business isolation.
   - **Scope.** `computeDebtStatus` and `/pay` are shared by all workspaces' Business screens. This is a change to existing Business behaviour, not only v2. It is a separate batch with its own review, not behind the v2 flag, and it does not touch Personal.
   - Until the bukti potong arrives, it shows as "waiting for the customer's tax slip" and is never treated as an unpaid balance or as a bad debt.
   - This does **not** apply when the company pays the UMKM final tax (PP 55/2022) and has given the customer its certificate (Surat Keterangan PP 55). Then the customer does not withhold PPh 23. The accountant confirms the document per customer.
   - P-10 must keep these cases separate, or contract margins will be understated.
2. **Interest we earn.**
   - Interest on deposits and on account balances goes to `other_income`, never to `interest`. The `interest` group is only for interest on loans the company owes.
   - The bank's 20% final tax on that interest (PPh 4(2) final) is counted inside `other_income`: income is shown net. It does not go to `tax`.
3. **Turnover tax under UMKM.**
   - If the company pays the final 0.5% tax on turnover (PP 55/2022), it is calculated from turnover, not from profit.
   - It stays in the `tax` group, but on screen it is labelled **"Turnover tax (0.5%)"** so it is not confused with income tax.
   - Whether a business is on this regime comes from the company tax profile, not from the category.

### What the P-10 batch contains

- One additive migration: `cashflow_categories.pnl_group` (nullable, CHECK on the 9 values above) and `industry_templates`.
- The template is seeded as **suggestions only**. The owner confirms them per business. Uncategorised records show "N of M records have a category" and are never guessed into profit.
- Tests on the profit formulas, including all three clarifications above:
  - a customer invoice paid net of PPh 23 keeps full revenue;
  - deposit interest is net in `other_income`;
  - UMKM turnover tax is labelled separately.
- Until a business confirms its mapping, Performance keeps today's estimate. Pulse and AI CFO keep using the keyword classifier.
- Tax rates still come only from the verified tax rule engine. No rates are written in UI code.

## Question for Codex before migration 061 is applied (PR #110)

`debts.withholding_slip_document_id` in 061 partly duplicates `withholding_records.bukti_potong_document_id` in 031. Decide before the owner applies 061:

- **A. Keep 061 as it is.** The column is only a "slip attached" mark for the bill checklist. Amounts and details live in `withholding_records`.
- **B. Drop the slip column from 061.** 061 keeps only the accountant check. The checklist reads the slip from `withholding_records`.

The owner prefers **B**: the slip is stored in one place. If Codex agrees, #110 is reworked in one commit (migration, its tests, the server route and the checklist read) before 061 is applied.

## Fixes for the next batch (from the batch 8 report)

These are not part of PR #110. They go into the next batch as separate, small changes.

- **Settings copy.** The Targets text says targets apply to Pulse, Radar and AI CFO, but only Pulse reads them. Fix the text, or wire Radar and AI CFO.
- **Server routes outside the flag.** The new routes work even when `VITE_DESIGN_V2` is off. Codex must confirm this is acceptable: they return empty values or 409 until the migrations are applied.
- **New counterparty roles.** "Landlord" and "lender" are accepted by the old UI and by MCP. Confirm this is intended, or limit the roles to v2.
- **`telegramActorWiring` test.** Its list of allowed migrations is out of date (048–061). Fix it as a separate change that touches only the test.
- **Weekly brief.** It is stored only; nothing sends it. Sending it needs a scheduler, which is a Railway/env change. Do not add one without separate approval.

## Final decisions for the remaining work (3 Oct 2026)

Codex is not available. From now on: **Claude Code writes, Claude (in the owner's chat) reviews each PR instead of Codex, and the owner merges and applies migrations.** The questions above that were waiting for Codex are closed as follows; the owner agreed to proceed.

1. **061 slip column: option B.** Remove `debts.withholding_slip_document_id`, its index and its trigger from 061. The slip lives only in `withholding_records.bukti_potong_document_id`. 061 keeps only the accountant check.
2. **Server routes outside the flag:** accepted. They are additive and return empty values or 409 until the migrations are applied.
3. **Counterparty roles landlord and lender:** accepted everywhere (old UI and MCP). They are additive and harmless.
4. **Weekly brief scheduler:** not now. The brief is stored only. A scheduler is a separate, explicitly approved Railway change after the release.
5. **PPh 23 withheld by a customer (remaining balance):**
   - Owner's narrow option 1 as written above:
     - remaining = amount − `paid_amount` − withholding allocations;
     - calculated in `computeDebtStatus`;
     - the same formula in `/api/debts/:id/pay`.
   - Migration 031 is not changed. When the 031 guard rejects a withholding allocation (the invoice already has transaction allocations), the route answers 409 with a clear message: "This invoice already has payment records in the settlement log; record the withholding with the accountant." It is never a silent failure.
   - The existing conflict between `/allocate` and `/pay` is reported in `PROPOSALS.md` as a finding. It is not fixed without approval.
6. **Assets register (P-11) and funding register (P-03): approved** as additive migrations, after the release batches.
   - P-03 has no link to Personal: the founder loan stays business-side only until the bridge is approved.
   - Depreciation is straight-line; asset groups and useful lives come from the verified tax rule engine.
7. **Release:** the owner applies migrations (test database first, then production) and turns `VITE_DESIGN_V2` on in Railway. Nobody else does.
