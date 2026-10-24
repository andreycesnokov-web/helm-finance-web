-- Per-company P&L group for SHARED system categories. PREPARED ONLY; release approval required.
-- Additive: one new table. No existing row, category, transaction or other company's mapping changes.
--
-- System categories (cashflow_categories.business_id IS NULL, is_system) are one row shared by every
-- company, and cashflow_categories_pnl_group_business_chk deliberately forbids a pnl_group on them: a group
-- written there would reclassify every tenant at once. A company's own confirmation of how it reads a
-- system category lives here instead, keyed by (business_id, category_id). The P&L report, the profit-group
-- page and the cash insights read it for THAT company only. Company-owned categories keep using their own
-- cashflow_categories.pnl_group column; this table refuses them.
-- Rollback: 20261024120000_business_category_pnl_groups_down.sql (drops the table; nothing else to undo).
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $$ BEGIN
 IF to_regclass('public.cashflow_categories') IS NULL OR to_regclass('public.businesses') IS NULL
  OR to_regprocedure('public.fn_ledger_writer_statement()') IS NULL
  THEN RAISE EXCEPTION 'pnl_system_mapping_applicability_review_required'; END IF;
 IF to_regclass('public.business_category_pnl_groups') IS NOT NULL THEN RAISE EXCEPTION 'pnl_system_mapping_already_installed'; END IF;
END $$;

CREATE TABLE public.business_category_pnl_groups (
 business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
 category_id uuid NOT NULL REFERENCES public.cashflow_categories(id) ON DELETE CASCADE,
 pnl_group text NOT NULL CHECK (pnl_group IN ('revenue','direct_cost','operating_cost','interest','other_income','tax','asset_purchase','funding','transfer')),
 confirmed_by_user_id bigint REFERENCES public.users(id) ON DELETE SET NULL,
 confirmed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (business_id, category_id)
);
CREATE INDEX business_category_pnl_groups_category ON public.business_category_pnl_groups(category_id);

-- Only a shared system category may be mapped here; a company's own category keeps its own column.
CREATE FUNCTION public.fn_business_category_pnl_group_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.cashflow_categories c WHERE c.id = NEW.category_id AND c.business_id IS NULL AND c.is_system)
  THEN RAISE EXCEPTION 'pnl_system_mapping_requires_system_category'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER business_category_pnl_group_guard BEFORE INSERT OR UPDATE ON public.business_category_pnl_groups
 FOR EACH ROW EXECUTE FUNCTION public.fn_business_category_pnl_group_guard();
-- Same writer ordering as cashflow_categories, whose group it stands in for.
CREATE TRIGGER financial_writer_gate BEFORE INSERT OR UPDATE OR DELETE ON public.business_category_pnl_groups
 FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ledger_writer_statement();

ALTER TABLE public.business_category_pnl_groups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.business_category_pnl_groups FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_category_pnl_groups TO service_role;
REVOKE ALL ON FUNCTION public.fn_business_category_pnl_group_guard() FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
