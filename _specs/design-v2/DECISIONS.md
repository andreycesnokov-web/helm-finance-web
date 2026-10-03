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
