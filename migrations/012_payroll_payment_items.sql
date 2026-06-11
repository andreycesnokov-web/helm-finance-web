-- TASK: Payroll V1.1 — payment line items + gross/deductions/net on payroll_payments
-- Additive only. Backward compatible.

-- ── payroll_payment_items ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_payment_items (
  id                 UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            BIGINT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payroll_payment_id UUID    NULL REFERENCES payroll_payments(id) ON DELETE CASCADE,
  item_type          TEXT    NOT NULL,
  label              TEXT    NOT NULL,
  amount             NUMERIC NOT NULL,
  direction          TEXT    NOT NULL CHECK (direction IN ('addition', 'deduction')),
  notes              TEXT    NULL,
  created_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payroll_payment_items_user_id_idx
  ON payroll_payment_items(user_id);

CREATE INDEX IF NOT EXISTS payroll_payment_items_payment_id_idx
  ON payroll_payment_items(payroll_payment_id);

-- ── Add gross/deductions/net columns to payroll_payments ────────────────────
ALTER TABLE payroll_payments
  ADD COLUMN IF NOT EXISTS gross_amount      NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deduction_amount  NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount        NUMERIC NULL;

-- Backfill existing rows: treat old `amount` as net_amount = gross_amount
UPDATE payroll_payments
SET
  net_amount       = COALESCE(net_amount, amount),
  gross_amount     = COALESCE(NULLIF(gross_amount, 0), amount),
  deduction_amount = COALESCE(deduction_amount, 0)
WHERE net_amount IS NULL OR gross_amount = 0;
