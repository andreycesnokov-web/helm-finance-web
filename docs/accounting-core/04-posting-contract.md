# 04 — Double-entry posting contract (proposal, not implemented)

**Contract in one sentence:** every financial event already recorded by CFO AI produces at most one balanced,
immutable journal entry per event version, traceable to its source row and document, posted under database-enforced
rules; corrections are new entries, never edits.

## 1. Tables (proposed; additive)

```sql
gl_periods (
  id uuid PK, business_id uuid NOT NULL,
  period_start date NOT NULL, period_end date NOT NULL, fiscal_year int NOT NULL,
  status text NOT NULL CHECK (status IN ('open','closing','closed')),
  closed_by_user_id bigint, closed_at timestamptz,
  reopened_by_user_id bigint, reopened_at timestamptz, reopen_reason text,
  snapshot_sha256 text, version bigint NOT NULL DEFAULT 1,
  UNIQUE (business_id, period_start), CHECK (period_end >= period_start))

gl_journal_entries (
  id uuid PK, business_id uuid NOT NULL,
  entry_no bigint,                      -- per-company sequence, assigned when posted
  entry_date date NOT NULL,             -- accounting (recognition) date
  event_date date,                      -- original business date when it differs (late events)
  period_id uuid NOT NULL REFERENCES gl_periods,
  status text NOT NULL CHECK (status IN ('draft','pending_review','posted','void')),
  entry_kind text NOT NULL CHECK (entry_kind IN
    ('system','manual','adjustment','reversal','opening','closing','revaluation','depreciation','backfill')),
  source_type text,                     -- 'transaction' | 'debt' | 'debt_payment' | 'transfer' | 'payroll_run' | …
  source_id text, source_event text,    -- e.g. 'issued', 'paid', 'accrued', 'settled'
  source_version bigint,                -- source row version (bill_version, balance_version, run version)
  rule_set_version text,                -- posting-rule version that produced the lines
  request_key text,                     -- caller idempotency key (manual / API)
  payload_sha256 text NOT NULL,         -- hash of the normalised entry, for replay checks
  functional_currency text NOT NULL,
  memo text, reason text,               -- reason required for adjustment / reversal / manual
  reversal_of uuid UNIQUE REFERENCES gl_journal_entries,   -- an entry can be reversed once
  created_by_user_id bigint, created_by_kind text CHECK (created_by_kind IN ('user','system','ai')),
  submitted_by_user_id bigint, approved_by_user_id bigint, approved_role text,
  posted_by_user_id bigint, posted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, entry_no),
  UNIQUE (business_id, request_key))
-- exactly-once per source event (system and backfill entries):
CREATE UNIQUE INDEX ON gl_journal_entries (business_id, source_type, source_id, source_event, source_version)
  WHERE status <> 'void' AND entry_kind IN ('system','backfill');

gl_journal_lines (
  id uuid PK, entry_id uuid NOT NULL REFERENCES gl_journal_entries ON DELETE RESTRICT,
  business_id uuid NOT NULL, line_no int NOT NULL,
  account_id uuid NOT NULL REFERENCES gl_accounts,
  debit numeric(20,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(20,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  CHECK ((debit = 0) <> (credit = 0)),  -- exactly one side, never zero
  txn_currency text NOT NULL, txn_amount numeric(24,6) NOT NULL CHECK (txn_amount > 0),
  fx_rate numeric(38,18) NOT NULL,      -- txn → functional; 1 for functional-currency lines
  fx_rate_snapshot_id uuid REFERENCES fx_rate_snapshots,
  -- subledger and evidence references (all optional, all same business):
  wallet_id uuid, transaction_id bigint, debt_id bigint, payroll_run_id uuid, payroll_payment_id uuid,
  funding_record_id uuid, asset_id uuid, tax_treatment_id uuid, withholding_record_id uuid,
  counterparty_id uuid, document_id uuid, description text,
  UNIQUE (entry_id, line_no))

fx_rate_snapshots (                     -- immutable once written
  id uuid PK, base_currency text, quote_currency text, rate numeric(38,18) NOT NULL CHECK (rate > 0),
  rate_type text CHECK (rate_type IN ('transaction_spot','period_closing','tax_kmk')),
  source text NOT NULL,                 -- 'bi_jisdor', 'bi_middle', 'bank_statement', 'kmk', 'manual'
  effective_date date NOT NULL, source_reference text, fetched_at timestamptz, entered_by_user_id bigint,
  UNIQUE (base_currency, quote_currency, rate_type, source, effective_date))

gl_period_snapshots (                   -- frozen trial balance per close; never updated
  id uuid PK, business_id uuid NOT NULL, period_id uuid NOT NULL REFERENCES gl_periods,
  close_version int NOT NULL, trial_balance jsonb NOT NULL, sha256 text NOT NULL,
  closed_by_user_id bigint, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_id, close_version))

gl_entry_sequences (business_id uuid PK, last_entry_no bigint NOT NULL DEFAULT 0)

gl_posting_outbox (                     -- shadow phase: written in the same transaction as the cash writer
  business_id uuid, source_type text, source_id text, source_event text, source_version bigint,
  enqueued_at timestamptz, posted_entry_id uuid, last_error text, attempts int,
  PRIMARY KEY (business_id, source_type, source_id, source_event, source_version))
```

