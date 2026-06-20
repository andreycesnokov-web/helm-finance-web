-- Migration 037 — Personal Workspace foundation + multi-asset wallet metadata + precision
-- Date: 2026-06-19. ADDITIVE + IDEMPOTENT + TRANSACTIONAL. No DROP, NO seed, NO cash.
-- PROPOSED — NOT APPLIED. Supersedes the earlier IDR-only 037 draft (never applied).
-- Needs businesses(type, base_currency), wallets, transactions, business_members.
--
-- ⚠️ Contains ONE type-widening ALTER (transactions.amount_original / amount_idr
--    DECIMAL(18,2) → NUMERIC(38,18)) required for crypto precision. Non-lossy
--    (2-dp values fit). Gated by approval; compatibility proven in ci_037.

BEGIN;

DO $$ BEGIN
  IF to_regclass('public.businesses') IS NULL OR to_regclass('public.wallets') IS NULL
     OR to_regclass('public.transactions') IS NULL THEN RAISE EXCEPTION '037 needs businesses, wallets, transactions'; END IF;
END $$;

CREATE OR REPLACE FUNCTION fn_is_workspace_type(p_business uuid, p_type text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.businesses WHERE id = p_business AND type = p_type);
$$;

-- ── 1. Wallet multi-asset metadata (fiat | crypto), immutable after first tx ─
ALTER TABLE wallets
  ADD COLUMN IF NOT EXISTS asset_type        TEXT NOT NULL DEFAULT 'fiat' CHECK (asset_type IN ('fiat','crypto')),
  ADD COLUMN IF NOT EXISTS asset_code        TEXT NULL,
  ADD COLUMN IF NOT EXISTS network           TEXT NULL,
  ADD COLUMN IF NOT EXISTS token_contract    TEXT NULL,
  ADD COLUMN IF NOT EXISTS decimal_precision SMALLINT NOT NULL DEFAULT 2 CHECK (decimal_precision BETWEEN 0 AND 18),
  ADD COLUMN IF NOT EXISTS price_source      TEXT NULL;
-- backfill asset_code from the existing currency text
UPDATE wallets SET asset_code = currency WHERE asset_code IS NULL;

-- Immutable asset identity once the wallet has any transaction (must create a new wallet instead).
CREATE OR REPLACE FUNCTION fn_wallet_asset_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF (NEW.asset_code IS DISTINCT FROM OLD.asset_code
      OR NEW.asset_type IS DISTINCT FROM OLD.asset_type
      OR NEW.currency IS DISTINCT FROM OLD.currency
      OR NEW.network IS DISTINCT FROM OLD.network
      OR NEW.decimal_precision IS DISTINCT FROM OLD.decimal_precision)
     AND EXISTS (SELECT 1 FROM public.transactions WHERE wallet_id = OLD.id) THEN
    RAISE EXCEPTION 'wallet asset identity is immutable once it has transactions (create a new wallet)';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_wallet_asset_immutable ON wallets;
CREATE TRIGGER trg_wallet_asset_immutable BEFORE UPDATE ON wallets
  FOR EACH ROW EXECUTE FUNCTION fn_wallet_asset_immutable();

-- ── 2. Transaction precision widening + native/reporting/asset columns ───────
-- Widen the two money columns only if not already NUMERIC(38,18) (idempotent).
DO $$
DECLARE s int;
BEGIN
  SELECT numeric_scale INTO s FROM information_schema.columns
   WHERE table_schema='public' AND table_name='transactions' AND column_name='amount_original';
  IF s IS DISTINCT FROM 18 THEN
    ALTER TABLE public.transactions ALTER COLUMN amount_original TYPE NUMERIC(38,18);
    ALTER TABLE public.transactions ALTER COLUMN amount_idr      TYPE NUMERIC(38,18);
  END IF;
END $$;
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS asset_code        TEXT NULL,             -- native asset of the leg
  ADD COLUMN IF NOT EXISTS amount_reporting  NUMERIC(38,18) NULL,   -- value in the workspace reporting currency
  ADD COLUMN IF NOT EXISTS reporting_currency TEXT NULL,
  ADD COLUMN IF NOT EXISTS fx_quote_id       UUID NULL;             -- FK added in 038 (after quotes exist)
-- legacy rows: native asset = the original currency
UPDATE transactions SET asset_code = currency_original WHERE asset_code IS NULL;

