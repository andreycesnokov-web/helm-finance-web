-- Helm Finance — SaaS Foundation Migration
-- Date: 2026-06-10
-- Additive only: no DROP, no ALTER COLUMN TYPE, no data loss
-- Tables: businesses, business_members, plan_limits (with seeds)
--
-- Phase 1 bridge: existing financial data remains user_id-scoped.
-- Future migration: transactions/wallets/debts/reminders will move
-- to business_id-scoped model.

-- ── businesses ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS businesses (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  owner_user_id       BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  name                TEXT        NOT NULL,
  base_currency       TEXT        NOT NULL DEFAULT 'IDR',
  timezone            TEXT        NULL,
  country             TEXT        NULL,

  status              TEXT        NOT NULL DEFAULT 'active',

  -- Billing / plan
  plan                TEXT        NOT NULL DEFAULT 'free',
  trial_status        TEXT        NOT NULL DEFAULT 'active',
  trial_started_at    TIMESTAMPTZ          DEFAULT NOW(),
  trial_ends_at       TIMESTAMPTZ          DEFAULT (NOW() + INTERVAL '7 days'),
  subscription_status TEXT        NOT NULL DEFAULT 'trialing',

  created_at          TIMESTAMPTZ          DEFAULT NOW(),
  updated_at          TIMESTAMPTZ          DEFAULT NOW()
);

-- ── business_members ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_members (
  id                   UUID   PRIMARY KEY DEFAULT gen_random_uuid(),

  business_id          UUID   NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id              BIGINT NOT NULL REFERENCES users(id)     ON DELETE CASCADE,

  role                 TEXT   NOT NULL DEFAULT 'owner',
  -- Allowed: owner, admin, accountant, manager, employee, auditor
  status               TEXT   NOT NULL DEFAULT 'active',

  invited_by_user_id   BIGINT NULL     REFERENCES users(id),

  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(business_id, user_id)
);

-- ── plan_limits ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plan_limits (
  plan                        TEXT PRIMARY KEY,

  -- Capacity limits (NULL = unlimited)
  max_businesses              INT  NULL,
  max_users                   INT  NULL,
  max_wallets                 INT  NULL,
  max_transactions_per_month  INT  NULL,
  max_invoices_per_month      INT  NULL,
  max_ai_questions_per_month  INT  NULL,
  max_voice_inputs_per_month  INT  NULL,

  -- Feature flags
  payroll_enabled             BOOLEAN DEFAULT FALSE,
  team_access_enabled         BOOLEAN DEFAULT FALSE,
  approval_flow_enabled       BOOLEAN DEFAULT FALSE,
  advanced_radar_enabled      BOOLEAN DEFAULT FALSE,
  export_enabled              BOOLEAN DEFAULT FALSE,
  integrations_enabled        BOOLEAN DEFAULT FALSE,

  created_at                  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Seed plan_limits ──────────────────────────────────────────────────────────
-- ON CONFLICT DO NOTHING makes this safe to re-run
INSERT INTO plan_limits (
  plan,
  max_businesses, max_users, max_wallets,
  max_transactions_per_month, max_invoices_per_month,
  max_ai_questions_per_month, max_voice_inputs_per_month,
  payroll_enabled, team_access_enabled, approval_flow_enabled,
  advanced_radar_enabled, export_enabled, integrations_enabled
) VALUES
  -- free: permanent minimal access after trial
  ('free',        1,   1,    1,    30,    3,    10,   10,   false, false, false, false, false, false),
  -- starter: solo founder, light usage
  ('starter',     2,   3,    5,   300,   30,   100,  100,  false, false, false, false, false, false),
  -- business: small team, full ops
  ('business',    3,  20,   20,  2000,  200,   500,  500,  true,  true,  true,  false, true,  false),
  -- founder: multi-entity power user
  ('founder',    10, 100,  100, 10000, 1000,  2000, 2000,  true,  true,  true,  true,  true,  true),
  -- enterprise: unlimited
  ('enterprise', NULL, NULL, NULL, NULL, NULL, NULL, NULL,  true,  true,  true,  true,  true,  true)
ON CONFLICT (plan) DO NOTHING;

-- ── Verification queries (run after migration to confirm) ─────────────────────
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_name IN ('businesses','business_members','plan_limits')
-- ORDER BY table_name;
--
-- SELECT plan, max_wallets, payroll_enabled, team_access_enabled
-- FROM plan_limits ORDER BY plan;
