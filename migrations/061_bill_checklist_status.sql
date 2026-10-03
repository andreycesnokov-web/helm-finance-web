-- Migration 061 — Bill checklist: accountant check (Design v2, proposal P-05)
--
-- Approved by the owner in _specs/design-v2/DECISIONS.md (3 Oct 2026), reworked to
-- option B ("Final decisions for the remaining work", item 1): the withholding slip is NOT
-- stored here. It lives in one place only, withholding_records.bukti_potong_document_id
-- (migration 031), and the bill checklist reads it from there.
-- NOT APPLIED anywhere by this change. The owner applies migrations.
--
-- WHAT
--   debts.accountant_checked_at — when an accountant marked the bill as checked.
--   debts.accountant_checked_by — who did (platform user id).
--
-- "NOTHING CLOSES ON ITS OWN." This is a status mark a person sets. Setting it never pays,
-- settles, approves or files anything, and nothing reads it to do so.
--
-- ADDITIVE and IDEMPOTENT. Two nullable columns and one CHECK. Existing rows keep NULL.
-- No existing column, constraint, index or trigger is changed.
--
-- WRITES go through PATCH /api/debts/:id/checklist only: owner/ceo/admin/cfo/accountant,
-- each change written to audit_events. POST /api/debts strips these fields from its body.

BEGIN;

ALTER TABLE public.debts
  ADD COLUMN IF NOT EXISTS accountant_checked_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS accountant_checked_by BIGINT      NULL;

-- Checked-at and checked-by are set and cleared together.
DO $$ BEGIN
  ALTER TABLE public.debts
    ADD CONSTRAINT debts_accountant_check_pair_chk
    CHECK ((accountant_checked_at IS NULL) = (accountant_checked_by IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.debts.accountant_checked_at IS
  'Design v2 P-05: when an accountant marked this bill checked. A status mark only.';

COMMIT;

-- ── verification (run after applying) ────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'debts'
--   AND column_name IN ('accountant_checked_at','accountant_checked_by');            -- 2 rows
-- SELECT count(*) FROM public.debts WHERE accountant_checked_at IS NOT NULL;         -- 0 right after apply
--
-- ── rollback (only if needed) ────────────────────────────────────────────────
-- ALTER TABLE public.debts DROP CONSTRAINT IF EXISTS debts_accountant_check_pair_chk;
-- ALTER TABLE public.debts DROP COLUMN IF EXISTS accountant_checked_by;
-- ALTER TABLE public.debts DROP COLUMN IF EXISTS accountant_checked_at;
