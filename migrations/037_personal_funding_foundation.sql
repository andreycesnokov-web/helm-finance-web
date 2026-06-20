-- Migration 037 — Personal Finance Workspaces & Business Funding Bridge (foundation)
-- Date: 2026-06-19. ADDITIVE + IDEMPOTENT + TRANSACTIONAL. No DROP, NO seed, NO cash.
-- PROPOSED — NOT APPLIED TO PRODUCTION. Needs: businesses(type), wallets, transactions,
-- financial_documents (031). Does NOT modify migrations 031–036 or the 033 intercompany model.
--
-- Personal Workspace = a businesses row with type='personal' (reuses the workspace engine).
-- This migration adds: workspace preferences, the many-to-many personal<->business
-- relationship (normalized roles), the funding ledger (transfers + repayments),
-- an append-only funding audit, a derived balances VIEW, and DB-level privacy/type guards.
-- Outstanding balances are DERIVED (the view) — never stored as source of truth.

BEGIN;

-- Dependency guard.
DO $$ BEGIN
  IF to_regclass('public.businesses') IS NULL OR to_regclass('public.wallets') IS NULL
     OR to_regclass('public.transactions') IS NULL THEN
    RAISE EXCEPTION '037 requires businesses, wallets, transactions to exist';
  END IF;
END $$;

-- ── helper: is a business of a given type? (used by guards) ──────────────────
CREATE OR REPLACE FUNCTION fn_is_workspace_type(p_business uuid, p_type text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.businesses WHERE id = p_business AND type = p_type);
$$;

-- ── 1. user_workspace_preferences (one row per user) ────────────────────────
CREATE TABLE IF NOT EXISTS user_workspace_preferences (
  user_id                       BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  primary_personal_workspace_id UUID NULL REFERENCES businesses(id) ON DELETE SET NULL,
  default_business_workspace_id UUID NULL REFERENCES businesses(id) ON DELETE SET NULL,
  last_active_workspace_id      UUID NULL REFERENCES businesses(id) ON DELETE SET NULL,
  created_at                    TIMESTAMPTZ DEFAULT now(),
  updated_at                    TIMESTAMPTZ DEFAULT now()
);
-- Guard: primary must be personal, default must be business (ON DELETE SET NULL keeps pointers valid).
CREATE OR REPLACE FUNCTION fn_uwp_type_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.primary_personal_workspace_id IS NOT NULL
     AND NOT fn_is_workspace_type(NEW.primary_personal_workspace_id, 'personal') THEN
    RAISE EXCEPTION 'primary_personal_workspace must be type=personal'; END IF;
  IF NEW.default_business_workspace_id IS NOT NULL
     AND NOT fn_is_workspace_type(NEW.default_business_workspace_id, 'business') THEN
    RAISE EXCEPTION 'default_business_workspace must be type=business'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_uwp_type_guard ON user_workspace_preferences;
CREATE TRIGGER trg_uwp_type_guard BEFORE INSERT OR UPDATE ON user_workspace_preferences
  FOR EACH ROW EXECUTE FUNCTION fn_uwp_type_guard();

-- ── 2. personal_business_relationships (many-to-many) ───────────────────────
CREATE TABLE IF NOT EXISTS personal_business_relationships (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  personal_workspace_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  business_id           UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','rejected','revoked')),
  requested_by_user_id  BIGINT NULL,
  confirmed_by_user_id  BIGINT NULL,
  requested_at          TIMESTAMPTZ DEFAULT now(),
  confirmed_at          TIMESTAMPTZ NULL,
  rejected_at           TIMESTAMPTZ NULL,
  revoked_at            TIMESTAMPTZ NULL,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  CHECK (personal_workspace_id <> business_id)
);
-- one live relationship per (personal, business) pair
CREATE UNIQUE INDEX IF NOT EXISTS pbr_pair_uidx ON personal_business_relationships(personal_workspace_id, business_id);
CREATE INDEX IF NOT EXISTS pbr_business_idx ON personal_business_relationships(business_id, status);
-- Guard: personal side must be personal, business side must be business
-- (rejects personal<->personal and business<->business).
CREATE OR REPLACE FUNCTION fn_pbr_type_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT fn_is_workspace_type(NEW.personal_workspace_id, 'personal') THEN
    RAISE EXCEPTION 'personal_workspace_id must be type=personal'; END IF;
  IF NOT fn_is_workspace_type(NEW.business_id, 'business') THEN
    RAISE EXCEPTION 'business_id must be type=business'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pbr_type_guard ON personal_business_relationships;
CREATE TRIGGER trg_pbr_type_guard BEFORE INSERT OR UPDATE ON personal_business_relationships
  FOR EACH ROW EXECUTE FUNCTION fn_pbr_type_guard();

