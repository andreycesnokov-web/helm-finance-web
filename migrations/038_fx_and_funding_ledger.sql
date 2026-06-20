-- Migration 038 — FX quotes + multi-currency funding ledger (tables only; RPCs in 039)
-- Date: 2026-06-19. ADDITIVE + IDEMPOTENT + TRANSACTIONAL. No DROP, NO seed, NO cash.
-- PROPOSED — NOT APPLIED. Needs 037. Stores native AND reporting amounts, locked
-- quotes, fees/spread separately. Outstanding is DERIVED (view), never stored.

BEGIN;

DO $$ BEGIN
  IF to_regclass('public.personal_business_relationships') IS NULL THEN RAISE EXCEPTION '038 needs 037'; END IF;
END $$;

-- ── 1. exchange_rate_quotes (deterministic; AI is never the rate source) ────
CREATE TABLE IF NOT EXISTS exchange_rate_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          TEXT NOT NULL,
  provider_quote_id TEXT NULL,
  base_asset        TEXT NOT NULL,
  quote_asset       TEXT NOT NULL,
  rate              NUMERIC(38,18) NOT NULL CHECK (rate > 0),
  inverse_rate      NUMERIC(38,18) NULL CHECK (inverse_rate IS NULL OR inverse_rate > 0),
  bid               NUMERIC(38,18) NULL,
  ask               NUMERIC(38,18) NULL,
  market_timestamp  TIMESTAMPTZ NULL,
  retrieved_at      TIMESTAMPTZ DEFAULT now(),
  valid_until       TIMESTAMPTZ NULL,
  rate_effective_date DATE NULL,
  source_type       TEXT NOT NULL CHECK (source_type IN ('market_api','official_rate','exchange_rate','manual')),
  status            TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('requested','available','locked','used','expired')),
  manual_reason     TEXT NULL,                    -- required when source_type='manual'
  raw_metadata      JSONB NULL,                   -- safe JSON only — never secrets/keys
  created_by_user_id BIGINT NULL,
  created_at        TIMESTAMPTZ DEFAULT now(),
  idempotency_key   TEXT NULL,
  CHECK (source_type <> 'manual' OR manual_reason IS NOT NULL),
  CHECK (base_asset <> quote_asset)
);
CREATE UNIQUE INDEX IF NOT EXISTS erq_idem_uidx ON exchange_rate_quotes(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS erq_pair_idx ON exchange_rate_quotes(base_asset, quote_asset, market_timestamp);

-- now that quotes exist, point transactions.fx_quote_id at them
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='transactions_fx_quote_fk') THEN
    ALTER TABLE public.transactions ADD CONSTRAINT transactions_fx_quote_fk
      FOREIGN KEY (fx_quote_id) REFERENCES public.exchange_rate_quotes(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── 2. fx_conversions (one per cross-currency leg pair) ─────────────────────
CREATE TABLE IF NOT EXISTS fx_conversions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id          UUID NULL REFERENCES exchange_rate_quotes(id) ON DELETE RESTRICT,
  source_asset      TEXT NOT NULL, source_amount NUMERIC(38,18) NOT NULL CHECK (source_amount > 0),
  target_asset      TEXT NOT NULL, target_amount NUMERIC(38,18) NOT NULL CHECK (target_amount > 0),
  booked_rate       NUMERIC(38,18) NOT NULL CHECK (booked_rate > 0),
  fee_amount        NUMERIC(38,18) NULL, fee_asset TEXT NULL,
  network_fee_amount NUMERIC(38,18) NULL, network_fee_asset TEXT NULL,
  spread_bps        NUMERIC NULL,
  created_by_user_id BIGINT NULL, created_at TIMESTAMPTZ DEFAULT now()
);

