# Design v2 — proposals that need owner approval

These are **proposals only**. No migration, table or column below has been written or applied.
Until each one is approved and built in its own batch, the screen shows an honest
"Not set up yet" / "Not available yet" state. Workspace: Business unless stated otherwise.

Each entry: what, fields, why (which screen), risk.

---

## P1 · Runway target (Pulse, Settings → Targets & alerts)

- **What:** one number per business — the runway the owner wants to keep (days).
- **Fields:** `businesses.runway_target_days INT NULL` (or a row in an existing settings table if one is preferred), `updated_by`, `updated_at`.
- **Why:** Pulse hero draws "runway vs target" and the progress bar; today it shows "No runway target set yet".
- **Risk:** low. Additive nullable column; no financial figure depends on it (display only). Needs a small write endpoint (owner/CFO only, audited).

## P2 · Funding register (Funding)

- **What:** equity and loan records — who, type, received, to repay, terms, schedule.
- **Fields:** `funding_records(id, business_id, source_kind[founder|investor|intercompany|bank], source_name, counterparty_id NULL, instrument[equity|loan|safe], amount, currency, received_at, interest_rate NULL, repay_schedule_json NULL, notes, created_by, created_at)` and `funding_repayments(id, funding_record_id, due_date, amount, paid_at NULL)`.
- **Why:** Funding screen totals ("Raised from outside", "Still to pay back", "Next repayment") and Radar repayments.
- **Risk:** **medium.** Overlaps the un-approved Personal↔Business bridge (migrations 037–039, behind `PERSONAL_FUNDING_BRIDGE_ENABLED`). A founder loan must appear in Personal only through the approved mirror — this table must not create Personal records. Needs owner + Codex review against the bridge design before any code.

## P3 · Counterparty types landlord / lender (Add counterparty, Counterparties)

- **What:** two more values for `counterparties.type` (`landlord`, `lender`) — today `CP_ROLES` = vendor, customer, both, tax_authority, bank, employee, other.
- **Fields:** none new; extend the allowed list in `server/lib/counterpartyIntelligence.js` `ROLES` (+ a CHECK if one exists in the DB).
- **Why:** design offers Supplier / Customer / Landlord / Lender; rent (PPh 4(2)) and loan interest are explained per type.
- **Risk:** low, but it touches backend validation, so it is a separate approved change. The tax rule for each type must still come from the verified engine, never from the type alone.

## P4 · Counterparty payment history ("8 days late on average")

- **What:** derived, not stored — average days late per counterparty from settled receivables (`debts.due_date` vs the paying transaction date).
- **Fields:** none if derived on read; optionally a read-only endpoint `GET /api/counterparties/payment-behaviour` (business-scoped).
- **Why:** Counterparties "How they pay", Radar/Bills "usually on time / often late".
- **Risk:** low (read-only), but needs a reliable debt→payment link (`debt_settlement_allocations`), which is only complete for invoices settled after Invoice Settlement V1.

## P5 · Unmatched incoming payment inbox (Bills banner "Rp X arrived and matches no invoice")

- **What:** surface incoming bank lines with no matched invoice.
- **Fields:** none new if built on the existing bank-import review rows / Incoming Payments staging (migration 048–050, flag `INCOMING_PAYMENTS_ENABLED`).
- **Why:** Bills page banner and "Match payment".
- **Risk:** depends on Incoming Payments being applied and enabled (owner decision). No code until then.

## P6 · Customer payment reminders ("Send reminder")

- **What:** send a reminder to a customer about an overdue invoice (email / WhatsApp / Telegram).
- **Why:** Pulse, Radar and Bills "Send reminder". Today the button is "Not available yet"; Pulse/Radar link to Bills.
- **Risk:** **medium.** Outbound messaging to third parties; needs consent, templates, rate limits and audit. Telegram delivery is out of scope (Telegram linking is a do-not-touch area).
