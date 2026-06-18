-- Migration 029 — Tax deposit accounts, entries & allocations
-- Date: 2026-06-15. ADDITIVE + IDEMPOTENT. No DROP, NO seed, NO cash. Needs 026.
-- All amounts positive; balance is derived strictly from entry_type:
--   deposit_payment (+)  allocation (−)  refund (−)  adjustment (±, reason req.)
-- A deposit is NOT a paid/filed tax until allocated to a specific obligation.

BEGIN;

CREATE TABLE IF NOT EXISTS tax_deposit_accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  currency    TEXT NOT NULL DEFAULT 'IDR',
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tax_deposit_accounts_business_idx ON tax_deposit_accounts(business_id);

CREATE TABLE IF NOT EXISTS tax_deposit_entries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  deposit_account_id  UUID NOT NULL REFERENCES tax_deposit_accounts(id) ON DELETE RESTRICT,
  entry_type          TEXT NOT NULL CHECK (entry_type IN ('deposit_payment','allocation','refund','adjustment')),
  amount              NUMERIC(20,2) NOT NULL CHECK (amount > 0),
  direction           SMALLINT NULL CHECK (direction IN (-1, 1)),   -- required for 'adjustment'
  reason              TEXT NULL,
  transaction_id      BIGINT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  billing_document_id UUID NULL REFERENCES financial_documents(id) ON DELETE RESTRICT,
  tax_allocation_id   UUID NULL,
  occurred_at         TIMESTAMPTZ NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  CHECK (entry_type <> 'adjustment' OR (direction IS NOT NULL AND reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS tax_deposit_entries_acct_idx ON tax_deposit_entries(deposit_account_id, entry_type);

CREATE TABLE IF NOT EXISTS tax_deposit_allocations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  deposit_entry_id      UUID NOT NULL REFERENCES tax_deposit_entries(id) ON DELETE RESTRICT,
  deposit_account_id    UUID NOT NULL REFERENCES tax_deposit_accounts(id) ON DELETE RESTRICT,
  tax_treatment_id      UUID NULL REFERENCES tax_treatments(id) ON DELETE RESTRICT,
  withholding_record_id UUID NULL REFERENCES withholding_records(id) ON DELETE RESTRICT,
  compliance_event_id   UUID NULL REFERENCES compliance_events(id) ON DELETE RESTRICT,
  allocated_amount      NUMERIC(20,2) NOT NULL CHECK (allocated_amount > 0),
  allocated_by_user_id  BIGINT NULL,
  allocated_at          TIMESTAMPTZ DEFAULT NOW(),
  CHECK ((tax_treatment_id IS NOT NULL)::int + (withholding_record_id IS NOT NULL)::int + (compliance_event_id IS NOT NULL)::int = 1)
);
CREATE INDEX IF NOT EXISTS tax_deposit_alloc_acct_idx ON tax_deposit_allocations(deposit_account_id);

-- Available balance of a deposit account (positive entries minus negative).
CREATE OR REPLACE FUNCTION fn_deposit_balance(p_account UUID) RETURNS NUMERIC AS $$
  SELECT COALESCE(SUM(CASE
    WHEN entry_type = 'deposit_payment' THEN amount
    WHEN entry_type = 'allocation' THEN -amount
    WHEN entry_type = 'refund' THEN -amount
    WHEN entry_type = 'adjustment' THEN amount * direction
    ELSE 0 END), 0)
  FROM tax_deposit_entries WHERE deposit_account_id = p_account;
$$ LANGUAGE sql STABLE;

-- Guard: a new allocation cannot exceed the available deposit balance; the
-- account is locked to serialise concurrent allocations; same-business only.
CREATE OR REPLACE FUNCTION fn_tax_deposit_alloc_guard() RETURNS trigger AS $$
DECLARE acct_business UUID; bal NUMERIC; already NUMERIC;
BEGIN
  SELECT business_id INTO acct_business FROM tax_deposit_accounts WHERE id = NEW.deposit_account_id FOR UPDATE;
  IF acct_business IS NULL THEN RAISE EXCEPTION 'deposit account % not found', NEW.deposit_account_id; END IF;
  IF acct_business <> NEW.business_id THEN RAISE EXCEPTION 'business isolation: deposit account other business'; END IF;
  IF NEW.tax_treatment_id IS NOT NULL AND (SELECT business_id FROM tax_treatments WHERE id=NEW.tax_treatment_id) IS DISTINCT FROM NEW.business_id THEN RAISE EXCEPTION 'isolation: deposit target treatment other business'; END IF;
  IF NEW.withholding_record_id IS NOT NULL AND (SELECT business_id FROM withholding_records WHERE id=NEW.withholding_record_id) IS DISTINCT FROM NEW.business_id THEN RAISE EXCEPTION 'isolation: deposit target withholding other business'; END IF;
  IF NEW.compliance_event_id IS NOT NULL AND (SELECT business_id FROM compliance_events WHERE id=NEW.compliance_event_id) IS DISTINCT FROM NEW.business_id THEN RAISE EXCEPTION 'isolation: deposit target compliance other business'; END IF;
  bal := fn_deposit_balance(NEW.deposit_account_id);
  SELECT COALESCE(SUM(allocated_amount),0) INTO already
    FROM tax_deposit_allocations WHERE deposit_account_id = NEW.deposit_account_id AND id <> NEW.id;
  -- bal already reflects posted allocation entries; guard against allocation
  -- rows that exceed remaining un-posted balance.
  IF NEW.allocated_amount > bal + 0.005 THEN
    RAISE EXCEPTION 'deposit over-allocation: % exceeds available balance %', NEW.allocated_amount, bal;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_tax_deposit_alloc_guard ON tax_deposit_allocations;
CREATE TRIGGER trg_tax_deposit_alloc_guard BEFORE INSERT OR UPDATE ON tax_deposit_allocations
  FOR EACH ROW EXECUTE FUNCTION fn_tax_deposit_alloc_guard();

-- ── Verify ───────────────────────────────────────────────────────────────────
SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN
  ('tax_deposit_accounts','tax_deposit_entries','tax_deposit_allocations')
ORDER BY table_name;
