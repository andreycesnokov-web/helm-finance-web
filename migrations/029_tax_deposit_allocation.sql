-- Migration 029 — Tax deposit accounts, entries & allocations
-- Date: 2026-06-15
-- ADDITIVE + IDEMPOTENT. No DROP, NO seed, NO cash movement. Depends on 026.
-- A tax deposit (e.g. KAP-KJS 411618-100) is paid first and allocated later;
-- a deposit is NOT a paid/filed tax until allocated to a specific obligation.

CREATE TABLE IF NOT EXISTS tax_deposit_accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  currency    TEXT NOT NULL DEFAULT 'IDR',
  status      TEXT NOT NULL DEFAULT 'active',  -- active | closed
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tax_deposit_accounts_business_idx ON tax_deposit_accounts(business_id);

CREATE TABLE IF NOT EXISTS tax_deposit_entries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  deposit_account_id  UUID NOT NULL REFERENCES tax_deposit_accounts(id) ON DELETE RESTRICT,
  entry_type          TEXT NOT NULL CHECK (entry_type IN ('deposit_payment','allocation','refund','adjustment')),
  amount              NUMERIC(20,2) NOT NULL CHECK (amount > 0),
  transaction_id      BIGINT NULL REFERENCES transactions(id) ON DELETE RESTRICT,   -- the cash-out for a deposit_payment
  billing_document_id UUID NULL REFERENCES financial_documents(id) ON DELETE RESTRICT,
  tax_allocation_id   UUID NULL,                 -- set for entry_type='allocation' (-> tax_deposit_allocations.id)
  occurred_at         TIMESTAMPTZ NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tax_deposit_entries_acct_idx ON tax_deposit_entries(deposit_account_id, entry_type);

-- Allocation of deposit balance to exactly ONE tax obligation.
CREATE TABLE IF NOT EXISTS tax_deposit_allocations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id          UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  deposit_entry_id     UUID NOT NULL REFERENCES tax_deposit_entries(id) ON DELETE RESTRICT,
  tax_treatment_id     UUID NULL REFERENCES tax_treatments(id) ON DELETE RESTRICT,
  withholding_record_id UUID NULL REFERENCES withholding_records(id) ON DELETE RESTRICT,
  compliance_event_id  UUID NULL REFERENCES compliance_events(id) ON DELETE RESTRICT,
  allocated_amount     NUMERIC(20,2) NOT NULL CHECK (allocated_amount > 0),
  allocated_by_user_id BIGINT NULL,
  allocated_at         TIMESTAMPTZ DEFAULT NOW(),
  CHECK ( (tax_treatment_id IS NOT NULL)::int + (withholding_record_id IS NOT NULL)::int + (compliance_event_id IS NOT NULL)::int = 1 )
);
CREATE INDEX IF NOT EXISTS tax_deposit_alloc_entry_idx ON tax_deposit_allocations(deposit_entry_id);

-- ── Verify ───────────────────────────────────────────────────────────────────
SELECT table_name FROM information_schema.tables
WHERE table_schema='public' AND table_name IN
  ('tax_deposit_accounts','tax_deposit_entries','tax_deposit_allocations')
ORDER BY table_name;