-- ── 3. funding_transfers (native + reporting; fees separate; legs on confirm) ─
CREATE TABLE IF NOT EXISTS funding_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id      UUID NOT NULL REFERENCES personal_business_relationships(id) ON DELETE RESTRICT,
  source_workspace_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,   -- personal
  target_business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,   -- business
  contributor_user_id  BIGINT NOT NULL,
  funding_type         TEXT NOT NULL CHECK (funding_type IN ('shareholder_loan','founder_advance','temporary_funding','capital_contribution')),
  repayable            BOOLEAN NOT NULL,
  -- native amounts (may differ in asset for cross-currency)
  source_asset         TEXT NOT NULL,
  source_principal_amount NUMERIC(38,18) NOT NULL CHECK (source_principal_amount > 0),
  source_total_debit   NUMERIC(38,18) NOT NULL CHECK (source_total_debit >= source_principal_amount), -- principal + fees
  target_asset         TEXT NOT NULL,
  target_amount        NUMERIC(38,18) NOT NULL CHECK (target_amount > 0),
  -- fees / spread (separate from principal)
  fee_amount           NUMERIC(38,18) NULL, fee_asset TEXT NULL,
  network_fee_amount   NUMERIC(38,18) NULL, network_fee_asset TEXT NULL,
  spread_bps           NUMERIC NULL,
  -- booked rate (immutable after confirmation) + provenance
  booked_rate          NUMERIC(38,18) NULL, rate_source TEXT NULL,
  rate_market_timestamp TIMESTAMPTZ NULL, rate_effective_date DATE NULL,
  fx_quote_id          UUID NULL REFERENCES exchange_rate_quotes(id) ON DELETE RESTRICT,
  fx_conversion_id     UUID NULL REFERENCES fx_conversions(id) ON DELETE RESTRICT,
  -- reporting value (workspace reporting currency = businesses.base_currency)
  reporting_currency   TEXT NULL, reporting_amount NUMERIC(38,18) NULL,
  status               TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_confirmation','confirmed','partially_repaid','fully_repaid','cancelled','rejected')),
  source_wallet_id     UUID NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  target_wallet_id     UUID NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  source_transaction_id BIGINT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  target_transaction_id BIGINT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  fee_transaction_id    BIGINT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  agreement_document_id UUID NULL REFERENCES financial_documents(id) ON DELETE SET NULL,
  payment_proof_document_id UUID NULL REFERENCES financial_documents(id) ON DELETE SET NULL,
  effective_date DATE NULL, maturity_date DATE NULL, interest_rate NUMERIC NULL,
  notes TEXT NULL, created_by_user_id BIGINT NULL, approved_by_user_id BIGINT NULL,
  created_at TIMESTAMPTZ DEFAULT now(), approved_at TIMESTAMPTZ NULL, cancelled_at TIMESTAMPTZ NULL,
  idempotency_key TEXT NOT NULL,
  CHECK ((funding_type='capital_contribution' AND repayable=false) OR (funding_type<>'capital_contribution' AND repayable=true)),
  CHECK ((status IN ('confirmed','partially_repaid','fully_repaid') AND source_transaction_id IS NOT NULL AND target_transaction_id IS NOT NULL)
      OR (status IN ('draft','pending_confirmation','cancelled','rejected') AND source_transaction_id IS NULL AND target_transaction_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ft_idem_uidx ON funding_transfers(idempotency_key);
CREATE INDEX IF NOT EXISTS ft_target_idx ON funding_transfers(target_business_id, status);
CREATE INDEX IF NOT EXISTS ft_contrib_idx ON funding_transfers(target_business_id, contributor_user_id, source_asset);
CREATE OR REPLACE FUNCTION fn_funding_type_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT fn_is_workspace_type(NEW.source_workspace_id,'personal') THEN RAISE EXCEPTION 'funding source must be personal'; END IF;
  IF NOT fn_is_workspace_type(NEW.target_business_id,'business') THEN RAISE EXCEPTION 'funding target must be business'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_funding_type_guard ON funding_transfers;
CREATE TRIGGER trg_funding_type_guard BEFORE INSERT OR UPDATE ON funding_transfers
  FOR EACH ROW EXECUTE FUNCTION fn_funding_type_guard();

-- ── 4. funding_repayments (principal reduction tracked in principal asset) ──
CREATE TABLE IF NOT EXISTS funding_repayments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  funding_transfer_id UUID NOT NULL REFERENCES funding_transfers(id) ON DELETE RESTRICT,
  repayment_amount_native   NUMERIC(38,18) NOT NULL CHECK (repayment_amount_native > 0),
  repayment_asset           TEXT NOT NULL,
  principal_reduction_amount NUMERIC(38,18) NOT NULL CHECK (principal_reduction_amount > 0),
  principal_asset           TEXT NOT NULL,
  repayment_quote_id        UUID NULL REFERENCES exchange_rate_quotes(id) ON DELETE RESTRICT,
  booked_rate               NUMERIC(38,18) NULL,
  business_wallet_id        UUID NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  personal_wallet_id        UUID NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  business_transaction_id   BIGINT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  personal_transaction_id   BIGINT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  reporting_amount          NUMERIC(38,18) NULL,
  status                    TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled')),
  idempotency_key           TEXT NOT NULL, created_by_user_id BIGINT NULL, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS fr_idem_uidx ON funding_repayments(idempotency_key);
CREATE INDEX IF NOT EXISTS fr_transfer_idx ON funding_repayments(funding_transfer_id, status);

-- ── 5. funding_audit (append-only) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS funding_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id BIGINT NULL, source_workspace_id UUID NULL, target_business_id UUID NULL,
  funding_transfer_id UUID NULL REFERENCES funding_transfers(id) ON DELETE SET NULL,
  relationship_id UUID NULL, fx_quote_id UUID NULL,
  action TEXT NOT NULL,   -- fx_quote_requested|fx_quote_received|fx_quote_locked|fx_quote_expired|manual_rate_entered|wallet_transfer_confirmed|funding_submitted|funding_confirmed|funding_rejected|funding_cancelled|funding_repayment_confirmed|funding_fully_repaid|connection_requested|connection_confirmed|connection_rejected|relationship_revoked
  source_asset TEXT NULL, source_amount NUMERIC(38,18) NULL,
  target_asset TEXT NULL, target_amount NUMERIC(38,18) NULL,
  booked_rate NUMERIC(38,18) NULL, funding_type TEXT NULL,
  channel TEXT NULL, metadata JSONB NULL, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fa_transfer_idx ON funding_audit(funding_transfer_id, created_at);
CREATE OR REPLACE FUNCTION fn_funding_audit_no_mutate() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN RAISE EXCEPTION 'funding_audit is append-only (% blocked)', TG_OP; END $$;
DROP TRIGGER IF EXISTS funding_audit_append_only ON funding_audit;
CREATE TRIGGER funding_audit_append_only BEFORE UPDATE OR DELETE ON funding_audit
  FOR EACH ROW EXECUTE FUNCTION fn_funding_audit_no_mutate();

-- ── 6. Derived balances: native principal outstanding + reporting; loans vs capital ─
CREATE OR REPLACE VIEW personal_funding_balances AS
WITH conf AS (
  SELECT id, target_business_id, contributor_user_id, source_asset AS principal_asset, funding_type, repayable,
         source_principal_amount AS principal, reporting_amount
  FROM funding_transfers WHERE status IN ('confirmed','partially_repaid','fully_repaid')
),
rep AS (
  SELECT funding_transfer_id, principal_asset, COALESCE(SUM(principal_reduction_amount),0) AS reduced
  FROM funding_repayments WHERE status='confirmed' GROUP BY funding_transfer_id, principal_asset
)
SELECT
  c.target_business_id, c.contributor_user_id, c.principal_asset,
  SUM(CASE WHEN c.repayable THEN c.principal ELSE 0 END)                                   AS loans_principal,
  COALESCE(SUM(CASE WHEN c.repayable THEN r.reduced ELSE 0 END),0)                         AS loans_repaid_principal,
  SUM(CASE WHEN c.repayable THEN c.principal ELSE 0 END)
    - COALESCE(SUM(CASE WHEN c.repayable THEN r.reduced ELSE 0 END),0)                     AS outstanding_principal_native,
  SUM(CASE WHEN c.funding_type='capital_contribution' THEN c.principal ELSE 0 END)         AS capital_contributed,
  SUM(CASE WHEN c.repayable THEN COALESCE(c.reporting_amount,0) ELSE 0 END)                AS loans_reporting_value
FROM conf c LEFT JOIN rep r ON r.funding_transfer_id = c.id
GROUP BY c.target_business_id, c.contributor_user_id, c.principal_asset;

COMMIT;

-- ── Verify ───────────────────────────────────────────────────────────────────
SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN
 ('exchange_rate_quotes','fx_conversions','funding_transfers','funding_repayments','funding_audit')
UNION ALL SELECT 'view:personal_funding_balances' FROM information_schema.views WHERE table_name='personal_funding_balances'
ORDER BY 1;
