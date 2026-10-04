-- Diagnostic query: Find transactions where currency is non-IDR but amount_idr equals amount_original
-- (indicates historical bug where write paths set amount_idr = amount without FX conversion).
--
-- This script is READ-ONLY. It makes zero changes to the database.

-- 1. Detailed candidate rows
SELECT
  t.id,
  t.business_id,
  t.wallet_id,
  w.name AS wallet_name,
  w.currency AS wallet_currency,
  t.transaction_date,
  t.type,
  COALESCE(t.currency_original, w.currency) AS effective_currency,
  t.amount_original,
  t.amount_idr,
  t.description,
  t.created_at
FROM public.transactions t
LEFT JOIN public.wallets w ON w.id = t.wallet_id
WHERE (
    (t.currency_original IS NOT NULL AND t.currency_original <> 'IDR')
    OR (w.currency IS NOT NULL AND w.currency <> 'IDR' AND (t.currency_original IS NULL OR t.currency_original = 'IDR'))
  )
  AND t.amount_original IS NOT NULL
  AND t.amount_idr IS NOT NULL
  AND t.amount_original <> 0
  AND t.amount_idr = t.amount_original
ORDER BY t.transaction_date DESC, t.id DESC;

-- 2. Summary count and total skewed volume grouped by currency
SELECT
  COALESCE(t.currency_original, w.currency) AS currency,
  COUNT(*) AS skewed_row_count,
  SUM(t.amount_original) AS total_original_amount,
  SUM(t.amount_idr) AS incorrect_idr_amount
FROM public.transactions t
LEFT JOIN public.wallets w ON w.id = t.wallet_id
WHERE (
    (t.currency_original IS NOT NULL AND t.currency_original <> 'IDR')
    OR (w.currency IS NOT NULL AND w.currency <> 'IDR' AND (t.currency_original IS NULL OR t.currency_original = 'IDR'))
  )
  AND t.amount_original IS NOT NULL
  AND t.amount_idr IS NOT NULL
  AND t.amount_original <> 0
  AND t.amount_idr = t.amount_original
GROUP BY COALESCE(t.currency_original, w.currency)
ORDER BY skewed_row_count DESC;
