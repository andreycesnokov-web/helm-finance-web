# Backlog — Recurring Payables V1

Separate product task. NOT part of R001 / financial reset. Captured here so it is not lost.
Do not implement until atomic reset is approved and shipped.

## Goal
Let users define recurring payables (rent, salaries, subscriptions, taxes) that
auto-generate a **draft** payable before each due date. The system never auto-pays —
the user must confirm every payment.

## Fields
- counterparty
- amount + currency
- account / wallet
- category
- recurrence frequency: `weekly` | `monthly` | `yearly` | `custom`
- custom rule (e.g. every N days / specific day-of-month / cron-like) when frequency = custom
- start date
- next due date (derived, advanced after each generation)
- end date (optional)
- reminder schedule (lead days before due)
- status: `active` | `paused` | `cancelled`

## Behaviour
- A scheduler advances `next_due_date` and, `lead_days` before it, creates a **draft**
  payable in Payables (status draft, not confirmed, no cash impact until confirmed).
- Creates linked reminders per the reminder schedule.
- Paused/cancelled recurrences generate nothing.
- No auto-pay: generated payable is a draft; user confirms → existing payable/payment flow runs.

## Integrations
- **Payables** — generated drafts appear in the existing payables list.
- **Reminders** — reminder rows created on the existing reminders table.
- **AI CFO cash forecast / runway** — scheduled future payables feed the forecast
  (projected outflows), clearly marked as projected/unconfirmed.
- **Compliance / Payroll** — later, if a recurrence maps to a payroll or tax obligation.

## Proposed schema (additive migration, separate file — NOT R001)
- `recurring_payables (id, business_id, counterparty, amount, currency, wallet_id,
  category, frequency, custom_rule jsonb, start_date, next_due_date, end_date,
  lead_days, status, created_by_user_id, created_at, updated_at)`
- generated drafts reference `recurring_payable_id` on the payable/debt row (additive column).

## Out of scope for V1
- auto-pay, FX scheduling, multi-currency netting, approval workflows beyond existing confirm.