-- ── 3. user_workspace_preferences ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_workspace_preferences (
  user_id                       BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  primary_personal_workspace_id UUID NULL REFERENCES businesses(id) ON DELETE SET NULL,
  default_business_workspace_id UUID NULL REFERENCES businesses(id) ON DELETE SET NULL,
  last_active_workspace_id      UUID NULL REFERENCES businesses(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE OR REPLACE FUNCTION fn_uwp_type_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.primary_personal_workspace_id IS NOT NULL AND NOT fn_is_workspace_type(NEW.primary_personal_workspace_id,'personal')
    THEN RAISE EXCEPTION 'primary_personal_workspace must be type=personal'; END IF;
  IF NEW.default_business_workspace_id IS NOT NULL AND NOT fn_is_workspace_type(NEW.default_business_workspace_id,'business')
    THEN RAISE EXCEPTION 'default_business_workspace must be type=business'; END IF;
  NEW.updated_at := now(); RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_uwp_type_guard ON user_workspace_preferences;
CREATE TRIGGER trg_uwp_type_guard BEFORE INSERT OR UPDATE ON user_workspace_preferences
  FOR EACH ROW EXECUTE FUNCTION fn_uwp_type_guard();

-- ── 4. personal_business_relationships (+ normalized roles) ─────────────────
CREATE TABLE IF NOT EXISTS personal_business_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  personal_workspace_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  business_id           UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','rejected','revoked')),
  requested_by_user_id BIGINT NULL, confirmed_by_user_id BIGINT NULL,
  requested_at TIMESTAMPTZ DEFAULT now(), confirmed_at TIMESTAMPTZ NULL, rejected_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(),
  CHECK (personal_workspace_id <> business_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pbr_pair_uidx ON personal_business_relationships(personal_workspace_id, business_id);
CREATE INDEX IF NOT EXISTS pbr_business_idx ON personal_business_relationships(business_id, status);
CREATE OR REPLACE FUNCTION fn_pbr_type_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT fn_is_workspace_type(NEW.personal_workspace_id,'personal') THEN RAISE EXCEPTION 'personal_workspace_id must be type=personal'; END IF;
  IF NOT fn_is_workspace_type(NEW.business_id,'business') THEN RAISE EXCEPTION 'business_id must be type=business'; END IF;
  NEW.updated_at := now(); RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pbr_type_guard ON personal_business_relationships;
CREATE TRIGGER trg_pbr_type_guard BEFORE INSERT OR UPDATE ON personal_business_relationships
  FOR EACH ROW EXECUTE FUNCTION fn_pbr_type_guard();

CREATE TABLE IF NOT EXISTS personal_business_relationship_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id UUID NOT NULL REFERENCES personal_business_relationships(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN
    ('founder','co_founder','shareholder','ceo','director','commissioner','investor','lender','beneficial_owner','employee','other')),
  created_at TIMESTAMPTZ DEFAULT now(), created_by_user_id BIGINT NULL,
  UNIQUE (relationship_id, role)
);

-- ── 5. Personal owner-only membership guard (replaceable by a Family policy) ─
CREATE OR REPLACE FUNCTION fn_personal_owner_only_membership() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_type text; v_owner bigint;
BEGIN
  SELECT type, owner_user_id INTO v_type, v_owner FROM public.businesses WHERE id = NEW.business_id;
  IF v_type='personal' AND NEW.user_id IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'personal workspace is owner-only in V1 (no non-owner members)'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_personal_owner_only ON business_members;
CREATE TRIGGER trg_personal_owner_only BEFORE INSERT OR UPDATE ON business_members
  FOR EACH ROW EXECUTE FUNCTION fn_personal_owner_only_membership();

REVOKE ALL ON FUNCTION fn_is_workspace_type(uuid, text) FROM PUBLIC;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION fn_is_workspace_type(uuid, text) TO service_role; END IF; END $$;

COMMIT;

-- ── Verify ───────────────────────────────────────────────────────────────────
SELECT 'wallets.asset_code' AS check, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='wallets' AND column_name='asset_code'))::text AS v
UNION ALL SELECT 'transactions.amount_original scale 18', (SELECT (numeric_scale=18)::text FROM information_schema.columns WHERE table_name='transactions' AND column_name='amount_original')
UNION ALL SELECT 'relationships+roles+prefs', (SELECT (count(*)=3)::text FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('user_workspace_preferences','personal_business_relationships','personal_business_relationship_roles'));
