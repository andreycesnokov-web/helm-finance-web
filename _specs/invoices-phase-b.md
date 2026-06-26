# Spec — Invoices (Phase B) — FINAL PLAN for approval

Status: **PLAN ONLY.** No code, no migrations, no flags. One additive migration is
required (schema gap confirmed: no `invoices` table/endpoint today). Approve the schema
before any implementation.

## Design principles
- **Debts stay the cash/aging source of truth.** Payables/Receivables (the `debts`
  table) already handle outstanding balance, payments, partial/paid/overdue, and the
  `DebtPaymentModal`. An invoice is the **document layer** on top: number, line items,
  issue/due dates, status lifecycle, optional PDF. Issuing an invoice creates/links a
  debt; payments continue through the existing debt flow — invoices do NOT re-implement
  cash logic.
- **Direction:** `outgoing` = you bill a customer → links to a **receivable**;
  `incoming` = a vendor bills you → links to a **payable**.
- **Strictly business-scoped**, same rules as everything else (active `business_id`,
  never default fallback, invisible across businesses).

## 1. `invoices` table (additive)
```
CREATE TABLE IF NOT EXISTS invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  direction       TEXT NOT NULL CHECK (direction IN ('outgoing','incoming')),
  invoice_number  TEXT NOT NULL,                 -- per-business sequential (see §3)
  counterparty    TEXT NOT NULL,
  issue_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date        DATE NULL,
  currency        TEXT NOT NULL DEFAULT 'IDR',
  subtotal        NUMERIC NOT NULL DEFAULT 0,
  tax_total       NUMERIC NOT NULL DEFAULT 0,
  total           NUMERIC NOT NULL DEFAULT 0,
  notes           TEXT NULL,
  status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','issued','paid','cancelled')),
  linked_debt_id  BIGINT NULL REFERENCES debts(id) ON DELETE SET NULL,  -- created on issue
  created_by_user_id BIGINT NULL,
  issued_at       TIMESTAMPTZ NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (business_id, invoice_number)
);
CREATE INDEX IF NOT EXISTS invoices_business_idx ON invoices(business_id, status);
```

## 2. `invoice_line_items` table (additive)
```
CREATE TABLE IF NOT EXISTS invoice_line_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,  -- denormalized for scoping
  description  TEXT NOT NULL,
  quantity     NUMERIC NOT NULL DEFAULT 1,
  unit_price   NUMERIC NOT NULL DEFAULT 0,
  tax_rate     NUMERIC NOT NULL DEFAULT 0,        -- percent, e.g. 11 for PPN
  line_total   NUMERIC NOT NULL DEFAULT 0,        -- qty*unit_price (server-computed)
  sort_order   INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS invoice_line_items_invoice_idx ON invoice_line_items(invoice_id);
```
Totals (`subtotal`/`tax_total`/`total`) are **server-computed** from line items on every
write — never trusted from the client.

## 3. Invoice number generation (per-business sequential)
Global sequences (like `business_code_seq`) give one shared counter — wrong for
per-business numbering. Use a per-business counter with an atomic RPC:
```
CREATE TABLE IF NOT EXISTS invoice_counters (
  business_id UUID PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  last_seq    BIGINT NOT NULL DEFAULT 0
);
-- rpc_next_invoice_number(p_business uuid) -> text
--   atomically: INSERT ... ON CONFLICT DO UPDATE SET last_seq = last_seq + 1 RETURNING last_seq;
--   format e.g. 'INV-' || to_char(now(),'YYYY') || '-' || LPAD(seq::text, 5, '0')
```
Numbers are assigned at **issue** time (drafts have a temporary/empty number or a
`DRAFT-<uuid8>` placeholder), so cancelled drafts don't burn sequence numbers. RPC runs
in one statement → no duplicate numbers under concurrency. Format is configurable later.

## 4. Status lifecycle & relation to receivables/payables
- **draft** — editable; no debt yet; not counted in cash/aging.
- **issued** — assign `invoice_number`; **create a linked debt** (`type=receivable` for
  outgoing, `type=payable` for incoming) via the existing `POST /api/debts` logic
  (business-scoped, role-aware), set `linked_debt_id`, `issued_at`. From here the debt
  drives outstanding/paid/overdue and the `DebtPaymentModal`.
- **paid** — derived/synced from the linked debt's status (when the debt is fully paid).
  Option A (recommended): invoice `status` reads through to the debt; Option B: a small
  sync on debt payment. Decide at build time; A avoids drift.
- **cancelled** — drafts cancel freely; issued invoices cancelling should also cancel/
  void the linked debt (only if unpaid) — guarded.

