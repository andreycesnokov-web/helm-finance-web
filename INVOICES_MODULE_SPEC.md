# Helm Finance — Invoices Module Specification

**Date:** 2026-06-09  
**Status:** DESIGN ONLY — no implementation until approved  
**Depends on:** Desktop v1 design system (must be approved first)

---

## Purpose

The Invoices module tracks money owed and money coming in. It bridges the gap between the transaction log (what happened) and the payment pipeline (what should happen). It answers:

- "Who owes me money, and when is it due?"
- "What do I owe, and am I about to miss a deadline?"
- "Did this invoice get paid? Link it to a transaction."

This is a core CFO workflow. A business operator who uses Helm Finance should be able to manage their entire AR/AP cycle without leaving the app.

---

## Scope of v1

**Included:**
- Create invoice (manual via web form)
- Create invoice from Telegram (text command)
- View invoice list — receivable and payable
- Invoice statuses: draft → pending → overdue → paid
- Link invoice to a transaction when payment is recorded
- Create a reminder from an invoice
- Basic currency support (IDR, USD, RUB)
- Due date tracking

**Explicitly excluded from v1 (future):**
- AI extraction from PDF / image (file upload parsing) — planned for v2
- Invoice PDF generation / export
- Email sending of invoices
- Integration with accounting software (Xero, QuickBooks)
- Recurring invoices
- Partial payments
- Multi-currency invoice with exchange rate at payment date
- Client/vendor address book

---

## Data Model

### Table: `invoices`

```sql
CREATE TABLE invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         BIGINT NOT NULL REFERENCES users(id),

  -- Identity
  type            TEXT NOT NULL CHECK (type IN ('receivable', 'payable')),
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('draft', 'pending', 'overdue', 'paid')),
  invoice_number  TEXT,          -- user-defined or auto-generated (INV-001)

  -- Counterparty
  counterparty    TEXT NOT NULL, -- company or person name

  -- Amounts
  amount          NUMERIC NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'IDR',
  amount_idr      NUMERIC,       -- for display/sorting, computed at save

  -- Dates
  issued_date     DATE,
  due_date        DATE,
  paid_date       DATE,

  -- Notes
  description     TEXT,          -- what the invoice is for
  notes           TEXT,          -- internal notes

  -- Links
  transaction_id  UUID REFERENCES transactions(id),  -- linked when paid
  reminder_id     UUID REFERENCES reminders(id),     -- if a reminder was created

  -- Source tracking
  source_channel  TEXT DEFAULT 'web'
                    CHECK (source_channel IN ('web', 'telegram')),

  -- Timestamps
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX invoices_user_id_idx ON invoices(user_id);
CREATE INDEX invoices_status_idx ON invoices(status);
CREATE INDEX invoices_due_date_idx ON invoices(due_date);
CREATE INDEX invoices_type_idx ON invoices(type);
```

**Notes:**
- `type` is from the user's perspective: `receivable` = someone owes you, `payable` = you owe someone
- `status` flow: `draft` (not sent) → `pending` (sent, waiting) → `overdue` (past due date) → `paid`
- `overdue` status is computed: if `status = 'pending'` and `due_date < today`, it should display as overdue. In v1 we either compute this client-side or run a server check on load. No background cron needed yet.
- `amount_idr` is denormalized for sorting — set server-side using same logic as transactions
- `invoice_number` — auto-generated as "INV-{year}-{sequential}" if not provided by user

---

## API Endpoints

### List invoices
```
GET /api/invoices
Query params: type, status, from, to, search
Auth: required
Returns: Invoice[]
```

### Create invoice
```
POST /api/invoices
Body: { type, counterparty, amount, currency, due_date, description, notes, invoice_number? }
Auth: required
Returns: Invoice
```

### Get single invoice
```
GET /api/invoices/:id
Auth: required (scoped to user)
Returns: Invoice
```

### Update invoice
```
PATCH /api/invoices/:id
Body: partial invoice fields (any updatable field)
Auth: required
Returns: Invoice
```

