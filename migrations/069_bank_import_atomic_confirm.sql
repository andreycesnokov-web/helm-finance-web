-- Migration 069 — Atomic bank statement confirm
-- Date: 2026-10-08. ADDITIVE + IDEMPOTENT + TRANSACTIONAL. No table changes, no data changes.
--
-- Until now POST /api/bank-imports/:batchId/confirm (and the V1 /api/bank-import/batches/:id/confirm)
-- wrote row by row through PostgREST: a failure half way left part of a statement imported, a
-- double click or two tabs could import the same rows twice, and two copies of the same statement
-- uploaded as separate batches could both be imported. This function performs the whole confirm
-- in ONE transaction:
--   * pg_advisory_xact_lock per business — serialises every confirm of the business (sibling
--     batches of the same statement, links to the same ledger transaction). The lock is held until
--     the end of THIS transaction, which is the whole confirm.
--   * SELECT … FOR UPDATE on the batch and on each row, then every check is repeated under the lock.
--   * rows already linked to a transaction are skipped (replay); a request where nothing is left to
--     do returns already_processed = true and writes nothing.
--   * the same statement uploaded twice: a statement line (dedup_hash = wallet, date, amount,
--     direction, description, bank reference) may reach the ledger from this batch only as many
--     times as it occurs in this batch MINUS the copies already in the ledger from other batches.
--     So two genuine identical lines in one statement both import, a payment and its fee that
--     share a bank reference (different amount / description) both import, and a second copy of
--     an imported statement raises duplicate_of_imported_row. Rows whose ledger transaction was
--     deleted do not count.
--   * everything the server validated or priced before the call is checked again under the lock:
--     batch status, statement period, wallet ownership, row amount, row date and currency used
--     for the FX valuation, IDR value consistent with amount × rate, category / counterparty
--     ownership, link target (business, wallet, type, amount, not linked elsewhere).
--   * any error raises → the whole confirm rolls back: no transaction, no row update, no
--     reconciliation, no status change.
-- Statuses, reconciliation snapshot and classification feedback follow the previous route logic.

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_confirm_bank_import(
  p_business_id uuid,
  p_batch_id uuid,
  p_owner_user_id bigint,
  p_actor_user_id bigint,
  p_plan jsonb,
  p_flow text DEFAULT 'review'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_batch      public.bank_import_batches%ROWTYPE;
  v_row        public.bank_import_rows%ROWTYPE;
  v_item       jsonb;
  v_action     text;
  v_type       text;
  v_scope      text;
  v_cat_id     uuid;
  v_cat_name   text;
  v_cp_id      uuid;
  v_cp_name    text;
  v_match_id   bigint;
  v_match      record;
  v_wallet_name     text;
  v_wallet_scope    text;
  v_wallet_currency text;
  v_tx_id      bigint;
  v_currency   text;
  v_now        timestamptz := now();
  v_imported   integer := 0;
  v_linked     integer := 0;
  v_excluded   integer := 0;
  v_skipped    integer := 0;
  v_signed     numeric := 0;
  v_remaining  integer;
  v_status     text;
  v_rec        public.bank_reconciliations%ROWTYPE;
  v_rec_json   jsonb := NULL;
  v_computed   numeric;
  v_diff       numeric;
  v_in_batch   integer;
  v_mine       integer;
  v_other      integer;
  v_rate       numeric;
  v_idr        numeric;
  v_valid_types constant text[] := ARRAY['income','expense','transfer','payroll','owner_injection','owner_withdrawal','correction'];
BEGIN
  IF p_flow NOT IN ('review', 'legacy') THEN
    RAISE EXCEPTION 'invalid_plan: unknown flow %', p_flow;
  END IF;
  IF p_plan IS NULL OR jsonb_typeof(p_plan) <> 'array' OR jsonb_array_length(p_plan) = 0 THEN
    RAISE EXCEPTION 'invalid_plan: plan must be a non-empty array';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_plan) x WHERE (x->>'row_id') IS NULL) THEN
    RAISE EXCEPTION 'invalid_plan: every item needs row_id';
  END IF;
  IF (SELECT count(*) <> count(DISTINCT x->>'row_id') FROM jsonb_array_elements(p_plan) x) THEN
    RAISE EXCEPTION 'invalid_plan: duplicate row_id in plan';
  END IF;

  -- One confirm per business at a time, held to the end of this transaction.
  PERFORM pg_advisory_xact_lock(hashtextextended('bank_import_confirm:' || p_business_id::text, 0));

  SELECT * INTO v_batch FROM public.bank_import_batches
   WHERE id = p_batch_id AND business_id = p_business_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'batch_not_found: batch does not exist in this business';
  END IF;
  IF v_batch.status IN ('imported', 'cancelled') THEN
    RAISE EXCEPTION 'batch_closed: batch status is %', v_batch.status;
  END IF;

  IF v_batch.wallet_id IS NOT NULL THEN
    SELECT name, scope, currency INTO v_wallet_name, v_wallet_scope, v_wallet_currency FROM public.wallets
     WHERE id = v_batch.wallet_id AND business_id = p_business_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'wallet_not_found: batch wallet does not belong to this business';
    END IF;
  END IF;
  v_currency := upper(coalesce(v_batch.currency, v_wallet_currency, 'IDR'));

  -- Corrupt statement period (e.g. a title line parsed as the header): refuse the whole batch.
  IF (v_batch.statement_start IS NOT NULL AND (v_batch.statement_start < DATE '1990-01-01' OR v_batch.statement_start > DATE '2099-12-31'))
     OR (v_batch.statement_end IS NOT NULL AND (v_batch.statement_end < DATE '1990-01-01' OR v_batch.statement_end > DATE '2099-12-31'))
     OR (v_batch.statement_start IS NOT NULL AND v_batch.statement_end IS NOT NULL
         AND (v_batch.statement_start > v_batch.statement_end OR v_batch.statement_end - v_batch.statement_start > 366 * 5)) THEN
    RAISE EXCEPTION 'corrupt_statement_period: statement period % … % is not usable', v_batch.statement_start, v_batch.statement_end;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_plan) LOOP
    SELECT * INTO v_row FROM public.bank_import_rows
     WHERE id = (v_item->>'row_id')::uuid AND batch_id = p_batch_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'row_not_in_batch: %', v_item->>'row_id';
    END IF;

    -- Replay / concurrent duplicate: the row already became (or was linked to) a ledger record.
    IF v_row.linked_transaction_id IS NOT NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_action := coalesce(v_item->>'action', 'create');
    IF v_action NOT IN ('create', 'link', 'exclude') THEN
      RAISE EXCEPTION 'invalid_row: statement row % has unknown action %', v_row.row_index + 1, v_action;
    END IF;
    v_type := v_item->>'type';
    IF v_type IS NULL OR NOT (v_type = ANY (v_valid_types)) THEN
      RAISE EXCEPTION 'invalid_row: statement row % has invalid transaction type %', v_row.row_index + 1, coalesce(v_type, 'null');
    END IF;
    v_scope := coalesce(v_item->>'scope', v_wallet_scope, 'business');

    v_cat_id := nullif(v_item->>'category_id', '')::uuid;
    v_cat_name := NULL;
    IF v_cat_id IS NOT NULL THEN
      SELECT name INTO v_cat_name FROM public.cashflow_categories WHERE id = v_cat_id AND business_id = p_business_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'invalid_row: statement row % category does not belong to this business', v_row.row_index + 1;
      END IF;
    ELSE
      v_cat_name := nullif(v_item->>'category_name', '');   -- legacy text category (V1 flow)
    END IF;

    v_cp_id := nullif(v_item->>'counterparty_id', '')::uuid;
    v_cp_name := NULL;
    IF v_cp_id IS NOT NULL THEN
      SELECT name INTO v_cp_name FROM public.counterparties WHERE id = v_cp_id AND business_id = p_business_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'invalid_row: statement row % counterparty does not belong to this business', v_row.row_index + 1;
      END IF;
    ELSE
      v_cp_name := coalesce(nullif(v_item->>'counterparty_name', ''), v_row.suggested_counterparty);
    END IF;

    IF v_action IN ('create', 'link') THEN
      IF v_row.amount IS NULL OR v_row.amount <= 0 THEN
        RAISE EXCEPTION 'invalid_row: statement row % has no positive amount', v_row.row_index + 1;
      END IF;
      IF (v_item->>'expected_amount') IS NULL OR abs(v_row.amount - (v_item->>'expected_amount')::numeric) >= 0.005 THEN
        RAISE EXCEPTION 'row_changed: statement row % amount changed after validation', v_row.row_index + 1;
      END IF;
    END IF;

    -- Same audit feedback as the previous route (suggestion vs final decision).
    INSERT INTO public.classification_feedback (
      business_id, bank_import_row_id, normalized_desc,
      suggested_category_id, final_category_id,
      suggested_transaction_type, final_transaction_type,
      confidence, accepted, source, reviewed_by_user_id
    ) VALUES (
      p_business_id, v_row.id, v_item->>'normalized_desc',
      v_row.suggested_category_id, v_cat_id,
      v_row.suggested_transaction_type, v_type,
      v_row.suggestion_confidence,
      (v_row.suggested_category_id IS NOT DISTINCT FROM v_cat_id) AND (v_row.suggested_transaction_type IS NOT DISTINCT FROM v_type),
      CASE WHEN p_flow = 'legacy' THEN 'bank_import_v1' ELSE 'bank_review' END,
      p_actor_user_id
    );

    IF v_action = 'exclude' THEN
      UPDATE public.bank_import_rows SET
        final_transaction_type = v_type, final_category_id = v_cat_id,
        final_counterparty_id = v_cp_id, final_scope = v_scope,
        review_status = 'excluded', reviewed_by_user_id = p_actor_user_id, reviewed_at = v_now
       WHERE id = v_row.id;
      v_excluded := v_excluded + 1;
      CONTINUE;
    END IF;

    IF v_action = 'link' THEN
      v_match_id := nullif(v_item->>'matched_transaction_id', '')::bigint;
      IF v_match_id IS NULL THEN
        RAISE EXCEPTION 'invalid_row: statement row % link needs matched_transaction_id', v_row.row_index + 1;
      END IF;
      SELECT id, business_id, wallet_id, amount_original, type INTO v_match
        FROM public.transactions WHERE id = v_match_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'link_target_not_found: transaction % does not exist', v_match_id;
      END IF;
      IF v_match.business_id IS DISTINCT FROM p_business_id THEN
        RAISE EXCEPTION 'isolation_violation: matched transaction belongs to another business';
      END IF;
      IF v_batch.wallet_id IS NOT NULL AND v_match.wallet_id IS NOT NULL AND v_match.wallet_id <> v_batch.wallet_id THEN
        RAISE EXCEPTION 'link_mismatch: matched transaction belongs to a different wallet';
      END IF;
      IF v_match.type IS NOT NULL AND v_match.type <> v_type THEN
        RAISE EXCEPTION 'link_mismatch: matched transaction type % does not match row type %', v_match.type, v_type;
      END IF;
      IF abs(v_match.amount_original - v_row.amount) >= 0.01 THEN
        RAISE EXCEPTION 'link_mismatch: matched transaction amount does not match row amount';
      END IF;
      IF EXISTS (SELECT 1 FROM public.bank_import_rows o WHERE o.linked_transaction_id = v_match_id AND o.id <> v_row.id) THEN
        RAISE EXCEPTION 'link_conflict: transaction % is already linked to another statement row', v_match_id;
      END IF;
      UPDATE public.bank_import_rows SET
        final_transaction_type = v_type, final_category_id = v_cat_id,
        final_counterparty_id = v_cp_id, final_scope = v_scope,
        review_status = 'matched_existing', matched_transaction_id = v_match_id,
        linked_transaction_id = v_match_id,
        match_status = CASE WHEN p_flow = 'legacy' THEN 'confirmed' ELSE match_status END,
        reviewed_by_user_id = p_actor_user_id, reviewed_at = v_now
       WHERE id = v_row.id;
      v_linked := v_linked + 1;
      v_signed := v_signed + CASE WHEN v_type = 'income' THEN v_row.amount ELSE -v_row.amount END;
      CONTINUE;
    END IF;

    -- action = 'create'
    IF v_row.tx_date IS NULL OR v_row.tx_date < DATE '1990-01-01' OR v_row.tx_date > DATE '2099-12-31' THEN
      RAISE EXCEPTION 'invalid_row: statement row % has no valid date', v_row.row_index + 1;
    END IF;
    IF (v_item->>'amount_idr') IS NULL OR (v_item->>'rate_source') IS NULL THEN
      RAISE EXCEPTION 'invalid_row: statement row % has no FX valuation', v_row.row_index + 1;
    END IF;
    -- The valuation was computed outside this transaction from (amount, date, currency).
    IF (v_item->>'expected_date') IS DISTINCT FROM to_char(v_row.tx_date, 'YYYY-MM-DD') THEN
      RAISE EXCEPTION 'row_changed: statement row % date changed after validation', v_row.row_index + 1;
    END IF;
    IF upper(coalesce(v_item->>'currency', '')) <> v_currency THEN
      RAISE EXCEPTION 'row_changed: statement currency changed after validation (now %)', v_currency;
    END IF;
    v_idr := (v_item->>'amount_idr')::numeric;
    v_rate := nullif(v_item->>'booked_rate', '')::numeric;
    IF v_currency = 'IDR' THEN
      IF v_idr <> round(v_row.amount) THEN
        RAISE EXCEPTION 'invalid_row: statement row % IDR value does not match its amount', v_row.row_index + 1;
      END IF;
    ELSIF v_rate IS NULL OR v_rate <= 0 OR abs(v_idr - round(v_row.amount * v_rate)) > 1 THEN
      RAISE EXCEPTION 'invalid_row: statement row % IDR value does not match amount × rate', v_row.row_index + 1;
    END IF;

    IF v_row.dedup_hash IS NOT NULL THEN
      -- copies of this line already in the ledger from OTHER batches (existing transactions only)
      SELECT count(*) INTO v_other FROM public.bank_import_rows o
        JOIN public.transactions t ON t.id = o.linked_transaction_id
       WHERE o.business_id = p_business_id AND o.batch_id <> p_batch_id AND o.dedup_hash = v_row.dedup_hash;
      IF v_other > 0 THEN
        SELECT count(*) INTO v_in_batch FROM public.bank_import_rows
         WHERE batch_id = p_batch_id AND dedup_hash = v_row.dedup_hash;
        SELECT count(*) INTO v_mine FROM public.bank_import_rows o
          JOIN public.transactions t ON t.id = o.linked_transaction_id
         WHERE o.batch_id = p_batch_id AND o.dedup_hash = v_row.dedup_hash;
        IF v_mine + 1 > v_in_batch - v_other THEN
          RAISE EXCEPTION 'duplicate_of_imported_row: statement row % is already imported from another statement batch', v_row.row_index + 1;
        END IF;
      END IF;
    END IF;

    INSERT INTO public.transactions (
      business_id, user_id, created_by_user_id, type,
      amount_original, amount_idr, booked_rate, rate_source, currency_original,
      description, source, wallet_id, scope, category, counterparty_name, transaction_date
    ) VALUES (
      p_business_id, p_owner_user_id, p_actor_user_id, v_type,
      v_row.amount, v_idr, v_rate,
      v_item->>'rate_source', v_currency,
      coalesce(v_row.description, 'Bank import'), v_wallet_name, v_batch.wallet_id, v_scope,
      v_cat_name, v_cp_name, v_row.tx_date
    ) RETURNING id INTO v_tx_id;

    UPDATE public.bank_import_rows SET
      final_transaction_type = v_type, final_category_id = v_cat_id,
      final_counterparty_id = v_cp_id, final_scope = v_scope,
      review_status = 'imported', linked_transaction_id = v_tx_id,
      match_status = CASE WHEN p_flow = 'legacy' THEN 'confirmed' ELSE match_status END,
      reviewed_by_user_id = p_actor_user_id, reviewed_at = v_now
     WHERE id = v_row.id;
    v_imported := v_imported + 1;
    v_signed := v_signed + CASE WHEN v_type = 'income' THEN v_row.amount ELSE -v_row.amount END;
  END LOOP;

  IF v_imported + v_linked + v_excluded = 0 THEN
    -- Everything requested was already processed: a replay. Nothing is written.
    RETURN jsonb_build_object('ok', true, 'already_processed', true, 'imported', 0, 'linked', 0,
      'excluded', 0, 'skipped', v_skipped, 'status', v_batch.status, 'reconciliation', NULL);
  END IF;

  IF v_batch.opening_balance IS NOT NULL AND v_batch.closing_balance IS NOT NULL THEN
    v_computed := v_batch.opening_balance + v_signed;
    v_diff := v_batch.closing_balance - v_computed;
    INSERT INTO public.bank_reconciliations (
      batch_id, business_id, wallet_id, opening_balance, closing_balance,
      computed_closing, difference, status
    ) VALUES (
      v_batch.id, p_business_id, v_batch.wallet_id, v_batch.opening_balance, v_batch.closing_balance,
      v_computed, v_diff, CASE WHEN abs(v_diff) < 1 THEN 'balanced' ELSE 'unbalanced' END
    ) RETURNING * INTO v_rec;
    v_rec_json := to_jsonb(v_rec);
  END IF;

  IF p_flow = 'legacy' THEN
    SELECT count(*) INTO v_remaining FROM public.bank_import_rows
     WHERE batch_id = v_batch.id AND match_status = 'review_required' AND linked_transaction_id IS NULL;
  ELSE
    SELECT count(*) INTO v_remaining FROM public.bank_import_rows
     WHERE batch_id = v_batch.id AND review_status IN ('needs_review', 'suggested', 'high_confidence');
  END IF;
  v_status := CASE WHEN v_remaining > 0 THEN 'partially_imported' ELSE 'imported' END;

  UPDATE public.bank_import_batches SET
    imported_count = coalesce(imported_count, 0) + v_imported,
    status = v_status, updated_at = v_now
   WHERE id = v_batch.id;

  RETURN jsonb_build_object('ok', true, 'already_processed', false,
    'imported', v_imported, 'linked', v_linked, 'excluded', v_excluded, 'skipped', v_skipped,
    'status', v_status, 'reconciliation', v_rec_json);
END;
$$;

-- Only the server (service_role) may call it; never the public PostgREST roles.
REVOKE ALL ON FUNCTION public.rpc_confirm_bank_import(uuid, uuid, bigint, bigint, jsonb, text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.rpc_confirm_bank_import(uuid, uuid, bigint, bigint, jsonb, text) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.rpc_confirm_bank_import(uuid, uuid, bigint, bigint, jsonb, text) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.rpc_confirm_bank_import(uuid, uuid, bigint, bigint, jsonb, text) TO service_role';
  END IF;
END $$;

COMMIT;