-- ── 3. personal_business_relationship_roles (normalized, multi-role) ─────────
CREATE TABLE IF NOT EXISTS personal_business_relationship_roles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id     UUID NOT NULL REFERENCES personal_business_relationships(id) ON DELETE CASCADE,
  role                TEXT NOT NULL CHECK (role IN
    ('founder','co_founder','shareholder','ceo','director','commissioner','investor','lender','beneficial_owner','employee','other')),
  created_at          TIMESTAMPTZ DEFAULT now(),
  created_by_user_id  BIGINT NULL,
  UNIQUE (relationship_id, role)
);

-- ── 4. funding_transfers (the ledger; legs are created only on confirm) ─────
CREATE TABLE IF NOT EXISTS funding_transfers (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id           UUID NOT NULL REFERENCES personal_business_relationships(id) ON DELETE RESTRICT,
  source_workspace_id       UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,   -- personal
  target_business_id        UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,   -- business
  contributor_user_id       BIGINT NOT NULL,
  funding_type              TEXT NOT NULL CHECK (funding_type IN
    ('shareholder_loan','founder_advance','temporary_funding','capital_contribution')),
  repayable                 BOOLEAN NOT NULL,
  currency                  TEXT NOT NULL DEFAULT 'IDR',
  amount                    NUMERIC(20,2) NOT NULL CHECK (amount > 0),
  status                    TEXT NOT NULL DEFAULT 'draft' CHECK (status IN
    ('draft','pending_confirmation','confirmed','partially_repaid','fully_repaid','cancelled','rejected')),
  source_wallet_id          UUID NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  target_wallet_id          UUID NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  source_transaction_id     BIGINT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  target_transaction_id     BIGINT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  agreement_document_id     UUID NULL REFERENCES financial_documents(id) ON DELETE SET NULL,
  payment_proof_document_id UUID NULL REFERENCES financial_documents(id) ON DELETE SET NULL,
  effective_date            DATE NULL,
  maturity_date             DATE NULL,
  interest_rate             NUMERIC NULL CHECK (interest_rate IS NULL OR interest_rate >= 0),
  notes                     TEXT NULL,
  created_by_user_id        BIGINT NULL,
  approved_by_user_id       BIGINT NULL,
  created_at                TIMESTAMPTZ DEFAULT now(),
  approved_at               TIMESTAMPTZ NULL,
  cancelled_at              TIMESTAMPTZ NULL,
  idempotency_key           TEXT NOT NULL,
  -- capital_contribution is never repayable; the others always are
  CHECK ((funding_type = 'capital_contribution' AND repayable = false)
      OR (funding_type <> 'capital_contribution' AND repayable = true)),
  -- confirmed transfers must carry both legs; non-confirmed must NOT
  CHECK (
    (status IN ('confirmed','partially_repaid','fully_repaid')
       AND source_transaction_id IS NOT NULL AND target_transaction_id IS NOT NULL)
    OR (status IN ('draft','pending_confirmation','cancelled','rejected')
       AND source_transaction_id IS NULL AND target_transaction_id IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS funding_transfers_idem_uidx ON funding_transfers(idempotency_key);
CREATE INDEX IF NOT EXISTS funding_transfers_target_idx ON funding_transfers(target_business_id, status);
CREATE INDEX IF NOT EXISTS funding_transfers_source_idx ON funding_transfers(source_workspace_id, status);
CREATE INDEX IF NOT EXISTS funding_transfers_contrib_idx ON funding_transfers(target_business_id, contributor_user_id);
-- Guard: source must be personal, target must be business.
CREATE OR REPLACE FUNCTION fn_funding_type_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT fn_is_workspace_type(NEW.source_workspace_id, 'personal') THEN
    RAISE EXCEPTION 'funding source_workspace must be type=personal'; END IF;
  IF NOT fn_is_workspace_type(NEW.target_business_id, 'business') THEN
    RAISE EXCEPTION 'funding target must be type=business'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_funding_type_guard ON funding_transfers;
CREATE TRIGGER trg_funding_type_guard BEFORE INSERT OR UPDATE ON funding_transfers
  FOR EACH ROW EXECUTE FUNCTION fn_funding_type_guard();

-- ── 5. funding_repayments (two-leg legs linked to a funding transfer) ───────
CREATE TABLE IF NOT EXISTS funding_repayments (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  funding_transfer_id     UUID NOT NULL REFERENCES funding_transfers(id) ON DELETE RESTRICT,
  amount                  NUMERIC(20,2) NOT NULL CHECK (amount > 0),
  currency                TEXT NOT NULL,
  business_wallet_id      UUID NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  personal_wallet_id      UUID NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  business_transaction_id BIGINT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  personal_transaction_id BIGINT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  status                  TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled')),
  idempotency_key         TEXT NOT NULL,
  created_by_user_id      BIGINT NULL,
  created_at              TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS funding_repayments_idem_uidx ON funding_repayments(idempotency_key);
CREATE INDEX IF NOT EXISTS funding_repayments_transfer_idx ON funding_repayments(funding_transfer_id, status);

-- ── 6. funding_audit (append-only) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS funding_audit (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id       BIGINT NULL,
  source_workspace_id UUID NULL,
  target_business_id  UUID NULL,
  funding_transfer_id UUID NULL REFERENCES funding_transfers(id) ON DELETE SET NULL,
  relationship_id     UUID NULL,
  action              TEXT NOT NULL,   -- personal_workspace_created | funding_draft_created | funding_submitted | funding_confirmed | funding_rejected | funding_cancelled | funding_repayment_created | funding_fully_repaid | funding_document_linked | connection_requested | connection_confirmed | connection_rejected | connection_revoked
  amount              NUMERIC(20,2) NULL,
  currency            TEXT NULL,
  funding_type        TEXT NULL,
  channel             TEXT NULL,       -- web | telegram | mobile | api
  metadata            JSONB NULL,
  created_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS funding_audit_transfer_idx ON funding_audit(funding_transfer_id, created_at);
CREATE INDEX IF NOT EXISTS funding_audit_business_idx ON funding_audit(target_business_id, created_at);
CREATE OR REPLACE FUNCTION fn_funding_audit_no_mutate() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN RAISE EXCEPTION 'funding_audit is append-only (% blocked)', TG_OP; END $$;
DROP TRIGGER IF EXISTS funding_audit_append_only ON funding_audit;
CREATE TRIGGER funding_audit_append_only BEFORE UPDATE OR DELETE ON funding_audit
  FOR EACH ROW EXECUTE FUNCTION fn_funding_audit_no_mutate();

-- ── 7. Personal-workspace privacy guard: owner-only membership in V1 ─────────
-- Blocks adding a non-owner business_members row to a type='personal' workspace.
-- Designed to be REPLACEABLE by a future Family-plan policy migration.
CREATE OR REPLACE FUNCTION fn_personal_owner_only_membership() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_type text; v_owner bigint;
BEGIN
  SELECT type, owner_user_id INTO v_type, v_owner FROM public.businesses WHERE id = NEW.business_id;
  IF v_type = 'personal' AND NEW.user_id IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'personal workspace is owner-only in V1 (no non-owner members)';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_personal_owner_only ON business_members;
CREATE TRIGGER trg_personal_owner_only BEFORE INSERT OR UPDATE ON business_members
  FOR EACH ROW EXECUTE FUNCTION fn_personal_owner_only_membership();

-- ── 8. Derived balances VIEW (loans and capital kept separate) ──────────────
-- Outstanding = confirmed repayable funding − confirmed repayments. Drafts,
-- pending, rejected, cancelled and capital_contribution are EXCLUDED from loans.
CREATE OR REPLACE VIEW personal_funding_balances AS
WITH conf AS (
  SELECT ft.target_business_id, ft.contributor_user_id, ft.currency, ft.id, ft.funding_type, ft.repayable, ft.amount
  FROM funding_transfers ft
  WHERE ft.status IN ('confirmed','partially_repaid','fully_repaid')
),
rep AS (
  SELECT fr.funding_transfer_id, COALESCE(SUM(fr.amount),0) AS repaid
  FROM funding_repayments fr WHERE fr.status = 'confirmed' GROUP BY fr.funding_transfer_id
)
SELECT
  c.target_business_id,
  c.contributor_user_id,
  c.currency,
  SUM(CASE WHEN c.repayable THEN c.amount ELSE 0 END)                                AS loans_funded,
  COALESCE(SUM(CASE WHEN c.repayable THEN r.repaid ELSE 0 END),0)                    AS loans_repaid,
  SUM(CASE WHEN c.repayable THEN c.amount ELSE 0 END)
    - COALESCE(SUM(CASE WHEN c.repayable THEN r.repaid ELSE 0 END),0)                AS outstanding_repayable,
  SUM(CASE WHEN c.funding_type = 'capital_contribution' THEN c.amount ELSE 0 END)    AS capital_contributed
FROM conf c
LEFT JOIN rep r ON r.funding_transfer_id = c.id
GROUP BY c.target_business_id, c.contributor_user_id, c.currency;

-- ── Permissions: helper functions not callable by PUBLIC ────────────────────
REVOKE ALL ON FUNCTION fn_is_workspace_type(uuid, text) FROM PUBLIC;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION fn_is_workspace_type(uuid, text) TO service_role; END IF; END $$;

COMMIT;

-- ── Verify ───────────────────────────────────────────────────────────────────
SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN
 ('user_workspace_preferences','personal_business_relationships','personal_business_relationship_roles',
  'funding_transfers','funding_repayments','funding_audit')
UNION ALL SELECT 'view:personal_funding_balances' FROM information_schema.views
 WHERE table_schema='public' AND table_name='personal_funding_balances'
ORDER BY 1;
