-- Migration 062 — Category → profit group and industry templates (Design v2, proposal P-10)
--
-- Approved by the owner in _specs/design-v2/DECISIONS.md ("P-10 decisions", 3 Oct 2026).
-- NOT APPLIED anywhere by this change. The owner applies migrations.
--
-- WHAT
--   cashflow_categories.pnl_group — which of the 9 profit groups a BUSINESS's category belongs
--     to. NULL = not confirmed. It is set only by a person through PATCH /api/pnl-mapping
--     (owner/ceo/admin/cfo, audited). Global template rows (business_id IS NULL) can never
--     carry one: a mapping always belongs to one business.
--   industry_templates — SUGGESTIONS per KBLI prefix ('*' = any business): category name →
--     group. Nothing reads them into profit. The owner confirms a mapping per business.
--
-- 9 GROUPS: revenue, direct_cost, operating_cost, interest, other_income, tax, asset_purchase, funding, transfer.
--
-- NO FINANCIAL EFFECT. No transaction, debt, wallet or category row is written: existing
-- categories keep pnl_group NULL, so Performance keeps today's estimate until a business
-- confirms. Pulse and AI CFO keep using the keyword classifier.
--
-- ADDITIVE and IDEMPOTENT. One nullable column and two CHECKs, one new table and its seed
-- (ON CONFLICT DO NOTHING). Re-running changes nothing.

BEGIN;

ALTER TABLE public.cashflow_categories
  ADD COLUMN IF NOT EXISTS pnl_group TEXT NULL;