### Mark as paid
```
PATCH /api/invoices/:id/pay
Body: { paid_date, transaction_id? }
Auth: required
Side effects: sets status='paid', paid_date, optionally links transaction
Returns: Invoice
```

### Delete invoice
```
DELETE /api/invoices/:id
Auth: required
Note: only allowed if status='draft'; otherwise set to 'cancelled' (not in scope yet)
```

### Create reminder from invoice
```
POST /api/invoices/:id/reminder
Body: { due_date } (defaults to invoice due_date - 2 days)
Auth: required
Side effects: creates reminder in reminders table, sets invoice.reminder_id
Returns: { invoice, reminder }
```

---

## Status State Machine

```
         [create]          [user sends/confirms]
  ───────→ DRAFT ──────────────────→ PENDING
                                        │
                    [due_date < today]  │
                            ↓           │
                         OVERDUE ←──────┘
                            │
                [mark paid] │ [mark paid]
                            ↓
                          PAID
```

Transitions:
- DRAFT → PENDING: user action ("mark as sent")
- PENDING → OVERDUE: computed (due_date < today, status is still pending)
- OVERDUE → PAID: user action ("mark as paid")
- PENDING → PAID: user action (can skip overdue)
- PAID → any: not allowed (paid is terminal in v1)
- DRAFT → PAID: allowed for "already paid, just recording"

---

## Telegram Bot Integration

### Command: `/invoice`

```
User: /invoice

Bot: Create an invoice. Tell me:
  · Who is it for/from?
  · Receivable (they owe you) or payable (you owe them)?
  · Amount and currency?
  · Due date?
  · What's it for? (optional)
  
  Example: "Helm Care owes me 5M IDR for consulting, due June 20"
```

### Natural language invoice creation

```
User: "Helm Care owes me 5,000,000 IDR for consulting services, due June 20"

Bot: Invoice created ✓

  📄 Receivable Invoice
  Counterparty: Helm Care
  Amount: Rp 5,000,000
  Due: June 20, 2026
  For: consulting services
  
  [View] [Add reminder] [Mark paid]
```

**Parser behavior for invoices:**
- Trigger keywords: "owes me", "должен мне", "I owe", "я должен", "invoice", "счёт", "выставить"
- Extract: counterparty, amount, currency, due_date, description, type (receivable/payable)
- Pass to `POST /api/invoices`

### Bot command: `/invoices`

```
User: /invoices

Bot: 📋 Your invoices

  RECEIVABLE (you're owed):
  · Helm Care — Rp 5M — due Jun 20 — Pending
  · Client XYZ — Rp 2M — due Jun 10 — OVERDUE ⚠️

  PAYABLE (you owe):
  · Vendor ABC — Rp 1.5M — due Jun 15 — Pending

  Total receivable: Rp 7M
  Total payable: Rp 1.5M
```

### Upload from Telegram (v2 — not in v1 scope)

When a user sends a photo or PDF to the bot, it will be detected as a potential invoice and passed through AI extraction. This is explicitly deferred because it requires:
- Supabase Storage or S3 for file storage
- Anthropic Vision API for PDF/image reading
- Data extraction and confirmation flow

---

## Web UI — Detailed Screen Design

### Invoice List Page (full spec)

**Page header:**
```
Invoices                                              [+ New Invoice]
```

**Summary bar (4 tiles):**
```
┌──────────────────┬──────────────────┬──────────────────┬──────────────────┐
│ Total Receivable │ Total Payable    │ Overdue          │ Due This Week    │
│                  │                  │                  │                  │
│ +Rp 12,000,000   │ -Rp 4,500,000    │ Rp 2,000,000     │ Rp 1,500,000     │
│ 3 invoices       │ 2 invoices       │ 1 invoice ⚠️     │ 1 invoice        │
└──────────────────┴──────────────────┴──────────────────┴──────────────────┘
```

