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
   - In the data it is **not a cash-flow category and not one of the 9 groups**. It is the difference between the invoice and the cash received, recorded on the invoice as "tax withheld by customer" and linked to the customer's bukti potong (P-05 / migration 061 holds the document link).
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

## Fixes for the next batch (from the batch 8 report)

These are not part of PR #110. They go into the next batch as separate, small changes.

- **Settings copy.** The Targets text says targets apply to Pulse, Radar and AI CFO, but only Pulse reads them. Fix the text, or wire Radar and AI CFO.
- **Server routes outside the flag.** The new routes work even when `VITE_DESIGN_V2` is off. Codex must confirm this is acceptable: they return empty values or 409 until the migrations are applied.
- **New counterparty roles.** "Landlord" and "lender" are accepted by the old UI and by MCP. Confirm this is intended, or limit the roles to v2.
- **`telegramActorWiring` test.** Its list of allowed migrations is out of date (048–061). Fix it as a separate change that touches only the test.
- **Weekly brief.** It is stored only; nothing sends it. Sending it needs a scheduler, which is a Railway/env change. Do not add one without separate approval.
