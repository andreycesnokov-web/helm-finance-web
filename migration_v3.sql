-- Debts & Receivables
CREATE TABLE IF NOT EXISTS debts (
  id SERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('receivable', 'payable')),
  counterparty TEXT NOT NULL,
  description TEXT,
  amount DECIMAL(18,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'IDR',
  due_date TIMESTAMPTZ,
  scope TEXT DEFAULT 'personal',
  is_settled BOOLEAN DEFAULT FALSE,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reminders
CREATE TABLE IF NOT EXISTS reminders (
  id SERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  meta TEXT,
  due_date TIMESTAMPTZ,
  is_recurring BOOLEAN DEFAULT FALSE,
  recur_interval TEXT,
  scope TEXT DEFAULT 'personal',
  is_done BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_debts_user ON debts(user_id, is_settled);
CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id, is_done);

-- Account type column (needed for scope switcher)
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'personal';
UPDATE accounts SET type = 'business' WHERE name ILIKE '%helm%' OR name ILIKE '%business%';
