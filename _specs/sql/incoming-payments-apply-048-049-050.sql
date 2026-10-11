-- ============================================================================
-- Incoming Payments — COMBINED PRODUCTION APPLY SCRIPT (048 + 049 + 050)
--
-- Generated from, and byte-identical in effect to:
--   migrations/048_incoming_payments_foundation.sql
--   migrations/049_incoming_payments_bank_import_provenance.sql
--   migrations/050_incoming_payment_match_candidates.sql
--
-- WHY COMBINED AND WHY ONE TRANSACTION:
-- These three are ONE UNIT. The API selects the provenance columns added by 049 and the
-- review queue reads the table added by 050. A database with only 048 applied makes every
-- /api/incoming-payments route fail. The individual BEGIN/COMMIT wrappers have therefore
-- been merged into a SINGLE transaction: either all three apply, or none do. There is no
-- intermediate state to recover from.
--
-- ADDITIVE ONLY. No DROP TABLE, no DROP COLUMN, no ALTER COLUMN TYPE, no UPDATE, no DELETE,
-- no TRUNCATE. Creates two new tables, adds two nullable columns to one of them, plus
-- indexes, two functions and two triggers. Existing tables are NOT modified.
--
-- IDEMPOTENT. Every object uses IF NOT EXISTS / CREATE OR REPLACE. Safe to re-run.
--
-- Run preflight FIRST (incoming-payments-preflight.sql), then this, then postflight.
-- Do NOT enable INCOMING_PAYMENTS_ENABLED until postflight passes.
-- ============================================================================

BEGIN;


-- ─────────────────────────────────────────────────────────────────────────────
-- 048 — incoming_payments foundation
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 048 — Incoming Payments Foundation (PR1)
--
-- A provider-agnostic STAGING table for money that arrived: gateway settlements (Midtrans,
-- DOKU, Xendit, HitPay, Duitku, iPaymu, …), bank statement imports, and manual entry. One
-- normalized row per receipt, scoped to exactly one business workspace.
--
-- LEDGER-INERT BY DESIGN. A row here books nothing. It does not create a transaction, does
-- not touch a wallet balance, does not assert revenue, and does not finalise any accounting
-- or tax treatment. It is cash EVIDENCE awaiting human review (decision D22). The
-- linked_transaction_id / linked_debt_id columns exist so a LATER PR can record an approved
-- match; PR1 never populates them.
--
-- ADDITIVE and IDEMPOTENT. Creates one table, one unique index, four lookup indexes, and one
-- updated_at trigger. No backfill — the table starts empty, matching the default-OFF posture
-- of INCOMING_PAYMENTS_ENABLED. Safe to re-run.
--
-- NOTE ON TYPES: businesses.id and wallets.id are UUID; transactions.id and debts.id are
-- BIGINT (see 011/031/033). Money follows the financial_documents convention NUMERIC(20,2).

-- Wrapped in a transaction (as 031/033/038 are): a partial apply that created the table
-- without its unique index would leave the ONE mechanism that stops duplicate money missing.

