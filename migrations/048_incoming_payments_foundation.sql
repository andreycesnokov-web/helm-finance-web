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
BEGIN;

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

COMMIT;

-- ── Verification ──────────────────────────────────────────────────────────────────────────
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'incoming_payments';