Monetary amounts: `numeric(20,2)` in the functional currency (as `debts` and funding already use); transaction
amounts `numeric(24,6)`; rates `numeric(38,18)` (as `transactions.booked_rate`). No floating point anywhere: SQL
`numeric`, and in JS the BigInt helpers of `transactionClass.js` with string I/O.

## 2. Invariants (all enforced in PostgreSQL, not only in JS)

| # | Invariant | Enforcement |
|---|---|---|
| P1 | Σ debit = Σ credit per entry, in the functional currency | posting function + DEFERRABLE INITIALLY DEFERRED constraint trigger at commit |
| P2 | ≥ 2 lines; each line exactly one side, > 0 | CHECKs + trigger |
| P3 | Posted entries and their lines are never updated or deleted | trigger: UPDATE/DELETE refused when status = 'posted' (no exceptions, also for service_role) |
| P4 | A correction is a new entry: `reversal` (mirror lines, `reversal_of`) and, if needed, a new `system`/`adjustment` entry | posting API; `reversal_of` UNIQUE |
| P5 | One entry per source event version | partial unique index; outbox primary key |
| P6 | Same request key + different payload → refused (`payload_mismatch`); same payload → the existing entry | posting function compares `payload_sha256` |
| P7 | No posting into a closed period | trigger on lines/entries checks `gl_periods.status = 'open'` under a row lock |
| P8 | Entry, lines, accounts, periods, subledger references belong to one business | tenant triggers on every reference |
| P9 | No line on a header or inactive account; control accounts only from the engine or with a subledger reference | trigger |
| P10 | Bank account balance in the GL = `fn_wallet_ledger_balance(wallet)` (functional currency for IDR wallets; transaction currency for foreign wallets) | reconciliation check (§7 of 06), daily and at close |
| P11 | Foreign-currency lines keep `txn_amount`, `txn_currency`, `fx_rate` and the rate snapshot; functional amount = round(txn × rate, 2) | posting function; rounding difference only on the FX account, ≤ 0.01 × lines |

## 3. Lifecycle and permissions

```
system event ──► (shadow) outbox ──► poster ──► posted
manual / adjustment:  draft ──submit──► pending_review ──approve+post──► posted
                        └──────── void (drafts only) ◄────────┘
posted ──reverse (reason)──► new reversal entry (posted) [+ corrected entry]
```

| Action | Allowed roles | Notes |
|---|---|---|
| System posting (from writers) | engine only, acting for the writer's actor | never directly callable from the client |
| Create / edit manual draft | owner, ceo, cfo, admin, accountant | AI may create drafts only, marked `created_by_kind = 'ai'` |
| Submit for review | creator | |
| Approve and post manual / adjustment | accountant, cfo; owner if the company has no accountant | four-eyes: approver ≠ creator when the company has ≥ 2 eligible members; AI-created drafts always need a human approver |
| Reverse a posted entry | accountant, cfo, owner | reason required; system entries are reversed by the engine when the source is reversed |
| Close a period | accountant, cfo, owner | checklist must pass (06 §8) |
| Reopen a period | owner (or cfo) + reason; accountant notified | audited; reports produced before reopen keep their snapshot hash |
| Manager, employee | none | read access per existing finance-read roles |

