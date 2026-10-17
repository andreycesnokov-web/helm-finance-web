-- ============================================================================
-- AUDIT & RECOVERY PROCEDURE: May 2026 Permata Bank (43 Rows)
-- Target Batch: 08c50e5b-fb33-48b6-a706-005a63b22186 (status: 'imported', broken links)
-- Business: Helm Care Indonesia (b949966a-3988-47cb-9e7c-afad1423f4f8)
-- Wallet: Permata Bank IDR (5be07f47-fd64-424c-9c38-65f3b9ac6f89)
-- Period: 2026-05-02 to 2026-05-31
--
-- Sibling Batches to be Cancelled/Superseded:
-- 1. 126e17c2-d431-45df-8aac-39296fc23fdb (status: 'review_required')
-- 2. 92ffe450-ec6e-447d-9a34-41988585b80a (status: 'review_required')
-- 3. c66fac13-f05f-4892-a50e-9611ca651e3f (status: 'review_required')
-- 4. adff513f-c30c-47af-9902-8073b0e6f171 (status: 'review_required')
--
-- Safety Guarantees:
-- 1. Atomic Transaction (BEGIN ... COMMIT) with automatic rollback on error.
-- 2. Concurrency Protection:
--    - Transaction-scoped advisory lock on (wallet_id, '2026-05') to block ANY import
--      or restore attempt across all connections.
--    - Row-level locks (FOR UPDATE) across all 5 May batches.
-- 3. Pre-condition Verification:
--    - Zero live transactions in May 2026 for this wallet.
--    - Zero valid/active links pointing to live transactions.
-- 4. Audit & Restoration Journal:
--    - Creates bank_import_restoration_journal table (if not exists).
--    - Logs previous (broken) linked_transaction_id and new restored transaction id.
-- 5. Strict 1:1 Linkage by row_id:
--    - Iterates 43 rows ordered by row_index, creates transaction, updates bank_import_rows.
-- 6. Mutual Protection:
--    - Marks 4 sibling batches as 'cancelled' with error 'superseded_by_08c50e5b'.
--    - Marks sibling rows as 'duplicate_superseded' to prevent competing imports.
-- 7. Dynamic Reconciliation:
--    - Calculates opening + sum(in) - sum(out) = closing balance.
--    - Inserts audit record into bank_reconciliations with verified difference = 0.
-- ============================================================================

