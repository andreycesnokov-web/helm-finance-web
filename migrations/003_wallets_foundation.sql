-- Helm Finance — Wallets Foundation Migration
-- Date: 2026-06-10
-- Safe to re-run: all statements use IF NOT EXISTS / ON CONFLICT DO NOTHING
-- No data loss: additive only — no DROP, no ALTER COLUMN TYPE, no data removal
--
-- IMPORTANT: Do NOT seed wallet names from Helm Care DDS.
-- Each user creates their own wallets manually.
-- Backfill from transactions.source is available per-user via /api/wallets/backfill.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. WALLETS TABLE
-- Real wallet/account records per user.
-- No system/global records — every wallet belongs to a specific user.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallets (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      BIGINT      NOT NULL,       -- always user-scoped, never system global
  name         TEXT        NOT NULL,
  currency     TEXT        NOT NULL DEFAULT 'IDR',  -- 'IDR' | 'USD' | 'EUR' | 'SGD' | ...
  type         TEXT        NULL,            -- 'bank' | 'cash' | 'ewallet' | 'payment_gateway' | 'other'
  entity_name  TEXT        NULL,            -- legal entity / company name (optional)
  color        TEXT        NULL,            -- hex color for UI (optional)
  is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
  sort_order   INT         NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ADD wallet_id FK TO TRANSACTIONS
-- Nullable — zero impact on existing rows.
-- Keeps transactions.source TEXT for backward compatibility.
-- wallet_id takes precedence when set; source used for legacy fallback.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS wallet_id UUID NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICATION QUERY
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  c.column_name,
  c.data_type,
  c.is_nullable
FROM information_schema.columns c
WHERE c.table_name IN ('wallets', 'transactions')
  AND c.column_name IN ('wallet_id', 'currency', 'entity_name', 'type', 'is_active')
ORDER BY c.table_name, c.column_name;