Every state change writes `audit_events` (entity `gl_journal_entry`, before/after, actor, role, channel) in the same
transaction; if the audit insert fails, the action fails.

## 4. Posting interface

```
rpc_gl_post_event(p_business uuid, p_actor bigint, p_source_type text, p_source_id text,
                  p_source_event text, p_source_version bigint) RETURNS gl_journal_entries
  -- reads the source row(s) FOR SHARE, builds lines with the rule set, posts or returns the existing entry
rpc_gl_journal_action(p_business uuid, p_actor bigint, p_request_key text, p_action text, p_payload jsonb)
  -- manual journals: create_draft | update_draft | submit | approve_post | void | reverse
rpc_gl_period_action(p_business uuid, p_actor bigint, p_request_key text, p_action text, p_payload jsonb)
  -- open_year | close | reopen
```

Rules live in one place, `server/lib/accounting/postingRules.js` (pure, versioned, golden-tested) with a matching SQL
implementation inside `rpc_gl_post_event`; a parity test runs both on the same fixtures (the same technique as
`cashClass.js` ↔ `financialInsights.js`). Unknown or unmapped cases never guess: they post to **suspense** with a
review item, or (for events that cannot be valued) stay in the outbox with `last_error`.

## 5. Atomicity and concurrency

- **Shadow phase:** cash writers insert an outbox row in their own transaction (cheap, cannot fail on accounting
  logic). A poster drains the outbox; each entry posts atomically (all lines or none). A GL bug can never block a
  cash operation during the beta.
- **Live phase (after validation):** the writer calls `rpc_gl_post_event` inside its own transaction, so the cash row
  and its entry commit together or not at all.
- Locks: cash writers keep `fn_ledger_writer_lock` (advisory 7070). GL posting takes a per-company advisory lock in a
  separate namespace (7071, hash of business id) for entry numbering, and `FOR SHARE` on the period row; period close
  takes `FOR UPDATE`, so a close and a posting into the same period serialise. READ COMMITTED as today; the deferred
  balance trigger re-checks at commit.
- Entry numbers: assigned at posting, per company, gap-free within a company (sequence row updated under the
  company lock), never reused.

## 6. Multi-currency

- Functional currency per company (IDR unless a USD bookkeeping permit is recorded — 03 §2). Each line balances in
  the functional currency; transaction currency, amount and rate are kept per line.
- Rate source (company accounting policy, default): the operation's own `booked_rate` when its provenance is present
  (bank statement or recorded quote); otherwise Bank Indonesia's rate for the transaction date from `fxProvider`
  (JISDOR for USD). Each used rate is frozen in `fx_rate_snapshots`.
- Tax rates (`kurs KMK`) are stored as `rate_type = 'tax_kmk'` for tax workpapers only; they never drive the GL.
- Realised FX: settling foreign AR/AP or converting between currencies posts the difference between the carrying
  and settlement functional amounts to 7-2000.
- Unrealised FX: at period close, monetary foreign balances (bank, AR, AP, loans) are revalued at the closing rate;
  the difference posts to 7-2100 as a `revaluation` entry, reversed on the first day of the next period.
- Foreign-currency bank accounts reconcile in their own currency (`txn_amount` sum) with `fn_wallet_ledger_balance`.

## 7. Relationship to the existing data (no duplication of cash)

The journal is the **accounting view** of events that already exist; it is not a second cash record. Cash stays in
`transactions`; balances on screens keep using `fn_wallet_ledger_balance`. A journal line on a bank account always
references the `transaction_id` it represents, and P10 proves they agree. Management screens (Pulse, Radar,
Performance cash P&L) do not read the journal until a separate, approved switch.
