-- Migration 056 — AI usage counters (monthly, per business + feature)
-- Date: 2026-09-11
-- Additive + idempotent. No DROP, no data loss, no change to any plan or limit.
--
-- PREPARED FOR REVIEW — NOT APPLIED TO PRODUCTION.
--
-- Why this exists
-- ---------------
-- `plan_limits.max_ai_questions_per_month` has existed since the plan tables were
-- introduced and has never been enforced. server/index.js says so in as many
-- words at the AI CFO ask endpoint:
--
--     // V1 limitation: ai_questions_this_month is not tracked in DB.
--     // Skipped intentionally to not block users in V1.
--
-- So the column is policy with nothing behind it. This migration adds the
-- counter that makes it real. It does NOT change the policy: every limit value
-- stays exactly as the plan defines it, and NULL keeps meaning unlimited.
--
-- Why a counter table and not a COUNT(*) over a log
-- -------------------------------------------------
-- The check has to be safe against concurrent requests. Counting rows and then
-- deciding is a read-then-write race: ten questions fired at once all read the
-- same count, all pass, and the limit is exceeded by nine. A single row per
-- (business, feature, month) with an atomic UPSERT..RETURNING makes the row
-- itself the lock — every caller gets a distinct, increasing number back, and
-- the one that receives a number above the limit is the one that is refused.
--
-- Scope
-- -----
-- Counted per BUSINESS, not per user: the limit belongs to the business's plan,
-- and counting per user would let a three-seat workspace spend three times its
-- allowance. user_id is recorded on the row that created the period only, for
-- support; it is not part of the key.

CREATE TABLE IF NOT EXISTS ai_usage_counters (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  feature       TEXT NOT NULL,                -- 'ai_cfo_ask' | 'ai_accountant_ask'
  period_month  DATE NOT NULL,                -- first day of the UTC month
  used          INTEGER NOT NULL DEFAULT 0,
  first_user_id BIGINT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_usage_counters_used_non_negative CHECK (used >= 0),
  CONSTRAINT ai_usage_counters_unique UNIQUE (business_id, feature, period_month)
);

CREATE INDEX IF NOT EXISTS ai_usage_counters_lookup_idx
  ON ai_usage_counters(business_id, feature, period_month);

-- Atomic reserve-one. Returns the counter value AFTER the increment, so the
-- caller compares that number against its limit: value <= limit means this
-- request holds a valid slot, value > limit means it does not.
--
-- The whole check lives inside one statement on purpose. Any version that reads
-- first and writes second reintroduces the race this table exists to close.
CREATE OR REPLACE FUNCTION reserve_ai_usage(
  p_business_id UUID,
  p_feature     TEXT,
  p_period      DATE,
  p_user_id     BIGINT DEFAULT NULL
) RETURNS INTEGER
LANGUAGE sql
AS $$
  INSERT INTO ai_usage_counters (business_id, feature, period_month, used, first_user_id)
  VALUES (p_business_id, p_feature, p_period, 1, p_user_id)
  ON CONFLICT (business_id, feature, period_month)
  DO UPDATE SET used = ai_usage_counters.used + 1, updated_at = NOW()
  RETURNING used;
$$;

-- Give a slot back when the work it was reserved for never happened — the
-- provider was unreachable, so the user was charged a question for nothing.
-- Floored at zero by the CHECK plus the GREATEST here, so a double release can
-- never manufacture allowance.
CREATE OR REPLACE FUNCTION release_ai_usage(
  p_business_id UUID,
  p_feature     TEXT,
  p_period      DATE
) RETURNS INTEGER
LANGUAGE sql
AS $$
  UPDATE ai_usage_counters
     SET used = GREATEST(0, used - 1), updated_at = NOW()
   WHERE business_id = p_business_id AND feature = p_feature AND period_month = p_period
  RETURNING used;
$$;

-- Read-only: what a business has spent this period, for the UI.
CREATE OR REPLACE FUNCTION get_ai_usage(
  p_business_id UUID,
  p_feature     TEXT,
  p_period      DATE
) RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE((
    SELECT used FROM ai_usage_counters
     WHERE business_id = p_business_id AND feature = p_feature AND period_month = p_period
  ), 0);
$$;
