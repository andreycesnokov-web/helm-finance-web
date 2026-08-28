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

BEGIN;

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

-- ── Verification ──────────────────────────────────────────────────────────────────────────
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'incoming_payment_match_candidates';