**Filter bar:**
```
[All types ▾]  [All statuses ▾]  [This month ▾]  [🔍 Search counterparty...]
```

**Invoice table columns:**
```
INV #  │  DUE DATE  │  COUNTERPARTY     │  TYPE        │  STATUS   │  AMOUNT
```

**Column details:**
- INV #: invoice_number, secondary text, monospace
- DUE DATE: "Jun 20" format; overdue dates in rose color
- COUNTERPARTY: primary text, bold
- TYPE: badge — "Receivable" (emerald) / "Payable" (neutral)
- STATUS: badge — Draft (neutral) / Pending (amber) / Overdue (rose) / Paid (emerald)
- AMOUNT: right-aligned, tabular-nums; receivable in green, payable in neutral

**Row hover actions (appear in last column):**
- "Mark paid" button (ghost, only for pending/overdue)
- "Create reminder" icon
- "Edit" icon
- "..." overflow for more

---

### Invoice Detail / Create Panel

Clicking a row opens a slide-over panel from the right (on desktop) or a full page (mobile).

**Create form fields:**

| Field | Input type | Required | Notes |
|-------|-----------|----------|-------|
| Type | Radio: Receivable / Payable | Yes | |
| Counterparty | Text input | Yes | Company or person name |
| Invoice number | Text input | No | Auto-generated if blank |
| Amount | Number input | Yes | Comma-formatted |
| Currency | Select: IDR / USD / RUB | Yes | Default: IDR |
| Issued date | Date picker | No | Default: today |
| Due date | Date picker | Yes | |
| Description | Textarea | No | What is this for? |
| Notes | Textarea | No | Internal only |

**Create form actions:**
- [Save as draft] — status = draft
- [Save & mark pending] — status = pending
- [Cancel]

**Detail view (existing invoice):**
- Same fields, editable inline
- Status badge + transition button ("Mark as sent", "Mark as paid")
- Timeline section at bottom: "Created Jun 9", "Sent Jun 9", "Overdue Jun 12"
- Linked transaction: if paid, shows transaction card
- Linked reminder: if reminder exists, shows it with snooze/done controls

---

### Mark as Paid Flow

User clicks "Mark paid" on a pending/overdue invoice:

```
Modal:

  Mark Invoice as Paid
  ─────────────────────────────────────
  Helm Care · Rp 5,000,000
  
  Paid on:  [date picker, default: today]
  
  Link to transaction (optional):
  [🔍 Search your transactions...]
  
  — or —
  
  [Create a new transaction for this payment]
  
  [Confirm]   [Cancel]
```

After confirmation:
- Invoice status → paid
- If transaction linked: transaction_id set on invoice
- If "create transaction": opens POST /api/transactions/batch pre-filled with invoice data
- Toast: "Invoice marked as paid ✓"

---

### Create Reminder from Invoice

```
Modal:

  Set a reminder for this invoice
  ─────────────────────────────────────
  Helm Care — Rp 5M — Due Jun 20
  
  Remind me:  [2 days before due ▾]
              Options: 1 day before / 2 days before / 
                       1 week before / On due date / Custom date
  
  [Set reminder]   [Cancel]
```

After confirmation:
- Reminder created in reminders table with title "Invoice due: Helm Care Rp 5M"
- due_date = invoice.due_date - N days
- invoice.reminder_id set
- Toast: "Reminder set for Jun 18 ✓"
- Reminder appears in Pulse Today's Focus when due

---

## Empty States

### No invoices (ever):
```
        [FileText icon — 48px]
        
        No invoices yet
        
        Track what you're owed and what you owe.
        Add your first invoice or send one via Telegram.
        
        [+ New Invoice]     [How to use Telegram →]
```

### No results (filtered):
```
        [Search icon]
        
        No invoices match
        
        Try adjusting your filters.
        
        [Clear filters]
```

### All invoices paid (status filter = overdue, no results):
```
        [CheckCircle icon — emerald]
        
        Nothing overdue
        
        You're on top of your payments.
```

