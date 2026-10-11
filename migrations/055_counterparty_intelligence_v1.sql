-- ═══════════════════════════════════════════════════════════════════════════
-- 055_counterparty_intelligence_v1
-- For: Counterparty Intelligence V1
--
-- APPLIED to production (Supabase project cbsbnzttkndlgdpjxcxe) on 2026-09-04,
-- manually via the SQL Editor. Verified after apply: 13 new columns, the
-- counterparty_bank_accounts table, 6 indexes, trg_iso_cp_bank_accounts, the single
-- existing counterparty row intact and backfilled, and businesses/debts/documents/
-- transactions untouched.
--
-- Pre-apply backup of the only modified table: public.counterparties_backup_20260904.
--
-- WHY THIS IS NEEDED
-- `counterparties` (migration 002, business_id added in 017) currently holds only:
--     id, user_id, business_id, name, group_name, type, email, phone, notes,
--     is_active, created_at, updated_at
--
-- It has NO column for NPWP, aliases, address, PKP status, default category or
-- default tax treatment, no bank-account table, and NO jsonb column to hold any of
-- them safely. Counterparty Intelligence V1 cannot match on NPWP or bank account —
-- its two strongest signals — without somewhere to store them.
--
-- Everything below is additive. No column is dropped, no type is changed, no data
-- is rewritten, and every statement is re-runnable.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. counterparties: identity, classification and integration fields ──────
ALTER TABLE public.counterparties
  -- `name` stays the display value every existing caller reads. legal_name is the
  -- registered form used for matching; both are kept because they legitimately differ.
  ADD COLUMN IF NOT EXISTS legal_name             TEXT NULL,
  ADD COLUMN IF NOT EXISTS display_name           TEXT NULL,
  -- Digits only, normalised by the application. Not UNIQUE: a business may hold two
  -- records mid-cleanup, and a hard constraint would fail the import rather than
  -- surface the duplicate for a human to resolve.
  ADD COLUMN IF NOT EXISTS npwp                   TEXT NULL,
  ADD COLUMN IF NOT EXISTS pkp_status             TEXT NULL,
  ADD COLUMN IF NOT EXISTS address                TEXT NULL,
  -- Alternate spellings seen on documents ("Circle K", bank account holder names).
  ADD COLUMN IF NOT EXISTS aliases                TEXT[] NULL,
  ADD COLUMN IF NOT EXISTS default_category       TEXT NULL,
  -- A SUGGESTION for the accountant. Never an activated tax rule.
  ADD COLUMN IF NOT EXISTS default_tax_treatment  TEXT NULL,
  ADD COLUMN IF NOT EXISTS status                 TEXT NOT NULL DEFAULT 'active',
  -- Integration-ready (Phase 9). Unused until an external sync exists.
  ADD COLUMN IF NOT EXISTS source_system          TEXT NULL,
  ADD COLUMN IF NOT EXISTS external_id            TEXT NULL,
  ADD COLUMN IF NOT EXISTS external_url           TEXT NULL,
  ADD COLUMN IF NOT EXISTS last_synced_at         TIMESTAMPTZ NULL;

-- Value constraints added separately so a re-run cannot fail on an existing one.
DO $$ BEGIN
  ALTER TABLE public.counterparties
    ADD CONSTRAINT counterparties_status_chk CHECK (status IN ('active','archived'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.counterparties
    ADD CONSTRAINT counterparties_pkp_chk CHECK (pkp_status IS NULL OR pkp_status IN ('unknown','pkp','non_pkp'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- `type` is deliberately NOT constrained here. It already holds legacy values
-- ('client','supplier','franchisee','owner', ...) and a CHECK would reject rows
-- that exist today. The application maps type -> role; tightening it is its own task.

-- Backfill display/legal name from the existing column. Idempotent.
UPDATE public.counterparties SET display_name = name WHERE display_name IS NULL;
UPDATE public.counterparties SET legal_name   = name WHERE legal_name   IS NULL;
-- is_active is the pre-existing flag; keep status consistent with it.
UPDATE public.counterparties SET status = 'archived' WHERE is_active = FALSE AND status <> 'archived';

-- ── 2. bank accounts ────────────────────────────────────────────────────────
-- A separate table rather than a jsonb blob: account number is a matching key and
-- needs its own index, and one counterparty legitimately has several accounts.
CREATE TABLE IF NOT EXISTS public.counterparty_bank_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  counterparty_id UUID NOT NULL REFERENCES public.counterparties(id) ON DELETE CASCADE,
  bank_name       TEXT NULL,
  account_number  TEXT NOT NULL,
  -- Digits only. Generated so matching never depends on the application
  -- remembering to normalise, and so the uniqueness below is meaningful.
  account_number_normalized TEXT GENERATED ALWAYS AS (regexp_replace(account_number, '\D', '', 'g')) STORED,
  account_name    TEXT NULL,
  currency        TEXT NOT NULL DEFAULT 'IDR',
  is_primary      BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_user_id BIGINT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The same account may not be registered twice against one counterparty.
CREATE UNIQUE INDEX IF NOT EXISTS cp_bank_acct_uniq
  ON public.counterparty_bank_accounts (counterparty_id, account_number_normalized);

-- ── 3. matching indexes ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS counterparties_business_npwp_idx
  ON public.counterparties (business_id, npwp) WHERE npwp IS NOT NULL;
CREATE INDEX IF NOT EXISTS counterparties_business_status_idx
  ON public.counterparties (business_id, status);
CREATE INDEX IF NOT EXISTS counterparties_external_idx
  ON public.counterparties (business_id, source_system, external_id)
  WHERE source_system IS NOT NULL AND external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cp_bank_acct_business_idx
  ON public.counterparty_bank_accounts (business_id, account_number_normalized);

-- Idempotent upsert key for a future CRM/ERP sync: one external record maps to one
-- counterparty per business.
CREATE UNIQUE INDEX IF NOT EXISTS counterparties_external_uniq
  ON public.counterparties (business_id, source_system, external_id)
  WHERE source_system IS NOT NULL AND external_id IS NOT NULL;

-- ── 4. business isolation ───────────────────────────────────────────────────
-- Same pattern as migration 031: the child's business_id must equal its parent's,
-- enforced in the database rather than trusted from the application.
CREATE OR REPLACE FUNCTION public.fn_iso_counterparty_bank_accounts() RETURNS trigger AS $$
BEGIN
  IF (SELECT business_id FROM public.counterparties WHERE id = NEW.counterparty_id)
     IS DISTINCT FROM NEW.business_id THEN
    RAISE EXCEPTION 'isolation: counterparty belongs to another business';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_iso_cp_bank_accounts ON public.counterparty_bank_accounts;
CREATE TRIGGER trg_iso_cp_bank_accounts
  BEFORE INSERT OR UPDATE ON public.counterparty_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.fn_iso_counterparty_bank_accounts();

-- ── 5. verification (run after applying) ────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name='counterparties' AND column_name IN
--   ('legal_name','display_name','npwp','pkp_status','aliases','status','source_system');
-- SELECT COUNT(*) AS counterparties_without_status FROM public.counterparties WHERE status IS NULL;
-- SELECT COUNT(*) AS bank_accounts FROM public.counterparty_bank_accounts;

-- ── NOT INCLUDED, deliberately ──────────────────────────────────────────────
-- * No counterparty FK on `debts`. debts.counterparty is TEXT today and several
--   routes write it; converting it is a data migration with its own risk and
--   belongs in a separate change.
-- * No API-key tables. Scoped keys, rotation, revocation and rate limits are a
--   security surface that should not be bolted onto this migration.
-- * No RLS policy changes.
