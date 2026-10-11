-- Migration 033 — Intercompany relationships, funding & settlement
-- Date: 2026-06-15. ADDITIVE + IDEMPOTENT. No DROP, NO seed, NO cash. Needs 031.
-- intercompany_balances is a read-only VIEW recomputed from the allocation
-- ledger — it is never inserted/updated directly.

BEGIN;

CREATE TABLE IF NOT EXISTS business_relationships (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  to_business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  relationship_type TEXT NOT NULL CHECK (relationship_type IN
    ('parent','subsidiary','sister_company','related_party','funding_company','operating_company','management_company')),
  status            TEXT NOT NULL DEFAULT 'active',
  effective_from    DATE NULL,
  effective_to      DATE NULL,
  created_by_user_id BIGINT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  CHECK (from_business_id <> to_business_id),
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS business_relationships_uniq
  ON business_relationships(from_business_id, to_business_id, relationship_type, effective_from);

CREATE TABLE IF NOT EXISTS intercompany_funding_records (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id            UUID NOT NULL REFERENCES business_relationships(id) ON DELETE RESTRICT,
  economic_owner_business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  cash_payer_business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  currency                   TEXT NOT NULL DEFAULT 'IDR',
  funded_amount              NUMERIC(20,2) NOT NULL CHECK (funded_amount > 0),
  funding_type               TEXT NOT NULL CHECK (funding_type IN
    ('vendor_payment','tax_payment','payroll','expense_reimbursement','working_capital','loan','advance','other')),
  status                     TEXT NOT NULL DEFAULT 'draft',  -- draft|confirmed|partially_repaid|repaid|cancelled|disputed
  funded_debt_id             BIGINT NULL REFERENCES debts(id) ON DELETE RESTRICT,
  funded_transaction_id      BIGINT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  funded_tax_treatment_id    UUID NULL REFERENCES tax_treatments(id) ON DELETE RESTRICT,
  funded_compliance_event_id UUID NULL REFERENCES compliance_events(id) ON DELETE RESTRICT,
  description                TEXT NULL,
  funded_at                  TIMESTAMPTZ NULL,
  created_by_user_id         BIGINT NULL,
  created_at                 TIMESTAMPTZ DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ DEFAULT NOW(),
  CHECK (economic_owner_business_id <> cash_payer_business_id)
);
CREATE INDEX IF NOT EXISTS ic_funding_payer_idx ON intercompany_funding_records(cash_payer_business_id, status);
CREATE INDEX IF NOT EXISTS ic_funding_owner_idx ON intercompany_funding_records(economic_owner_business_id, status);

-- Guard: the cash payment belongs to the cash payer; the funded obligation
-- belongs to the economic owner. Cross-business is allowed ONLY here.
CREATE OR REPLACE FUNCTION fn_ic_funding_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.funded_transaction_id IS NOT NULL AND
     (SELECT business_id FROM transactions WHERE id = NEW.funded_transaction_id) IS DISTINCT FROM NEW.cash_payer_business_id THEN
    RAISE EXCEPTION 'funded transaction must belong to the cash payer business';
  END IF;
  IF NEW.funded_debt_id IS NOT NULL AND
     (SELECT business_id FROM debts WHERE id = NEW.funded_debt_id) IS DISTINCT FROM NEW.economic_owner_business_id THEN
    RAISE EXCEPTION 'funded debt must belong to the economic owner business';
  END IF;
  IF NEW.funded_tax_treatment_id IS NOT NULL AND
     (SELECT business_id FROM tax_treatments WHERE id = NEW.funded_tax_treatment_id) IS DISTINCT FROM NEW.economic_owner_business_id THEN
    RAISE EXCEPTION 'funded tax treatment must belong to the economic owner business';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_ic_funding_guard ON intercompany_funding_records;
CREATE TRIGGER trg_ic_funding_guard BEFORE INSERT OR UPDATE ON intercompany_funding_records
  FOR EACH ROW EXECUTE FUNCTION fn_ic_funding_guard();

CREATE TABLE IF NOT EXISTS intercompany_settlement_allocations (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_relationship_id UUID NOT NULL REFERENCES business_relationships(id) ON DELETE RESTRICT,
  funding_record_id        UUID NOT NULL REFERENCES intercompany_funding_records(id) ON DELETE RESTRICT,
  repayment_transaction_id BIGINT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  allocated_amount         NUMERIC(20,2) NOT NULL CHECK (allocated_amount > 0),
  created_by_user_id       BIGINT NULL,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (funding_record_id, repayment_transaction_id)
);
CREATE INDEX IF NOT EXISTS ic_settle_funding_idx ON intercompany_settlement_allocations(funding_record_id);

-- Guard: sum(settlement) <= funded_amount; repayment paid by the economic owner.
CREATE OR REPLACE FUNCTION fn_ic_settlement_guard() RETURNS trigger AS $$
DECLARE f_amount NUMERIC; f_owner UUID; allocated NUMERIC;
BEGIN
  SELECT funded_amount, economic_owner_business_id INTO f_amount, f_owner
    FROM intercompany_funding_records WHERE id = NEW.funding_record_id FOR UPDATE;
  IF f_amount IS NULL THEN RAISE EXCEPTION 'funding record % not found', NEW.funding_record_id; END IF;
  IF (SELECT business_id FROM transactions WHERE id = NEW.repayment_transaction_id) IS DISTINCT FROM f_owner THEN
    RAISE EXCEPTION 'repayment transaction must belong to the economic owner (debtor) business';
  END IF;
  SELECT COALESCE(SUM(allocated_amount),0) INTO allocated
    FROM intercompany_settlement_allocations WHERE funding_record_id = NEW.funding_record_id AND id <> NEW.id;
  IF allocated + NEW.allocated_amount > f_amount + 0.005 THEN
    RAISE EXCEPTION 'over-allocation: funding % would be % > %', NEW.funding_record_id, allocated + NEW.allocated_amount, f_amount;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_ic_settlement_guard ON intercompany_settlement_allocations;
CREATE TRIGGER trg_ic_settlement_guard BEFORE INSERT OR UPDATE ON intercompany_settlement_allocations
  FOR EACH ROW EXECUTE FUNCTION fn_ic_settlement_guard();

-- Read-only derived balances. creditor = cash payer (due_from); debtor =
-- economic owner (due_to). outstanding = funded - repaid.
CREATE OR REPLACE VIEW intercompany_balances AS
WITH repaid AS (
  SELECT funding_record_id, SUM(allocated_amount) AS repaid
  FROM intercompany_settlement_allocations GROUP BY funding_record_id
)
SELECT f.relationship_id,
       f.cash_payer_business_id     AS creditor_business_id,
       f.economic_owner_business_id AS debtor_business_id,
       f.currency,
       SUM(f.funded_amount)                              AS funded_total,
       COALESCE(SUM(r.repaid),0)                         AS repaid_total,
       SUM(f.funded_amount) - COALESCE(SUM(r.repaid),0)  AS outstanding,  -- due_from(creditor)=due_to(debtor)
       MAX(f.updated_at)                                 AS last_activity_at
FROM intercompany_funding_records f
LEFT JOIN repaid r ON r.funding_record_id = f.id
WHERE f.status IN ('confirmed','partially_repaid','repaid')
GROUP BY f.relationship_id, f.cash_payer_business_id, f.economic_owner_business_id, f.currency;

COMMIT;

-- ── Verify ───────────────────────────────────────────────────────────────────
SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN
  ('business_relationships','intercompany_funding_records','intercompany_settlement_allocations')
UNION ALL SELECT table_name FROM information_schema.views WHERE table_schema='public' AND table_name='intercompany_balances'
ORDER BY 1;
