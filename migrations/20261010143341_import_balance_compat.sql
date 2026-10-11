-- Local integration compatibility. Apply AFTER 069, 070 balance, 071 restrict.
-- Prior migration files are unchanged. No historical backfill.
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

  -- Global ledger gate FIRST, before batch/row/link locks.
  PERFORM public.fn_ledger_writer_lock();
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
    IF v_action IN ('create','link') AND (v_scope <> 'business'
      OR (v_row.direction='in' AND v_type <> 'income')
      OR (v_row.direction='out' AND v_type NOT IN ('expense','payroll'))
      OR v_row.direction IS NULL OR v_row.direction NOT IN ('in','out')) THEN
      RAISE EXCEPTION 'invalid_row: Cash direction/type/scope mismatch';
    END IF;

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
      SELECT id, business_id, wallet_id, amount_original, type, currency_original, transaction_date INTO v_match
        FROM public.transactions WHERE id = v_match_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'link_target_not_found: transaction % does not exist', v_match_id;
      END IF;
      IF v_match.business_id IS DISTINCT FROM p_business_id THEN
        RAISE EXCEPTION 'isolation_violation: matched transaction belongs to another business';
      END IF;
      IF v_match.wallet_id IS DISTINCT FROM v_batch.wallet_id THEN
        RAISE EXCEPTION 'link_mismatch: matched transaction belongs to a different wallet';
      END IF;
      IF v_match.type IS NOT NULL AND v_match.type <> v_type THEN
        RAISE EXCEPTION 'link_mismatch: matched transaction type % does not match row type %', v_match.type, v_type;
      END IF;
      IF v_match.amount_original IS NULL OR v_match.amount_original <> v_row.amount
        OR upper(v_match.currency_original) IS DISTINCT FROM v_currency
        OR v_match.transaction_date IS DISTINCT FROM v_row.tx_date THEN
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
      description, source, wallet_id, scope, category, counterparty_name, transaction_date, bank_import_row_id
    ) VALUES (
      p_business_id, p_owner_user_id, p_actor_user_id, v_type,
      v_row.amount, v_idr, v_rate,
      v_item->>'rate_source', v_currency,
      coalesce(v_row.description, 'Bank import'), v_wallet_name, v_batch.wallet_id, v_scope,
      v_cat_name, v_cp_name, v_row.tx_date, v_row.id
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
    -- Snapshot includes earlier partial confirms, not just this request.
    SELECT COALESCE(sum(CASE r.direction WHEN 'in' THEN r.amount ELSE -r.amount END),0) INTO v_signed
      FROM public.bank_import_rows r JOIN public.transactions t ON t.id=r.linked_transaction_id
      WHERE r.batch_id=v_batch.id AND r.business_id=p_business_id
        AND r.review_status IN ('imported','matched_existing');
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



-- A provenance ID is immutable and one bank row can create only one ledger row.
CREATE UNIQUE INDEX IF NOT EXISTS transactions_bank_import_row_unique
  ON public.transactions(bank_import_row_id) WHERE bank_import_row_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_import_provenance_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.bank_import_row_id IS DISTINCT FROM OLD.bank_import_row_id THEN
      RAISE EXCEPTION 'invalid_import_provenance: Provenance cannot be attached, removed or reassigned by UPDATE';
    END IF;
    IF OLD.bank_import_row_id IS NOT NULL AND
      ROW(NEW.business_id,NEW.wallet_id,NEW.type,NEW.scope,NEW.amount_original,NEW.currency_original,
        NEW.transaction_date,NEW.amount_idr,NEW.booked_rate,NEW.rate_source,NEW.source)
      IS DISTINCT FROM
      ROW(OLD.business_id,OLD.wallet_id,OLD.type,OLD.scope,OLD.amount_original,OLD.currency_original,
        OLD.transaction_date,OLD.amount_idr,OLD.booked_rate,OLD.rate_source,OLD.source) THEN
      RAISE EXCEPTION 'invalid_import_provenance: Imported financial fields are immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.bank_import_row_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.bank_import_rows r JOIN public.bank_import_batches b ON b.id=r.batch_id
      JOIN public.businesses co ON co.id=b.business_id
      JOIN public.wallets w ON w.id=b.wallet_id AND w.business_id=b.business_id
    WHERE r.id=NEW.bank_import_row_id AND r.business_id=NEW.business_id AND b.business_id=NEW.business_id
      AND co.type <> 'personal' AND NEW.scope='business' AND w.scope='business'
      AND b.wallet_id=NEW.wallet_id AND upper(b.currency)=upper(NEW.currency_original)
      AND upper(w.currency)=upper(NEW.currency_original)
      AND r.amount=NEW.amount_original AND r.amount>0 AND r.tx_date=NEW.transaction_date
      AND ((r.direction='in' AND NEW.type='income') OR (r.direction='out' AND NEW.type IN ('expense','payroll')))
      AND r.linked_transaction_id IS NULL
      AND b.status IN ('uploaded','review_required','partially_imported')
      AND r.review_status IN ('unprocessed','confirmed','needs_review','suggested','high_confidence','matched_existing')
  ) THEN RAISE EXCEPTION 'invalid_import_provenance: Bank evidence/direction/state does not match'; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS bank_import_provenance_guard ON public.transactions;