## 5. Endpoints (all `auth` + `requireBusiness`; strict `business_id`)
- `POST   /api/invoices` — create draft `{ direction, counterparty, issue_date, due_date,
  currency, notes, line_items[] }`; server computes totals. Role: confirmed-record roles
  (owner/CEO/admin/CFO); manager/employee → draft/pending per existing policy.
- `GET    /api/invoices?direction=&status=` — list for the active business (strict scope).
- `GET    /api/invoices/:id` — detail incl. line items; 404 if not in active business.
- `PATCH  /api/invoices/:id` — edit a **draft** (line items/dates/counterparty); re-compute
  totals; reject edits to issued/paid except notes.
- `POST   /api/invoices/:id/issue` — assign number (RPC) + create linked debt + set issued.
- `POST   /api/invoices/:id/cancel` — guarded (void linked unpaid debt).
- (Payments continue via the existing `/api/debts/...` flow on `linked_debt_id`.)

## 6. PDF / document — LATER (not in the first cut)
Ship data + lifecycle first. PDF generation and attaching to `financial_documents`
(reusing `document_*_links` from migration 031) is a follow-up. Add an optional
`document_id UUID NULL REFERENCES financial_documents(id)` column now (cheap) so the PDF
phase doesn't need another migration. No PDF rendering in Phase B v1.

## 7. Business isolation rules
- Every read/write goes through `requireBusiness` → strict `business_id`; invalid/inaccessible
  `x-business-id` → 403; never falls back to the default business.
- `invoice_line_items.business_id` denormalized so line-item queries are independently
  scoped. `UNIQUE(business_id, invoice_number)` keeps numbers per-business.
- An invoice/line item of business A is never visible or mutable while active on B (404).

## 8. Role permissions
- View list/detail: owner/CEO/admin/CFO (same as Team/finance reads).
- Create/edit draft, issue, cancel: confirmed-record roles (owner/CEO/admin/CFO);
  manager/employee create drafts as `pending_approval` (mirrors `POST /api/debts`).
- Issue (creates a debt) requires a confirmed-record role.

## 9. UI
- `/business/invoices`: replace the placeholder with a real list (filters: direction,
  status), **"+ New invoice"** + empty-state CTA (mirrors Payables/Receivables).
- Create/edit form: counterparty, direction, dates, **line items** (add/remove rows,
  live totals), notes; Save draft / Issue. Business-scope only (no personal).
- Detail: header (number/status/totals), line items, linked receivable/payable link,
  Issue/Cancel actions; (PDF button later).

## 10. Tests
1. Create invoice (draft) in A → not visible in B; invalid `x-business-id` → 403.
2. Line-item totals computed server-side (client-sent totals ignored).
3. Issue → assigns a per-business sequential number, creates a linked debt of the
   correct type (outgoing→receivable, incoming→payable), `linked_debt_id` set.
4. Per-business numbering: A and B each start at 1; concurrent issues don't duplicate.
5. Paid status reflects the linked debt being fully paid.
6. Cancel a draft (free) and an issued unpaid invoice (voids the debt); cannot cancel a
   paid invoice without explicit handling.
7. Edit allowed on draft only; issued/paid edits limited to notes.
8. Role gates: manager/employee draft = pending; cannot issue.
9. Reset (R001): financial reset should also clear invoices/line items/counters for the
   business — add these tables to the reset RPC when this ships (additive to R001).

## 11. Migration safety & rollback
- **Additive only:** new tables (`invoices`, `invoice_line_items`, `invoice_counters`) +
  one RPC + an optional `document_id` column. No existing table/row mutated.
- Apply under the gated process: backup/restore point → apply → verify counts (all new
  tables empty; RPC exists; grants locked to `service_role`).
- **Rollback:** `DROP TABLE invoice_line_items, invoices, invoice_counters;
  DROP FUNCTION rpc_next_invoice_number(uuid);` — safe because additive and (pre-launch)
  empty. Post-launch rollback = restore point.
- **R001 coordination:** when invoices ship, extend R001 to delete invoice rows for the
  business (children first: line_items → invoices → counters) so reset stays complete and
  atomic. Document this as part of the invoices migration PR.

## Open decisions for you
- Number format (`INV-YYYY-#####` vs `INV-<biz_code>-#####` vs custom).
- Paid-status approach: read-through (A, recommended) vs synced (B).
- Tax model: per-line `tax_rate` (proposed) vs single invoice-level tax.
- Do drafts reserve a number (no) or only issued invoices (yes, proposed)?
