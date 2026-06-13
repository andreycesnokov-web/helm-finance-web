# Release Notes

## v0.9.0-beta — CFO AI business workflow + AI Accountant foundation

Tagged: `v0.9.0-beta` · Branch: `main` · Deploy: Railway (web + helm-finance-bot)

This is the stable return point before the next major feature
(Bank Statement Import). Do not make large changes directly on `main` after
this tag — use `feature/*` → PR → `develop` → `main`.

### Key working scenarios (verified)

**Business workspace & team**
- Business-scoped financial data (every wallet/transaction/debt/payroll owned by `business_id`).
- Team invites with roles: owner, ceo, admin, cfo, manager, employee. CEO has full approval rights.
- Team onboarding + Telegram training mode (`is_training`, zero cash impact).

**Telegram bot (separate service, `x-bot-secret` to backend)**
- `/start cfo_…` connects a member to their business.
- Manager/employee submissions → pending approval; owner/ceo/admin/cfo → auto-approved.
- Inline approvals in Telegram: View impact / Approve / Reject (with reason) / Ask details.
- Creator notifications on approve/reject/info; reply in user language.
- Multi-receipt upload (≤5) with Claude vision OCR — recognizes amount + counterparty, computes total.
- Invoice photo/PDF with "нужно оплатить" → creates a payable; "возврат мне" → reimbursement.

**Finance**
- Wallets (computed balances), transactions, payroll (gross/deductions/net, single cash impact).
- Receivables/Payables with edit, payment with required wallet selection, attachments.
- AI CFO Decision Engine: approve ≠ pay, deterministic payment simulation (cash/wallet/runway before→after), payment priority. Local fallback without Anthropic.

**AI Accountant (Phase 1)**
- Tax profile (business-scoped), versioned Tax Rules Registry, Official Sources, Compliance Calendar.
- Deterministic calendar (Indonesia: PPN, PPh 21, PPh Badan) with official-source links.
- Compliance feeds AI CFO context; Telegram deadline reminders. Advisory disclaimer (ru/en/id).

**Languages:** ru / en / id throughout, including AI CFO answers (matches the question's language).

### Migrations applied in Supabase (001–020)

`001 002 003 005 006 007 008 009 010 011 012 013 014 015 016 017 018 019 020`
(004 intentionally absent.) All additive and idempotent. See `migrations/`.

### Operational backup checklist (do before next major work)
- [ ] Supabase database backup/snapshot.
- [ ] Record Railway env var **names** for web + bot (values stay private).
- [ ] Confirm `v0.9.0-beta` tag is the rollback point.

### Branch & deploy workflow (from now on)
```
feature/<task>  →  PR  →  develop  →  PR  →  main  →  Railway deploy
```
- `main`: protected, production only (no direct push, PR required, no force push).
- `develop`: integration branch.
- Each major task on its own `feature/*` branch with build + migration review before PR.

### Next task
Bank Statement Import & Reconciliation V1 — on `feature/bank-statement-import`.
