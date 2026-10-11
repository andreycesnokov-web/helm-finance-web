-- Migration 014 — Business invite system
-- Date: 2026-06-11
-- Additive only — no DROP, no ALTER COLUMN

CREATE TABLE IF NOT EXISTS business_invites (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  invited_by   BIGINT      NOT NULL,   -- users.id (BIGINT)
  code         TEXT        NOT NULL UNIQUE,
  role         TEXT        NOT NULL DEFAULT 'employee',
  label        TEXT        DEFAULT NULL,  -- optional note: "For accountant Fenia"
  max_uses     INT         DEFAULT 1,
  uses_count   INT         DEFAULT 0,
  expires_at   TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
  status       TEXT        NOT NULL DEFAULT 'active',  -- active | revoked | exhausted
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast code lookup
CREATE INDEX IF NOT EXISTS business_invites_code_idx ON business_invites(code);
CREATE INDEX IF NOT EXISTS business_invites_business_idx ON business_invites(business_id);

-- Add display_name to business_members if missing (used for team roster)
ALTER TABLE business_members ADD COLUMN IF NOT EXISTS display_name TEXT DEFAULT NULL;
ALTER TABLE business_members ADD COLUMN IF NOT EXISTS joined_at    TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE business_members ADD COLUMN IF NOT EXISTS invited_by   BIGINT DEFAULT NULL;
ALTER TABLE business_members ADD COLUMN IF NOT EXISTS invite_code  TEXT DEFAULT NULL;

-- Verify
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'business_invites';
