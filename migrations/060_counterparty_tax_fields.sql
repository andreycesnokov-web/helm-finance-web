-- Migration 060 — Counterparty tax fields: entity form, payment terms
-- (Design v2, proposal P-04)
--
-- Approved by the owner in _specs/design-v2/DECISIONS.md (3 Oct 2026).
-- NOT APPLIED anywhere by this change. The owner applies migrations.
--
-- WHAT
--   counterparties.entity_form         — pt | cv | person | foreign | other. What kind of
--                                        party this is, as the owner states it.
--   counterparties.payment_terms_days  — usual days between the bill/invoice and payment.
--
--   The new LANDLORD and LENDER roles need no column: the role lives in the existing
--   `type` column, which migration 055 deliberately left unconstrained. They are added to
--   the application role list (server/lib/counterpartyIntelligence.js ROLES).
--
-- RULE MAPPING STAYS IN THE VERIFIED RULE ENGINE. entity_form is an input the accountant
-- and the rule engine may read. Nothing here, and nothing in the UI, turns it into a tax
-- rate or an obligation. A suggestion shown next to it comes from GET /api/accountant/rules
-- (active, verified rules only).
--
-- NO FINANCIAL EFFECT. No debt, transaction, wallet or document changes.
--
-- ADDITIVE and IDEMPOTENT. Two nullable columns, two CHECKs. Existing rows keep NULL.
--
-- WRITES go through the existing POST/PATCH /api/counterparties. Setting these two fields
-- needs owner/ceo/admin/cfo/accountant; every write is already audited there.

BEGIN;

ALTER TABLE public.counterparties
  ADD COLUMN IF NOT EXISTS entity_form        TEXT    NULL,
  ADD COLUMN IF NOT EXISTS payment_terms_days INTEGER NULL;

DO $$ BEGIN
  ALTER TABLE public.counterparties
    ADD CONSTRAINT counterparties_entity_form_chk
    CHECK (entity_form IS NULL OR entity_form IN ('pt','cv','person','foreign','other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.counterparties
    ADD CONSTRAINT counterparties_payment_terms_days_chk
    CHECK (payment_terms_days IS NULL OR (payment_terms_days BETWEEN 0 AND 365));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.counterparties.entity_form IS
  'Design v2 P-04: pt | cv | person | foreign | other. Owner-stated; the rule engine decides any tax treatment.';
COMMENT ON COLUMN public.counterparties.payment_terms_days IS
  'Design v2 P-04: usual payment terms in days (0..365). NULL = not set.';

COMMIT;

-- ── verification (run after applying) ────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'counterparties' AND column_name IN ('entity_form','payment_terms_days');
-- SELECT count(*) FROM public.counterparties WHERE entity_form IS NOT NULL;  -- 0 right after apply
--
-- ── rollback (only if needed) ────────────────────────────────────────────────
-- ALTER TABLE public.counterparties DROP CONSTRAINT IF EXISTS counterparties_payment_terms_days_chk;
-- ALTER TABLE public.counterparties DROP CONSTRAINT IF EXISTS counterparties_entity_form_chk;
-- ALTER TABLE public.counterparties DROP COLUMN IF EXISTS payment_terms_days;
-- ALTER TABLE public.counterparties DROP COLUMN IF EXISTS entity_form;