DO $$ BEGIN
  ALTER TABLE public.cashflow_categories
    ADD CONSTRAINT cashflow_categories_pnl_group_chk
    CHECK (pnl_group IS NULL OR pnl_group IN ('revenue', 'direct_cost', 'operating_cost', 'interest', 'other_income', 'tax', 'asset_purchase', 'funding', 'transfer'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Isolation: a confirmed group belongs to one business; templates and globals never hold one.
DO $$ BEGIN
  ALTER TABLE public.cashflow_categories
    ADD CONSTRAINT cashflow_categories_pnl_group_business_chk
    CHECK (pnl_group IS NULL OR business_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.cashflow_categories.pnl_group IS
  'Design v2 P-10: profit group confirmed by a person for this business. NULL = not confirmed.';

CREATE TABLE IF NOT EXISTS public.industry_templates (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  kbli_prefix   TEXT        NOT NULL CHECK (kbli_prefix = '*' OR kbli_prefix ~ '^[0-9]{2,5}$'),
  category_name TEXT        NOT NULL CHECK (length(btrim(category_name)) > 0),
  pnl_group     TEXT        NOT NULL CHECK (pnl_group IN ('revenue', 'direct_cost', 'operating_cost', 'interest', 'other_income', 'tax', 'asset_purchase', 'funding', 'transfer')),
  note          TEXT        NULL,
  sort_order    INT         NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (kbli_prefix, category_name)
);

COMMENT ON TABLE public.industry_templates IS
  'Design v2 P-10: suggested category → profit group per KBLI prefix. Suggestions only; never read into profit.';

-- Seed: generic ('*'), KBLI 81210 (building cleaning), KBLI 47999 (vending).
-- From _specs/design-v2/P10_TEMPLATE.md with the owner's answers in DECISIONS.md.
INSERT INTO public.industry_templates (kbli_prefix, category_name, pnl_group, note, sort_order) VALUES
  ('*', 'Перевод между счетами — поступление', 'transfer', NULL, 1),
  ('*', 'Перевод между счетами — выбытие', 'transfer', NULL, 2),
  ('*', 'Продажи в вендинговых автоматах', 'revenue', NULL, 3),
  ('*', 'Продажи франшизы', 'revenue', NULL, 4),
  ('*', 'Роялти', 'revenue', NULL, 5),
  ('*', 'Паушальный взнос', 'revenue', 'Q5: revenue in the invoice month; spreading over the term waits for the accountant.', 6),
  ('*', 'Реклама DOOH', 'revenue', NULL, 7),
  ('*', 'Прочие поступления', 'other_income', 'Q6: below operating profit.', 8),
  ('*', 'Возвраты от поставщиков', 'direct_cost', 'A refund reduces the cost it refunds.', 9),
  ('*', 'Возвраты клиентам', 'revenue', 'A refund reduces sales; it is not a cost.', 10),
  ('*', 'Закупка товара', 'direct_cost', NULL, 11),
  ('*', 'Транспортные услуги', 'direct_cost', 'Q4.', 12),
  ('*', 'Эквайринг', 'direct_cost', 'Paid per sale.', 13),
  ('*', 'РКО', 'operating_cost', NULL, 14),
  ('*', 'Зарплата производственного персонала', 'direct_cost', 'Q4: field and production staff.', 15),
  ('*', 'Зарплата административного персонала', 'operating_cost', NULL, 16),
  ('*', 'Зарплата коммерческого персонала', 'operating_cost', NULL, 17),
  ('*', 'Налоги на ФОТ', 'operating_cost', 'Q3/Q4: employer BPJS follows the wage it belongs to; field staff use their own direct_cost category.', 18),
  ('*', 'Обучение персонала', 'operating_cost', NULL, 19),
  ('*', 'Расходы на персонал', 'operating_cost', NULL, 20),
  ('*', 'Поиск и найм персонала', 'operating_cost', NULL, 21),
  ('*', 'Командировочные расходы', 'operating_cost', NULL, 22),
  ('*', 'Оплата рекламных систем', 'operating_cost', NULL, 23),
  ('*', 'Маркетинговые подрядчики', 'operating_cost', NULL, 24),
  ('*', 'Административные подрядчики', 'operating_cost', NULL, 25),
  ('*', 'Электронные подписки', 'operating_cost', NULL, 26),
  ('*', 'Связь и интернет', 'operating_cost', NULL, 27),
  ('*', 'Содержание вендинговых автоматов', 'direct_cost', NULL, 28),
  ('*', 'Аренда торговых точек', 'direct_cost', 'Q4: machine locations.', 29),
  ('*', 'Аренда техники', 'direct_cost', 'Q4: job equipment.', 30),
  ('*', 'Содержание офиса', 'operating_cost', NULL, 31),
  ('*', 'Хоз. инвентарь', 'operating_cost', 'Q4: cleaning chemicals used on jobs belong in a direct_cost category.', 32),
  ('*', 'Аренда офиса', 'operating_cost', NULL, 33),
  ('*', 'Ремонт и содержание офиса', 'operating_cost', NULL, 34),
  ('*', 'Оргтехника', 'operating_cost', 'Q2: one item over Rp 5,000,000 lasting more than a year is asset_purchase; the accountant confirms.', 35),
  ('*', 'Покупка наличности', 'transfer', 'Cash moves to the cash box; nothing is spent.', 36),
  ('*', 'Выплата франчайзи', 'direct_cost', NULL, 37),
  ('*', 'Продажа ОС', 'asset_purchase', 'Q7: the sale price reduces asset_purchase; the accountant works out the gain or loss.', 38),
  ('*', 'Возврат кредитов и займов', 'funding', NULL, 39),
  ('*', 'Прочие инвестиционные доходы', 'other_income', 'Q6.', 40),
  ('*', 'Покупка ОС', 'asset_purchase', NULL, 41),
  ('*', 'Ремонт ОС', 'operating_cost', 'Q2: a repair that does not extend the asset''s life.', 42),
  ('*', 'Получение кредитов и займов', 'funding', NULL, 43),
  ('*', 'Вклад собственника', 'funding', 'Never linked to Personal until the bridge is approved.', 44),
  ('*', 'Оплаты по кредитам и займам', 'funding', 'Q1: principal only; interest goes to a Loan interest category.', 45),
  ('*', 'Дивиденды', 'funding', NULL, 46),
  ('*', 'Loan interest', 'interest', 'Q1: only interest on loans the company owes; below EBITDA.', 47),
  ('*', 'Deposit and account interest', 'other_income', 'Clarification 2: shown net of the bank''s final tax.', 48),
  ('*', 'Corporate income tax (PPh 25/29)', 'tax', 'Q3: the company''s own tax only.', 49),
  ('*', 'Turnover tax (UMKM final)', 'tax', 'Clarification 3: labelled Turnover tax (0.5%) when the tax profile is UMKM final.', 50),
  ('81210', 'Cleaning service income', 'revenue', NULL, 100),
  ('81210', 'Cleaning supplies used on jobs', 'direct_cost', 'Chemicals, cloths, bags.', 101),
  ('81210', 'Subcontracted cleaners', 'direct_cost', NULL, 102),
  ('81210', 'Transport to client sites', 'direct_cost', NULL, 103),
  ('81210', 'Uniforms and safety equipment', 'direct_cost', NULL, 104),
  ('81210', 'Wages: field cleaners', 'direct_cost', 'Q4.', 105),
  ('81210', 'Payroll taxes and BPJS: field cleaners', 'direct_cost', 'Q4.', 106),
  ('81210', 'Cleaning machines', 'asset_purchase', 'Q2 threshold applies.', 107),
  ('81210', 'Machine servicing and spare parts', 'operating_cost', NULL, 108),
  ('47999', 'Vending sales (cash)', 'revenue', NULL, 200),
  ('47999', 'Vending sales (QRIS / card)', 'revenue', NULL, 201),
  ('47999', 'Stock for machines', 'direct_cost', NULL, 202),
  ('47999', 'Cash collection and machine refilling', 'direct_cost', NULL, 203),
  ('47999', 'Site rent and revenue share', 'direct_cost', 'Q4.', 204),
  ('47999', 'Gateway and QRIS fees', 'direct_cost', NULL, 205),
  ('47999', 'Vending machines', 'asset_purchase', 'Q2 threshold applies.', 206),
  ('47999', 'Machine repairs and parts', 'operating_cost', NULL, 207)
ON CONFLICT (kbli_prefix, category_name) DO NOTHING;

-- ── Backend-only table access (same as 037) ──────────────────────────────────
-- Supabase grants new public tables to anon/authenticated by default, which would let a
-- holder of the anon key read or write them through PostgREST and bypass the Express
-- business-isolation checks. RLS on + revoke them; service_role (the backend) is granted
-- explicitly. Idempotent and role-guarded.
DO $$
DECLARE t text; r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['industry_templates']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') LOOP
      EXECUTE format('REVOKE ALL ON public.%I FROM %I', t, r);
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);
    END IF;
  END LOOP;
END $$;

COMMIT;

-- ── verification (run after applying) ────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'cashflow_categories' AND column_name = 'pnl_group';             -- 1 row
-- SELECT kbli_prefix, count(*) FROM public.industry_templates GROUP BY 1 ORDER BY 1;   -- *: 50, 47999: 8, 81210: 9
-- SELECT count(*) FROM public.cashflow_categories WHERE pnl_group IS NOT NULL;           -- 0 right after apply
--
-- ── rollback (only if needed) ────────────────────────────────────────────────
-- DROP TABLE IF EXISTS public.industry_templates;
-- ALTER TABLE public.cashflow_categories DROP CONSTRAINT IF EXISTS cashflow_categories_pnl_group_business_chk;
-- ALTER TABLE public.cashflow_categories DROP CONSTRAINT IF EXISTS cashflow_categories_pnl_group_chk;
-- ALTER TABLE public.cashflow_categories DROP COLUMN IF EXISTS pnl_group;
