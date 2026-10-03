-- Migration 063 — Asset register (Design v2, proposal P-11)
--
-- Approved by the owner in _specs/design-v2/DECISIONS.md ("Final decisions for the
-- remaining work", item 6). NOT APPLIED anywhere by this change. The owner applies migrations.
--
-- WHAT
--   assets — one row per asset of a BUSINESS: what it is, what it cost, when it was bought,
--   where it came from (bill, payment, document, supplier), and the depreciation basis.
--
-- DEPRECIATION IS COMPUTED, NOT STORED. Straight line: cost ÷ useful_life_months per month,
-- from the month after acquisition until fully written off or disposed. The asset GROUP and
-- USEFUL LIFE come only from the verified tax rule engine (an active, verified tax_rules row
-- with obligation_type = 'depreciation'); the rule used is kept in depreciation_rule_id.
-- With no such rule, useful_life_months stays NULL and no depreciation is shown — never a
-- guessed life.
--
-- NO DOUBLE COUNTING. A purchase linked here (purchase_debt_id / purchase_transaction_id)
-- is an asset, not a cost: Performance leaves it out of profit and counts depreciation only.
--
-- BUSINESS ISOLATION in the database (same pattern as 031 and 055): every linked bill,
-- payment, document and supplier must belong to the asset's business.
--
-- ADDITIVE and IDEMPOTENT. One new table, its CHECKs, indexes and an isolation trigger.
-- No existing table is changed and no data is written.
--
-- WRITES go through POST /api/assets and POST /api/assets/:id/dispose only:
-- owner/ceo/admin/cfo/accountant, Business only, every write audited.

BEGIN;

CREATE TABLE IF NOT EXISTS public.assets (
  id                       UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id              UUID          NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  name                     TEXT          NOT NULL CHECK (length(btrim(name)) > 0),
  asset_type               TEXT          NOT NULL CHECK (asset_type IN ('machines','vehicles','computers','furniture','buildings','other')),
  quantity                 INTEGER       NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  cost                     NUMERIC(20,2) NOT NULL CHECK (cost > 0),
  currency                 TEXT          NOT NULL DEFAULT 'IDR',
  acquired_on              DATE          NOT NULL,
  supplier_counterparty_id UUID          NULL REFERENCES public.counterparties(id) ON DELETE RESTRICT,
  purchase_debt_id         BIGINT        NULL REFERENCES public.debts(id) ON DELETE RESTRICT,
  purchase_transaction_id  BIGINT        NULL REFERENCES public.transactions(id) ON DELETE RESTRICT,
  purchase_document_id     UUID          NULL REFERENCES public.financial_documents(id) ON DELETE RESTRICT,
  asset_group              TEXT          NULL,
  useful_life_months       INTEGER       NULL CHECK (useful_life_months IS NULL OR useful_life_months BETWEEN 1 AND 600),
  depreciation_method      TEXT          NOT NULL DEFAULT 'straight_line' CHECK (depreciation_method = 'straight_line'),
  depreciation_rule_id     UUID          NULL REFERENCES public.tax_rules(id) ON DELETE RESTRICT,
  location                 TEXT          NULL,
  custodian                TEXT          NULL,
  notes                    TEXT          NULL,
  disposed_on              DATE          NULL,
  created_by_user_id       BIGINT        NULL,
  created_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CHECK (disposed_on IS NULL OR disposed_on >= acquired_on),
  -- A life without the rule that set it (or the reverse) would be a guess.
  CHECK ((useful_life_months IS NULL) = (depreciation_rule_id IS NULL))
);

CREATE INDEX IF NOT EXISTS assets_business_idx ON public.assets (business_id, acquired_on);
-- One bill or one payment can be registered as an asset once.
CREATE UNIQUE INDEX IF NOT EXISTS assets_purchase_debt_uniq ON public.assets (purchase_debt_id) WHERE purchase_debt_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS assets_purchase_tx_uniq ON public.assets (purchase_transaction_id) WHERE purchase_transaction_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_iso_assets() RETURNS trigger AS $$
BEGIN
  IF NEW.purchase_debt_id IS NOT NULL AND (SELECT business_id FROM public.debts WHERE id = NEW.purchase_debt_id) IS DISTINCT FROM NEW.business_id
    THEN RAISE EXCEPTION 'isolation: asset bill belongs to another business'; END IF;
  IF NEW.purchase_transaction_id IS NOT NULL AND (SELECT business_id FROM public.transactions WHERE id = NEW.purchase_transaction_id) IS DISTINCT FROM NEW.business_id
    THEN RAISE EXCEPTION 'isolation: asset payment belongs to another business'; END IF;
  IF NEW.purchase_document_id IS NOT NULL AND (SELECT business_id FROM public.financial_documents WHERE id = NEW.purchase_document_id) IS DISTINCT FROM NEW.business_id
    THEN RAISE EXCEPTION 'isolation: asset document belongs to another business'; END IF;
  IF NEW.supplier_counterparty_id IS NOT NULL AND (SELECT business_id FROM public.counterparties WHERE id = NEW.supplier_counterparty_id) IS DISTINCT FROM NEW.business_id
    THEN RAISE EXCEPTION 'isolation: asset supplier belongs to another business'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_iso_assets ON public.assets;
CREATE TRIGGER trg_iso_assets BEFORE INSERT OR UPDATE ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.fn_iso_assets();

COMMENT ON TABLE public.assets IS
  'Design v2 P-11: asset register. Depreciation is computed (straight line) from a verified depreciation tax rule; never stored, never guessed.';

COMMIT;

-- ── verification (run after applying) ────────────────────────────────────────
-- SELECT count(*) FROM public.assets;                                              -- 0 right after apply
-- SELECT tgname FROM pg_trigger WHERE tgname = 'trg_iso_assets';                     -- 1 row
-- SELECT count(*) FROM public.tax_rules WHERE obligation_type = 'depreciation' AND status = 'active';
--   -- 0 until a platform admin adds and verifies the depreciation rule; until then no life is set.
--
-- ── rollback (only if needed; the table holds owner-entered data) ────────────
-- DROP TRIGGER IF EXISTS trg_iso_assets ON public.assets;
-- DROP FUNCTION IF EXISTS public.fn_iso_assets();
-- DROP TABLE IF EXISTS public.assets;