-- Ensure restoration journal table exists for audit compliance
CREATE TABLE IF NOT EXISTS bank_import_restoration_journal (
  id BIGSERIAL PRIMARY KEY,
  batch_id UUID NOT NULL,
  row_id UUID NOT NULL,
  row_index INT NOT NULL,
  old_linked_transaction_id BIGINT,
  new_linked_transaction_id BIGINT NOT NULL,
  tx_date DATE NOT NULL,
  amount NUMERIC NOT NULL,
  direction TEXT NOT NULL,
  bank_reference TEXT,
  restored_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
DECLARE
  v_target_batch_id UUID := '08c50e5b-fb33-48b6-a706-005a63b22186';
  v_business_id     UUID := 'b949966a-3988-47cb-9e7c-afad1423f4f8';
  v_wallet_id       UUID := '5be07f47-fd64-424c-9c38-65f3b9ac6f89';
  v_sibling_batch_ids UUID[] := ARRAY[
    '126e17c2-d431-45df-8aac-39296fc23fdb'::UUID,
    '92ffe450-ec6e-447d-9a34-41988585b80a'::UUID,
    'c66fac13-f05f-4892-a50e-9611ca651e3f'::UUID,
    'adff513f-c30c-47af-9902-8073b0e6f171'::UUID
  ];
  v_batch_record    RECORD;
  v_row_record      RECORD;
  v_new_tx_id       BIGINT;
  v_sum_in          NUMERIC := 0;
  v_sum_out         NUMERIC := 0;
  v_computed_close  NUMERIC;
  v_difference      NUMERIC;
  v_rec_status      TEXT;
  v_inserted_count  INT := 0;
  v_existing_tx_cnt INT;
  v_live_links_cnt  INT;
  v_sibling_id      UUID;
BEGIN
  -- 1. Mutual Concurrency Protection:
  -- Acquire transaction-level advisory lock on (wallet_id, '2026-05') hash.
  -- This locks the entire wallet-month scope across ALL sessions.
  PERFORM pg_advisory_xact_lock(hashtext('bank_statement_wallet_period_' || v_wallet_id::text || '_2026-05'));
  PERFORM pg_advisory_xact_lock(hashtext('bank_import_batch_' || v_target_batch_id::text));

  -- 2. Lock ALL five May batches FOR UPDATE to prevent concurrent modifications
  SELECT id, wallet_id, opening_balance, closing_balance, status, statement_start, statement_end
  INTO v_batch_record
  FROM bank_import_batches
  WHERE id = v_target_batch_id AND business_id = v_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ABORT: Target batch % not found for business %', v_target_batch_id, v_business_id;
  END IF;

  -- Lock all sibling batches
  PERFORM id
  FROM bank_import_batches
  WHERE id = ANY(v_sibling_batch_ids) AND business_id = v_business_id
  FOR UPDATE;

  -- 3. Check transactions table for existing live records in May 2026
  SELECT COUNT(*) INTO v_existing_tx_cnt
  FROM transactions
  WHERE business_id = v_business_id
    AND wallet_id = v_wallet_id
    AND transaction_date >= '2026-05-01'
    AND transaction_date <= '2026-05-31';

  IF v_existing_tx_cnt > 0 THEN
    RAISE EXCEPTION 'ABORT: % existing transactions already found for wallet % in May 2026', v_existing_tx_cnt, v_wallet_id;
  END IF;

  -- 4. Check if any row in target batch already points to an EXISTING live transaction
  SELECT COUNT(*) INTO v_live_links_cnt
  FROM bank_import_rows r
  JOIN transactions t ON t.id = r.linked_transaction_id
  WHERE r.batch_id = v_target_batch_id;

  IF v_live_links_cnt > 0 THEN
    RAISE EXCEPTION 'ABORT: Target batch % has % links to existing live transactions', v_target_batch_id, v_live_links_cnt;
  END IF;

  -- Also check if any sibling batch created live transactions
  SELECT COUNT(*) INTO v_live_links_cnt
  FROM bank_import_rows r
  JOIN transactions t ON t.id = r.linked_transaction_id
  WHERE r.batch_id = ANY(v_sibling_batch_ids);

  IF v_live_links_cnt > 0 THEN
    RAISE EXCEPTION 'ABORT: Sibling batches have % links to existing live transactions', v_live_links_cnt;
  END IF;

  -- 5. Record previous states of all 4 sibling batches into restoration journal before cancelling
  INSERT INTO bank_import_restoration_journal (
    batch_id,
    row_id,
    row_index,
    old_linked_transaction_id,
    new_linked_transaction_id,
    tx_date,
    amount,
    direction,
    bank_reference,
    restored_at
  )
  SELECT
    r.batch_id,
    r.id,
    r.row_index,
    r.linked_transaction_id,
    -1, -- marker indicating cancelled / superseded
    r.tx_date,
    r.amount,
    r.direction,
    'CANCELLED_SIBLING:' || b.status,
    NOW()
  FROM bank_import_rows r
  JOIN bank_import_batches b ON b.id = r.batch_id
  WHERE r.batch_id = ANY(v_sibling_batch_ids);

  -- Cancel and supersede all 4 sibling batches
  UPDATE bank_import_batches
  SET status = 'cancelled',
      error = 'duplicate_superseded_by_08c50e5b',
      updated_at = NOW()
  WHERE id = ANY(v_sibling_batch_ids) AND business_id = v_business_id;

  UPDATE bank_import_rows
  SET review_status = 'duplicate_superseded',
      linked_transaction_id = NULL
  WHERE batch_id = ANY(v_sibling_batch_ids) AND business_id = v_business_id;

  -- 6. Iterate through 43 source rows of target batch ordered by row_index:
  -- - preserve broken linked_transaction_id into journal
  -- - insert new standard transaction
  -- - update row strictly by row.id
  FOR v_row_record IN
    SELECT id, row_index, tx_date, amount, direction, description, bank_reference, linked_transaction_id
    FROM bank_import_rows
    WHERE batch_id = v_target_batch_id
    ORDER BY row_index ASC
    FOR UPDATE
  LOOP
    -- Tally totals
    IF v_row_record.direction = 'in' THEN
      v_sum_in := v_sum_in + v_row_record.amount;
    ELSE
      v_sum_out := v_sum_out + v_row_record.amount;
    END IF;

    -- Insert restored transaction adhering to standard bank import fields
    INSERT INTO transactions (
      business_id,
      wallet_id,
      amount_original,
      amount_idr,
      booked_rate,
      rate_source,
      currency_original,
      type,
      transaction_date,
      description,
      source,
      bank_reference,
      scope,
      is_reconciled
    ) VALUES (
      v_business_id,
      v_wallet_id,
      v_row_record.amount,
      v_row_record.amount,
      1.0,
      'identity',
      'IDR',
      CASE WHEN v_row_record.direction = 'in' THEN 'income' ELSE 'expense' END,
      v_row_record.tx_date,
      v_row_record.description,
      'Permata Bank IDR',
      v_row_record.bank_reference,
      'business',
      FALSE
    ) RETURNING id INTO v_new_tx_id;

    -- Save audit record in restoration journal preserving old broken link
    INSERT INTO bank_import_restoration_journal (
      batch_id,
      row_id,
      row_index,
      old_linked_transaction_id,
      new_linked_transaction_id,
      tx_date,
      amount,
      direction,
      bank_reference,
      restored_at
    ) VALUES (
      v_target_batch_id,
      v_row_record.id,
      v_row_record.row_index,
      v_row_record.linked_transaction_id,
      v_new_tx_id,
      v_row_record.tx_date,
      v_row_record.amount,
      v_row_record.direction,
      v_row_record.bank_reference,
      NOW()
    );

    -- Update target source row strictly by row.id
    UPDATE bank_import_rows
    SET linked_transaction_id = v_new_tx_id,
        review_status = 'imported'
    WHERE id = v_row_record.id;

    v_inserted_count := v_inserted_count + 1;
  END LOOP;

  IF v_inserted_count <> 43 THEN
    RAISE EXCEPTION 'ABORT: Expected 43 rows, but processed %', v_inserted_count;
  END IF;

  -- 7. Dynamic Reconciliation Verification
  v_computed_close := v_batch_record.opening_balance + v_sum_in - v_sum_out;
  v_difference := v_batch_record.closing_balance - v_computed_close;

  IF ABS(v_difference) < 0.01 THEN
    v_rec_status := 'balanced';
  ELSE
    v_rec_status := 'unbalanced';
    RAISE EXCEPTION 'ABORT: Unbalanced statement! Opening: %, In: %, Out: %, Computed: %, Expected: %, Diff: %',
      v_batch_record.opening_balance, v_sum_in, v_sum_out, v_computed_close, v_batch_record.closing_balance, v_difference;
  END IF;

  -- 8. Delete any previous stale reconciliation record for this batch
  DELETE FROM bank_reconciliations WHERE batch_id = v_target_batch_id;

  -- Insert fresh audit record into bank_reconciliations
  INSERT INTO bank_reconciliations (
    batch_id,
    business_id,
    wallet_id,
    opening_balance,
    closing_balance,
    computed_closing,
    difference,
    status
  ) VALUES (
    v_target_batch_id,
    v_business_id,
    v_wallet_id,
    v_batch_record.opening_balance,
    v_batch_record.closing_balance,
    v_computed_close,
    v_difference,
    v_rec_status
  );

  -- 9. Mark all newly inserted transactions as reconciled
  UPDATE transactions
  SET is_reconciled = TRUE
  WHERE id IN (
    SELECT linked_transaction_id
    FROM bank_import_rows
    WHERE batch_id = v_target_batch_id
  );

  -- 10. Update target bank_import_batches status, count, and reconciliation figures
  UPDATE bank_import_batches
  SET status = 'imported',
      imported_count = v_inserted_count,
      reconciliation_status = v_rec_status,
      difference = v_difference,
      error = NULL,
      updated_at = NOW()
  WHERE id = v_target_batch_id;

  RAISE NOTICE 'SUCCESS: Restored % transactions for batch %. Inflow: % IDR, Outflow: % IDR, Closing: % IDR, Diff: %, Status: %',
    v_inserted_count, v_target_batch_id, v_sum_in, v_sum_out, v_computed_close, v_difference, v_rec_status;
END $$;