CREATE TABLE IF NOT EXISTS incoming_payments (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT, matching migration 031's evidence convention ("Evidence = RESTRICT; businesses
  -- are soft-deleted in the app"). A receipt is evidence that money arrived; it must not be
  -- swept away as a side effect of removing a workspace. Hard purge stays an explicit
  -- admin procedure, consistent with D9 (archive-first).
  business_id                 UUID        NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,

  -- Receiving account. Nullable: a receipt may be recorded before the wallet is known.
  -- Same-business ownership is enforced by the API (wallets.business_id is nullable for
  -- legacy rows, so a DB-level composite FK is not available without a backfill).
  wallet_id                   UUID        NULL REFERENCES wallets(id) ON DELETE SET NULL,

  -- ── Source & provider (provider-agnostic; no gateway is privileged) ───────────────────
  source_type                 TEXT        NOT NULL
    CHECK (source_type IN ('manual_bank_entry','manual_gateway_import','gateway_settlement',
                           'bank_statement_import','future_gateway_api','future_bank_api')),
  -- Free text on purpose: a new Indonesian provider must not require a migration. The API
  -- holds the known list and normalises case; unknown values are accepted but flagged there.
  provider                    TEXT        NULL,
  provider_account_id         TEXT        NULL,
  provider_transaction_id     TEXT        NULL,
  provider_order_id           TEXT        NULL,
  provider_settlement_id      TEXT        NULL,
  settlement_batch_reference  TEXT        NULL,
  payment_method              TEXT        NULL,

  -- ── Money. Gross, fee, and net are stored SEPARATELY and never collapsed (D22). ───────
  gross_amount                NUMERIC(20,2) NOT NULL CHECK (gross_amount >= 0),
  -- NULL means "not known yet", which is NOT the same as a confirmed zero fee. NO DEFAULT:
  -- a `DEFAULT 0` would be dead code through the API (which always sends both columns) but
  -- live for every other writer — the bank-import feeder, a backfill, direct SQL — and each
  -- would silently inherit a claim that the gateway charged nothing. Unknown must stay NULL.
  fee_amount                  NUMERIC(20,2) NULL CHECK (fee_amount IS NULL OR fee_amount >= 0),
  tax_or_withholding_amount   NUMERIC(20,2) NULL
    CHECK (tax_or_withholding_amount IS NULL OR tax_or_withholding_amount >= 0),
  net_amount                  NUMERIC(20,2) NOT NULL CHECK (net_amount >= 0),
  currency                    TEXT        NOT NULL DEFAULT 'IDR',

  -- ── Time. transaction_at = when the customer paid; settled_at = when it landed. ───────
  transaction_at              TIMESTAMPTZ NULL,
  settled_at                  TIMESTAMPTZ NULL,

  payer_name                  TEXT        NULL,
  payer_reference             TEXT        NULL,
  description                 TEXT        NULL,

  -- ── Lifecycle. Two independent axes: review state and match state. Collapsing them is
  -- what makes a system claim a period is ready when it is not.
  --
  -- `status` is the REVIEW axis only. It deliberately does NOT carry matched/unmatched:
  -- those live in reconciliation_status, and having both columns able to express the same
  -- fact means they can disagree. Narrowed here while the table is still unapplied — later
  -- it would cost a migration plus a backfill. ─────────────────────────────────────────
  status                      TEXT        NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','reviewed','rejected')),
  reconciliation_status       TEXT        NOT NULL DEFAULT 'unmatched'
    CHECK (reconciliation_status IN ('unmatched','candidate','matched','ignored')),

  -- Reserved for a later matching PR. PR1 writes NULL. ON DELETE SET NULL, never CASCADE:
  -- deleting a ledger row must not delete the evidence that money arrived.
  linked_transaction_id       BIGINT      NULL REFERENCES transactions(id) ON DELETE SET NULL,
  linked_debt_id              BIGINT      NULL REFERENCES debts(id)        ON DELETE SET NULL,

  raw_provider_payload        JSONB       NULL,

  -- Duplicate money is worse than missing money: a retried webhook or a re-uploaded
  -- statement must never double-count revenue. See the unique index below.
  idempotency_key             TEXT        NOT NULL CHECK (length(trim(idempotency_key)) > 0),

  created_by_user_id          BIGINT      NULL,
  reviewed_by_user_id         BIGINT      NULL,
  reviewed_at                 TIMESTAMPTZ NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Arithmetic is enforced only when every component is KNOWN. If fee or withholding is
  -- NULL ("not known yet") the relationship is unverifiable and the row is still allowed —
  -- but it can never be silently wrong when the numbers are all present.
  CONSTRAINT incoming_payments_net_consistent CHECK (
    fee_amount IS NULL
    OR tax_or_withholding_amount IS NULL
    OR net_amount = gross_amount - fee_amount - tax_or_withholding_amount
  ),
  -- A review stamp is all-or-nothing: never a reviewer with no time, or a time with no reviewer.
  CONSTRAINT incoming_payments_review_stamp CHECK (
    (reviewed_by_user_id IS NULL AND reviewed_at IS NULL)
    OR (reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

-- ── Idempotency ───────────────────────────────────────────────────────────────────────────
-- One receipt per (business, source_type, provider, key). `provider` is nullable and in
-- Postgres NULLs are DISTINCT, so a plain multi-column UNIQUE would let unlimited duplicates
-- through whenever provider is NULL — exactly the manual-entry case. COALESCE closes that.
CREATE UNIQUE INDEX IF NOT EXISTS incoming_payments_idempotency_uidx
  ON incoming_payments (business_id, source_type, COALESCE(provider, ''), idempotency_key);

-- Second, independent guard: one row per provider transaction, whatever idempotency_key the
-- caller chose. Without this, a client that submits the same provider_transaction_id twice
-- under two different keys double-records the money and the key index never fires.
CREATE UNIQUE INDEX IF NOT EXISTS incoming_payments_provider_txn_uidx
  ON incoming_payments (business_id, COALESCE(provider, ''), provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;

-- ── Lookups ───────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS incoming_payments_business_idx
  ON incoming_payments (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS incoming_payments_status_idx
  ON incoming_payments (business_id, status);
CREATE INDEX IF NOT EXISTS incoming_payments_reconciliation_idx
  ON incoming_payments (business_id, reconciliation_status);
CREATE INDEX IF NOT EXISTS incoming_payments_provider_idx
  ON incoming_payments (business_id, provider);

-- ── updated_at trigger (matches 043/045/046 — no reliance on callers) ────────────────────
CREATE OR REPLACE FUNCTION fn_incoming_payments_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_incoming_payments_updated_at ON incoming_payments;
CREATE TRIGGER trg_incoming_payments_updated_at
  BEFORE UPDATE ON incoming_payments FOR EACH ROW
  EXECUTE FUNCTION fn_incoming_payments_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 049 — bank-import provenance
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 049 — Bank-import provenance on incoming_payments (PR2)
--
-- Lets a confirmed CREDIT row from the existing bank-import pipeline (migration 021) record
-- an incoming_payment, while keeping a hard pointer back to the batch and row it came from.
-- Provenance is the whole point: an accountant asking "where did this receipt come from?"
-- must land on the exact statement line, not on a re-typed copy of it.
--
-- The bank-import flow itself is UNCHANGED. This adds columns; it moves no data, converts no
-- existing row, and creates nothing on its own.
--
-- ADDITIVE and IDEMPOTENT. Two nullable columns and one partial unique index. Safe to re-run.
-- Requires 048.


ALTER TABLE incoming_payments
  -- ON DELETE SET NULL, never CASCADE: deleting an import batch must not delete the evidence
  -- that money arrived. Same reasoning as linked_transaction_id in 048.
  ADD COLUMN IF NOT EXISTS bank_import_batch_id UUID NULL REFERENCES bank_import_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bank_import_row_id   UUID NULL REFERENCES bank_import_rows(id)    ON DELETE SET NULL;

-- One receipt per statement line, enforced in the DB rather than trusted to the caller.
-- Re-confirming a batch, re-running the bridge, or importing an overlapping statement cannot
-- produce a second payment for the same row. Partial, because most payments have no bank row.
CREATE UNIQUE INDEX IF NOT EXISTS incoming_payments_bank_row_uidx
  ON incoming_payments (business_id, bank_import_row_id)
  WHERE bank_import_row_id IS NOT NULL;

-- Batch-level lookups: "show me everything this statement produced".
CREATE INDEX IF NOT EXISTS incoming_payments_bank_batch_idx
  ON incoming_payments (business_id, bank_import_batch_id)
  WHERE bank_import_batch_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 050 — match candidates
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 050 — Incoming payment match candidates (PR4)
--
-- A CANDIDATE is a proposal: "this receipt might be the money for that receivable". It is
-- never a decision. The engine computes candidates and a human accepts one; nothing here
-- books, settles, or closes anything, and accepting a candidate does not touch the debt or
-- the transaction it points at.
--
-- Targets are `debts` (receivables) and `transactions`. There is deliberately NO invoice
-- target: `invoices` (041) is unapplied in production, and a matching engine must not depend
-- on a table that does not exist there.
--
-- ADDITIVE and IDEMPOTENT. One table, one unique index, two lookup indexes, one same-business
-- guard trigger. Requires 048. Safe to re-run.


CREATE TABLE IF NOT EXISTS incoming_payment_match_candidates (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           UUID        NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  -- A candidate is meaningless without its payment, so this one DOES cascade: deleting the
  -- receipt removes proposals about it. The evidence itself is what RESTRICT protects.
  incoming_payment_id   UUID        NOT NULL REFERENCES incoming_payments(id) ON DELETE CASCADE,

  target_type           TEXT        NOT NULL CHECK (target_type IN ('debt', 'transaction')),
  target_debt_id        BIGINT      NULL REFERENCES debts(id)        ON DELETE CASCADE,
  target_transaction_id BIGINT      NULL REFERENCES transactions(id) ON DELETE CASCADE,

  -- 0..1. Advisory only: a high score never auto-accepts. Per D6 the engine computes and
  -- explains; the human decides.
  score                 NUMERIC(5,4) NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 1),
  -- Why this was proposed, as structured reasons. A candidate a reviewer cannot interrogate
  -- is a number they have to take on faith.
  match_reasons         JSONB       NOT NULL DEFAULT '[]'::jsonb,

  status                TEXT        NOT NULL DEFAULT 'suggested'
                          CHECK (status IN ('suggested', 'accepted', 'rejected')),
  decided_by_user_id    BIGINT      NULL,
  decided_at            TIMESTAMPTZ NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Exactly one target, and it must be the one target_type names. Without this a row could
  -- claim 'debt' while pointing at a transaction.
  CONSTRAINT incoming_payment_candidates_one_target CHECK (
    (target_type = 'debt'        AND target_debt_id IS NOT NULL AND target_transaction_id IS NULL)
    OR
    (target_type = 'transaction' AND target_transaction_id IS NOT NULL AND target_debt_id IS NULL)
  ),
  -- A decision stamp is all-or-nothing, and 'suggested' carries no decider.
  CONSTRAINT incoming_payment_candidates_decision_stamp CHECK (
    (status = 'suggested' AND decided_by_user_id IS NULL AND decided_at IS NULL)
    OR
    (status <> 'suggested' AND decided_by_user_id IS NOT NULL AND decided_at IS NOT NULL)
  )
);

-- One proposal per (payment, target). Re-running the engine refreshes a candidate; it never
-- accumulates duplicates of the same suggestion.
CREATE UNIQUE INDEX IF NOT EXISTS incoming_payment_candidates_uidx
  ON incoming_payment_match_candidates
     (incoming_payment_id, target_type, COALESCE(target_debt_id, -1), COALESCE(target_transaction_id, -1));

CREATE INDEX IF NOT EXISTS incoming_payment_candidates_payment_idx
  ON incoming_payment_match_candidates (incoming_payment_id, status, score DESC);
CREATE INDEX IF NOT EXISTS incoming_payment_candidates_business_idx
  ON incoming_payment_match_candidates (business_id, status);

-- ── Same-business guard ─────────────────────────────────────────────────────────────────
-- The API checks tenancy too, but a cross-company match is the single worst thing this
-- feature could do — it would attribute one company's money to another's receivable. That
-- belongs in the database, not only in a route. Same approach as fn_ic_funding_guard (033),
-- which also guards nullable columns a composite FK cannot reach.
CREATE OR REPLACE FUNCTION fn_incoming_payment_candidate_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_biz UUID;
BEGIN
  SELECT business_id INTO v_biz FROM incoming_payments WHERE id = NEW.incoming_payment_id;
  IF v_biz IS NULL OR v_biz <> NEW.business_id THEN
    RAISE EXCEPTION 'candidate business_id must match its incoming payment';
  END IF;

  IF NEW.target_debt_id IS NOT NULL THEN
    SELECT business_id INTO v_biz FROM debts WHERE id = NEW.target_debt_id;
    IF v_biz IS DISTINCT FROM NEW.business_id THEN
      RAISE EXCEPTION 'candidate target debt belongs to a different business';
    END IF;
  END IF;

  IF NEW.target_transaction_id IS NOT NULL THEN
    SELECT business_id INTO v_biz FROM transactions WHERE id = NEW.target_transaction_id;
    IF v_biz IS DISTINCT FROM NEW.business_id THEN
      RAISE EXCEPTION 'candidate target transaction belongs to a different business';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_incoming_payment_candidate_guard ON incoming_payment_match_candidates;
CREATE TRIGGER trg_incoming_payment_candidate_guard
  BEFORE INSERT OR UPDATE ON incoming_payment_match_candidates FOR EACH ROW
  EXECUTE FUNCTION fn_incoming_payment_candidate_guard();

COMMIT;

-- After COMMIT, run incoming-payments-postflight.sql and confirm every check.
