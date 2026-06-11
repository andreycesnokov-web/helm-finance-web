-- TASK 39: Business vs Personal Wallet Separation
-- Additive migration — adds scope column with default 'business'.
-- All existing wallets will default to 'business'. No data destruction.

ALTER TABLE wallets
ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'business'
  CHECK (scope IN ('business', 'personal'));
