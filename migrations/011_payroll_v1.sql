-- TASK: Payroll V1 — employees + payments tables
-- Additive only. Does not touch transactions, wallets, or any existing tables.
-- NOTE: users.id is BIGINT (Telegram user ID), wallets.id is UUID

-- ── payroll_employees ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_employees (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           BIGINT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              TEXT    NOT NULL,
  role              TEXT    NULL,
  default_salary    NUMERIC NULL,
  currency          TEXT    DEFAULT 'IDR',
  pay_day           INTEGER NULL,                          -- day of month, 1–31
  default_wallet_id UUID    NULL REFERENCES wallets(id),
  status            TEXT    DEFAULT 'active' CHECK (status IN ('active','inactive','archived')),
  notes             TEXT    NULL,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payroll_employees_user_id_idx ON payroll_employees(user_id);

-- ── payroll_payments ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_payments (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        BIGINT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employee_id    UUID    NULL REFERENCES payroll_employees(id),
  transaction_id BIGINT  NULL REFERENCES transactions(id),
  employee_name  TEXT    NOT NULL,
  amount         NUMERIC NOT NULL,
  currency       TEXT    DEFAULT 'IDR',
  payment_type   TEXT    DEFAULT 'salary'
                   CHECK (payment_type IN ('salary','bonus','advance','commission','other')),
  period_month   TEXT    NULL,   -- e.g. '2026-06'
  payment_date   DATE    NULL,
  wallet_id      UUID    NULL REFERENCES wallets(id),
  status         TEXT    DEFAULT 'paid'
                   CHECK (status IN ('draft','scheduled','paid','cancelled')),
  notes          TEXT    NULL,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payroll_payments_user_id_idx     ON payroll_payments(user_id);
CREATE INDEX IF NOT EXISTS payroll_payments_employee_id_idx ON payroll_payments(employee_id);
