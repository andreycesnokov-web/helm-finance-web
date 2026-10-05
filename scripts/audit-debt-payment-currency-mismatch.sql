-- Diagnostic query: Find debt repayments where debt currency differs from wallet/transaction currency.
--
-- This script is strictly READ-ONLY. It makes ZERO modifications to the database.
--
-- LIMITATIONS & LINKAGE CONFIDENCE:
-- 1. Linked records (via debts.linked_transaction_id, migration 015+):
--    Identifies currency mismatches between debt.currency and linked transaction/wallet.
--    IMPORTANT: This check verifies currency correspondence between linked records;
--    it does NOT prove the correctness of payment amounts or completeness of partial payment history.
-- 2. Insufficient Linkage / Ambiguous:
--    - Debts with `paid_amount > 0` but `linked_transaction_id IS NULL` (legacy rows).
--    - Debts with multiple partial payments: `linked_transaction_id` only tracks the LAST payment.
--      Earlier payments cannot be reliably matched without human reconciliation.

-- 1. High Confidence Mismatches (via debts.linked_transaction_id)
SELECT
  d.id AS debt_id,
  d.business_id,
  d.type AS debt_type,
  d.counterparty,
  COALESCE(d.currency, 'IDR') AS debt_currency,
  d.original_amount AS debt_original_amount,
  d.paid_amount AS debt_paid_amount,
  d.status AS debt_status,
  d.linked_transaction_id,
  t.id AS tx_id,
  t.amount_original AS tx_amount_original,
  t.currency_original AS tx_currency,
  t.amount_idr AS tx_amount_idr,
  t.wallet_id,
  w.name AS wallet_name,
  COALESCE(w.currency, 'IDR') AS wallet_currency,
  t.transaction_date,
  CASE
    WHEN UPPER(COALESCE(d.currency, 'IDR')) <> UPPER(COALESCE(w.currency, 'IDR')) THEN 'MISMATCH_DEBT_VS_WALLET'
    WHEN UPPER(COALESCE(d.currency, 'IDR')) <> UPPER(COALESCE(t.currency_original, 'IDR')) THEN 'MISMATCH_DEBT_VS_TX'
    ELSE 'MATCH'
  END AS anomaly_type
FROM public.debts d
JOIN public.transactions t ON t.id = d.linked_transaction_id
LEFT JOIN public.wallets w ON w.id = t.wallet_id
WHERE d.paid_amount > 0
  AND (
    UPPER(COALESCE(d.currency, 'IDR')) <> UPPER(COALESCE(w.currency, 'IDR'))
    OR UPPER(COALESCE(d.currency, 'IDR')) <> UPPER(COALESCE(t.currency_original, 'IDR'))
  )
ORDER BY d.created_at DESC;

-- 2. Insufficient Linkage: Paid debts lacking linked_transaction_id
-- CAUTION: Do NOT attempt automated backfill; manual accountant review required.
SELECT
  d.id AS debt_id,
  d.business_id,
  d.counterparty,
  COALESCE(d.currency, 'IDR') AS debt_currency,
  d.original_amount,
  d.paid_amount,
  d.status,
  d.last_payment_at,
  'UNLINKED_PAYMENT_CANNOT_PROVE_CURRENCY_MATCH' AS audit_note
FROM public.debts d
WHERE d.paid_amount > 0
  AND d.linked_transaction_id IS NULL
ORDER BY d.created_at DESC;

-- 3. Summary metrics across the business database
SELECT
  COUNT(*) FILTER (WHERE d.paid_amount > 0) AS total_paid_debts,
  COUNT(*) FILTER (WHERE d.paid_amount > 0 AND d.linked_transaction_id IS NOT NULL) AS debts_with_direct_tx_link,
  COUNT(*) FILTER (WHERE d.paid_amount > 0 AND d.linked_transaction_id IS NULL) AS debts_lacking_tx_link,
  COUNT(*) FILTER (
    WHERE d.paid_amount > 0
      AND d.linked_transaction_id IS NOT NULL
      AND (
        UPPER(COALESCE(d.currency, 'IDR')) <> UPPER(COALESCE(t.currency_original, 'IDR'))
        OR UPPER(COALESCE(d.currency, 'IDR')) <> UPPER(COALESCE(w.currency, 'IDR'))
      )
  ) AS confirmed_currency_mismatches
FROM public.debts d
LEFT JOIN public.transactions t ON t.id = d.linked_transaction_id
LEFT JOIN public.wallets w ON w.id = t.wallet_id;