CREATE TRIGGER bank_import_provenance_guard BEFORE INSERT OR UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.fn_import_provenance_guard();

-- The RPC inserts the ledger, then records the bank-row link in the SAME transaction.
-- At commit require the reciprocal link; a valid-looking ID on a standalone INSERT
-- is not enough. No caller-controlled GUC flag grants an import exemption.
CREATE OR REPLACE FUNCTION public.fn_check_import_pair(p_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE t public.transactions;
BEGIN
  SELECT * INTO t FROM public.transactions WHERE id=p_id;
  IF NOT FOUND OR t.bank_import_row_id IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bank_import_rows r JOIN public.bank_import_batches b ON b.id=r.batch_id
    WHERE r.id=t.bank_import_row_id AND r.linked_transaction_id=t.id AND r.review_status='imported'
      AND r.final_transaction_type=t.type AND r.business_id=t.business_id AND b.business_id=t.business_id
      AND b.wallet_id=t.wallet_id AND upper(b.currency)=upper(t.currency_original)
      AND r.amount=t.amount_original AND r.tx_date=t.transaction_date
      AND ((r.direction='in' AND t.type='income') OR (r.direction='out' AND t.type IN ('expense','payroll')))) THEN
    RAISE EXCEPTION 'invalid_import_provenance: Reciprocal confirmed bank-row link required at commit';
  END IF;
END; $$;
CREATE OR REPLACE FUNCTION public.fn_import_pair_constraint() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE t record;
BEGIN
  IF TG_TABLE_NAME='transactions' THEN
    PERFORM public.fn_check_import_pair(NEW.id);
  ELSIF TG_TABLE_NAME='bank_import_batches' THEN
    FOR t IN SELECT tx.id FROM public.transactions tx JOIN public.bank_import_rows r ON r.id=tx.bank_import_row_id WHERE r.batch_id=NEW.id LOOP
      PERFORM public.fn_check_import_pair(t.id);
    END LOOP;
  ELSE
    FOR t IN SELECT id FROM public.transactions WHERE bank_import_row_id=NEW.id LOOP
      PERFORM public.fn_check_import_pair(t.id);
    END LOOP;
  END IF;
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS import_pair_constraint ON public.transactions;
CREATE CONSTRAINT TRIGGER import_pair_constraint AFTER INSERT OR UPDATE ON public.transactions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fn_import_pair_constraint();
DROP TRIGGER IF EXISTS import_pair_constraint ON public.bank_import_rows;
CREATE CONSTRAINT TRIGGER import_pair_constraint AFTER UPDATE ON public.bank_import_rows
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fn_import_pair_constraint();
DROP TRIGGER IF EXISTS import_pair_constraint ON public.bank_import_batches;
CREATE CONSTRAINT TRIGGER import_pair_constraint AFTER UPDATE ON public.bank_import_batches
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fn_import_pair_constraint();
-- Source metadata writers join the same gate before tuple locks. Prevents the
-- common bank-row UPDATE -> ledger / confirm -> bank-row lock inversion.
DROP TRIGGER IF EXISTS bank_rows_writer_gate ON public.bank_import_rows;
CREATE TRIGGER bank_rows_writer_gate BEFORE INSERT OR UPDATE OR DELETE ON public.bank_import_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ledger_writer_statement();
DROP TRIGGER IF EXISTS bank_batches_writer_gate ON public.bank_import_batches;
CREATE TRIGGER bank_batches_writer_gate BEFORE INSERT OR UPDATE OR DELETE ON public.bank_import_batches
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ledger_writer_statement();
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('fn_import_provenance_guard','fn_check_import_pair','fn_import_pair_constraint') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',r.signature);
  END LOOP;
END; $$;
COMMIT;