---

## Integration with Pulse Page

When invoices exist:

**Today's Focus section** will include:
- Overdue invoices (rose color, "OVERDUE" badge)
- Invoices due within 3 days (amber, "Due soon" badge)

**AI CFO panel** will reference:
- Total receivable in Quick Stats
- "2 invoices overdue — Rp 4.5M at risk" as a recommended action

**Reminder creation from invoice** means overdue invoices can appear in Today's Focus via the reminders system, without any extra Pulse-page query.

---

## Data Flow: Telegram → Invoice

```
User message in Telegram
         ↓
classifyMessage() → returns "invoice"  (new classification)
         ↓
parseInvoice(text) → Anthropic API
  → returns { type, counterparty, amount, currency, due_date, description }
         ↓
Bot displays preview:
  "📄 Receivable — Helm Care — Rp 5M — due Jun 20"
  [✓ Create]  [✗ Cancel]
         ↓
POST /api/invoices
         ↓
Stored in Supabase invoices table
         ↓
Bot replies: "Invoice created ✓" + summary
```

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| User confuses receivable/payable direction | HIGH | MEDIUM | Clear language: "They owe you" / "You owe them" — no jargon |
| Due date timezone issues (Bali, Moscow, etc.) | MEDIUM | LOW | Store as DATE (no time component) — no tz conversion needed |
| Overdue status not auto-updating | LOW | MEDIUM | Compute overdue client-side at render time; server adds nightly check in v2 |
| Invoice amount vs transaction amount mismatch | LOW | LOW | These are separate records — no auto-reconciliation in v1 |
| Telegram invoice parsing confuses with transaction | MEDIUM | MEDIUM | Add "invoice" to classifyMessage; train prompt with examples |
| User deletes transaction linked to invoice | LOW | MEDIUM | FK constraint or warning modal before deletion |
| Invoice number collisions (if auto-generated) | LOW | LOW | Use `INV-YYYY-{sequential}` per user; unique index on (user_id, invoice_number) |

---

## Migration Required (when implementation approved)

```sql
-- migrations/002_invoices.sql

CREATE TABLE invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         BIGINT NOT NULL REFERENCES users(id),
  type            TEXT NOT NULL CHECK (type IN ('receivable', 'payable')),
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('draft', 'pending', 'overdue', 'paid')),
  invoice_number  TEXT,
  counterparty    TEXT NOT NULL,
  amount          NUMERIC NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'IDR',
  amount_idr      NUMERIC,
  issued_date     DATE,
  due_date        DATE,
  paid_date       DATE,
  description     TEXT,
  notes           TEXT,
  transaction_id  UUID,
  reminder_id     UUID REFERENCES reminders(id),
  source_channel  TEXT DEFAULT 'web'
                    CHECK (source_channel IN ('web', 'telegram')),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX invoices_user_id_idx ON invoices(user_id);
CREATE INDEX invoices_status_idx ON invoices(status);
CREATE INDEX invoices_due_date_idx ON invoices(due_date);
CREATE INDEX invoices_type_idx ON invoices(type);
```

**Note:** `transaction_id` is not a FK in the migration above because `transactions.id` is currently a BIGINT SERIAL (not UUID). If we ever migrate transactions.id to UUID, add the FK then. For now, link is by value match only.

---

## Bot Changes Required (when approved)

1. `parser.js`: add `parseInvoice(text)` function
2. `parser.js`: update `classifyMessage()` to return `"invoice"` as a type
3. `bot.js`: handle `type === 'invoice'` branch in message handler
4. `bot.js`: add `/invoices` command handler
5. `db.js`: add `createInvoice`, `getInvoices`, `updateInvoice` functions

---

## Approval Gate

Do not begin implementation of any invoice feature until:
1. Desktop v1 design system is approved and implemented (Phase 1–5 of DESKTOP_V1_PLAN.md)
2. This spec is explicitly approved
3. Migration SQL is reviewed and approved for execution in Supabase Dashboard
