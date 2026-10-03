# Design v2 — proposals that need owner approval

Nothing in this file is implemented. Each entry is something a v2 screen would need
that does not exist today (a table, a column, a setting, an endpoint shape). Until it
is approved, the screen shows an honest empty / "not set up yet" state or a documented
default. Migrations are NOT written; AGENTS.md requires explicit approval first.

Format: what · fields · why · risk · what the UI does meanwhile.

## P-01 · Per-business runway target (batch 2)

- **What:** a runway target in days, per business.
- **Fields:** `businesses.runway_target_days int null` (or a row in an existing settings
  table), editable in Settings by owner/CFO.
- **Why:** Pulse compares runway with a target ("Target 60 days") and the hero status
  depends on it.
- **Risk:** low — additive nullable column, no financial meaning; needs a migration and a
  write path with the usual role check.
- **Meanwhile:** `RUNWAY_TARGET_DAYS = 60` in `client/src/v2/lib/pulseModel.js` (the design
  default), shown openly as "Target 60 days".

## P-02 · Structured context for the AI CFO (batch 2 → 5)

- **What:** an optional `context` object on `POST /api/ai-cfo/ask` (page, period, filters).
- **Why:** "Looking at: …" should reach the model as data, not as text in the question.
- **Risk:** backend change to the AI route (not auth); prompt-injection review needed.
- **Meanwhile:** context is prepended to the question text on the client.

## P-03 · Funding register (batch 3)

- **What:** a business-scoped table of funding records: equity, founder loans,
  intercompany loans, with terms and a repayment schedule.
- **Fields:** `funding_records(id, business_id, source_kind [founder|investor|intercompany|bank],
  instrument [equity|loan], counterparty_id null, amount, currency, received_on,
  outstanding, interest_rate null, terms_text, due_on null, created_by, created_at)` plus
  `funding_repayments(id, funding_record_id, due_on, amount, paid_transaction_id null)`.
- **Why:** Funding shows "Raised from outside", "Still to pay back" and "Next repayment";
  repayments should land on Radar.
- **Risk:** medium. A founder loan must NOT be mirrored from Personal without the
  approved Personal↔Business bridge (migrations 037–039 stay untouched). Needs audit on writes.
- **Meanwhile:** the register is an empty state; the page shows only the cash the
  existing classifier already marks as funding (never revenue).

## P-04 · Counterparty tax fields (batch 3)

- **What:** entity form (PT / CV / person / foreign), landlord and lender roles,
  payment terms in days.
- **Fields:** `counterparties.entity_form text null`, extend the role list with
  `landlord`, `lender`; `counterparties.payment_terms_days int null`.
- **Why:** the withholding rule depends on the counterparty type (services from a
  company, rent, a person, a foreign company); payment terms drive expected dates.
- **Risk:** low–medium. The rule mapping must stay in the verified rule engine, not in UI.
- **Meanwhile:** these options are shown disabled ("needs a new field"); the rest of the
  form saves through the existing POST /api/counterparties.

## P-05 · Bill document checklist status (batch 3)

- **What:** per-bill status for the withholding slip (bukti potong) and the accountant check.
- **Fields:** `debts.withholding_slip_document_id uuid null`, `debts.accountant_checked_at
  timestamptz null`, `debts.accountant_checked_by bigint null`.
- **Why:** Bill detail shows a 4-item checklist and "Nothing closes on its own".
- **Risk:** low; additive. Writes need the accountant role and an audit row.
- **Meanwhile:** those two rows say "not tracked here yet".

## P-06 · Customer payment reminders from the web (batch 3)

- **What:** a "Send reminder" action for a late invoice.
- **Why:** the design offers it on Pulse, Radar and Bills.
- **Risk:** outbound messaging (email/Telegram) to a third party — needs consent,
  templates, rate limits and an audit trail. Not a UI-only change.
- **Meanwhile:** the button is visible but disabled with "Coming soon".

## P-07 · Accountant review and monthly package (batch 4)

- **What:** "Send to your accountant for review", per-folder comments, and a monthly
  ZIP (folder per transaction + Excel index + statements + tax summary).
- **Fields:** `accounting_period_reviews(id, business_id, period, status, sent_at,
  sent_by, reviewer_user_id, completed_at)`, `document_comments(id, business_id,
  target_type, target_id, author_user_id, body, created_at)`; a server-side package
  builder over existing documents (signed URLs only).
- **Why:** Month close and Documents by transaction end in a review by the accountant.
- **Risk:** medium — exports client documents; needs role checks (accountant role),
  audit rows and size limits.
- **Meanwhile:** both buttons are disabled with "not available yet"; "Accountant review"
  shows "not tracked here yet".

## P-08 · Targets and alerts (batch 4, extends P-01)

- **What:** minimum cash and the weekly brief schedule, next to the runway target.
- **Fields:** `businesses.min_cash_idr numeric null`, `businesses.weekly_brief_cron text null`.
- **Why:** Settings → Targets & alerts.
- **Risk:** low; the brief sends Telegram messages — reuse the existing notification policy.
- **Meanwhile:** shown as "Not set up yet"; the runway target uses the 60-day default.

## P-09 · Company people (batch 4)

- **What:** directors, commissioners and shareholders with their share.
- **Fields:** `company_people(id, business_id, role [director|commissioner|shareholder],
  name, share_percent null, source_document_id null)`.
- **Why:** Company profile → People; needed for the annual return.
- **Risk:** personal data (names, ownership); access limited to owner/accountant.
- **Meanwhile:** "Not filled in", with a note that it is not stored yet.
