-- Migration 064 — Business funding register (Design v2, proposal P-03)
--
-- Approved by the owner in _specs/design-v2/DECISIONS.md ("Final decisions for the
-- remaining work", item 6). NOT APPLIED anywhere by this change. The owner applies migrations.
--
-- WHAT
--   business_funding_records    — money a BUSINESS raised: equity or a loan, from a founder,
--                                 an investor, a bank or another lender.
--   business_funding_repayments — the repayment schedule of a loan: principal and interest
--                                 per due date, and when it was paid.
--
-- NEVER REVENUE. Funding is not income and repayment principal is not a cost; loan interest
-- is the only part that reaches profit (the 'interest' group, below EBITDA).
--
-- NO LINK TO PERSONAL. A founder loan is recorded business-side only. There is no column for
-- a personal workspace, wallet or the Personal↔Business bridge (migrations 037–039 are
-- untouched and their funding_transfers / funding_repayments tables are a different thing).
--
-- BUSINESS ISOLATION in the database (same pattern as 031 and 055): the lender, the linked
-- transactions and the parent record must belong to the same business.
--
-- ADDITIVE and IDEMPOTENT. Two new tables, CHECKs, indexes and isolation triggers. No
-- existing table is changed and no data is written.
--
-- WRITES go through POST /api/business-funding, POST /api/business-funding/:id/repayments and
-- POST /api/business-funding/repayments/:rid/paid only: owner/ceo/admin/cfo, Business only,
-- every write audited.

BEGIN;

CREATE TABLE IF NOT EXISTS public.business_funding_records (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id             UUID          NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  source_kind             TEXT          NOT NULL CHECK (source_kind IN ('founder','investor','bank','other_lender')),
  instrument              TEXT          NOT NULL CHECK (instrument IN ('equity','loan')),
  counterparty_id         UUID          NULL REFERENCES public.counterparties(id) ON DELETE RESTRICT,
  lender_name             TEXT          NULL,
  amount                  NUMERIC(20,2) NOT NULL CHECK (amount > 0),
  currency                TEXT          NOT NULL DEFAULT 'IDR',
  received_on             DATE          NOT NULL,
  received_transaction_id BIGINT        NULL REFERENCES public.transactions(id) ON DELETE RESTRICT,
  interest_rate_annual    NUMERIC(7,4)  NULL CHECK (interest_rate_annual IS NULL OR (interest_rate_annual >= 0 AND interest_rate_annual <= 100)),
  terms_text              TEXT          NULL,
  due_on                  DATE          NULL,
  status                  TEXT          NOT NULL DEFAULT 'active' CHECK (status IN ('active','repaid','converted','written_off')),
  created_by_user_id      BIGINT        NULL,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CHECK (counterparty_id IS NOT NULL OR length(btrim(coalesce(lender_name, ''))) > 0),
  -- Equity has no interest and no due date.
  CHECK (instrument = 'loan' OR (interest_rate_annual IS NULL AND due_on IS NULL)),
  CHECK (due_on IS NULL OR due_on >= received_on)
);

CREATE TABLE IF NOT EXISTS public.business_funding_repayments (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         UUID          NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  funding_record_id   UUID          NOT NULL REFERENCES public.business_funding_records(id) ON DELETE RESTRICT,
  due_on              DATE          NOT NULL,
  principal           NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (principal >= 0),
  interest            NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (interest >= 0),
  paid_on             DATE          NULL,
  paid_transaction_id BIGINT        NULL REFERENCES public.transactions(id) ON DELETE RESTRICT,
  created_by_user_id  BIGINT        NULL,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CHECK (principal + interest > 0),
  CHECK (paid_transaction_id IS NULL OR paid_on IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS bfr_business_idx ON public.business_funding_records (business_id, received_on);
CREATE INDEX IF NOT EXISTS bfrp_record_idx ON public.business_funding_repayments (funding_record_id, due_on);
CREATE INDEX IF NOT EXISTS bfrp_business_due_idx ON public.business_funding_repayments (business_id, due_on) WHERE paid_on IS NULL;
-- One payment settles one repayment.
CREATE UNIQUE INDEX IF NOT EXISTS bfrp_paid_tx_uniq ON public.business_funding_repayments (paid_transaction_id) WHERE paid_transaction_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_iso_business_funding_records() RETURNS trigger AS $$
BEGIN
  IF NEW.counterparty_id IS NOT NULL AND (SELECT business_id FROM public.counterparties WHERE id = NEW.counterparty_id) IS DISTINCT FROM NEW.business_id
    THEN RAISE EXCEPTION 'isolation: lender belongs to another business'; END IF;
  IF NEW.received_transaction_id IS NOT NULL AND (SELECT business_id FROM public.transactions WHERE id = NEW.received_transaction_id) IS DISTINCT FROM NEW.business_id
    THEN RAISE EXCEPTION 'isolation: funding transaction belongs to another business'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_iso_business_funding_records ON public.business_funding_records;
CREATE TRIGGER trg_iso_business_funding_records BEFORE INSERT OR UPDATE ON public.business_funding_records
  FOR EACH ROW EXECUTE FUNCTION public.fn_iso_business_funding_records();

CREATE OR REPLACE FUNCTION public.fn_iso_business_funding_repayments() RETURNS trigger AS $$
DECLARE rec_business UUID; rec_instrument TEXT;
BEGIN
  SELECT business_id, instrument INTO rec_business, rec_instrument FROM public.business_funding_records WHERE id = NEW.funding_record_id;
  IF rec_business IS DISTINCT FROM NEW.business_id THEN RAISE EXCEPTION 'isolation: repayment belongs to another business'; END IF;
  IF rec_instrument <> 'loan' THEN RAISE EXCEPTION 'only a loan has repayments'; END IF;
  IF NEW.paid_transaction_id IS NOT NULL AND (SELECT business_id FROM public.transactions WHERE id = NEW.paid_transaction_id) IS DISTINCT FROM NEW.business_id
    THEN RAISE EXCEPTION 'isolation: repayment transaction belongs to another business'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_iso_business_funding_repayments ON public.business_funding_repayments;
CREATE TRIGGER trg_iso_business_funding_repayments BEFORE INSERT OR UPDATE ON public.business_funding_repayments
  FOR EACH ROW EXECUTE FUNCTION public.fn_iso_business_funding_repayments();

COMMENT ON TABLE public.business_funding_records IS
  'Design v2 P-03: equity and loans a business raised. Never revenue; no link to Personal.';

-- ── Backend-only table access (same as 037) ──────────────────────────────────
-- Supabase grants new public tables to anon/authenticated by default, which would let a
-- holder of the anon key read or write them through PostgREST and bypass the Express
-- business-isolation checks. RLS on + revoke them; service_role (the backend) is granted
-- explicitly. Idempotent and role-guarded.
DO $$
DECLARE t text; r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['business_funding_records','business_funding_repayments']
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
-- SELECT count(*) FROM public.business_funding_records;     -- 0 right after apply
-- SELECT count(*) FROM public.business_funding_repayments;  -- 0
-- SELECT tgname FROM pg_trigger WHERE tgname LIKE 'trg_iso_business_funding%';  -- 2 rows
--
-- ── rollback (only if needed; the tables hold owner-entered data) ────────────
-- DROP TABLE IF EXISTS public.business_funding_repayments;
-- DROP TABLE IF EXISTS public.business_funding_records;
-- DROP FUNCTION IF EXISTS public.fn_iso_business_funding_repayments();
-- DROP FUNCTION IF EXISTS public.fn_iso_business_funding_records();
