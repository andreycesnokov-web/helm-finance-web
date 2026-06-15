-- Migration 028 — Intercompany relationships, funding & settlement
-- Date: 2026-06-15
-- ADDITIVE + IDEMPOTENT. No DROP, NO seed, NO cash movement. Depends on 026.
-- The allocation ledger is the source of truth; intercompany_balances is a
-- derived read model maintained by the app (never edited directly).

-- ── Related companies (a relationship grants NO data access by itself) ───────
CREATE TABLE IF NOT EXISTS business_relationships (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  to_business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  relationship_type TEXT NOT NULL CHECK (relationship_type IN
    ('parent','subsidiary','sister_company','related_party','funding_company','operating_company','management_company')),
  status            TEXT NOT NULL DEFAULT 'active',  -- active | inactive | ended
  effective_from    DATE NULL,
  effective_to      DATE NULL,
  created_by_user_id BIGINT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  CHECK (from_business_id <> to_business_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS business_relationships_uniq
  ON business_relationships(from_business_id, to_business_id, relationship_type, effective_from);

-- ── Intercompany funding: Company A pays an obligation owned by Company B ─────
CREATE TABLE IF NOT EXISTS intercompany_funding_records (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id            UUID NOT NULL REFERENCES business_relationships(id) ON DELETE RESTRICT,
  economic_owner_business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  cash_payer_business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  currency                   TEXT NOT NULL DEFAULT 'IDR',
  funded_amount              NUMERIC(20,2) NOT NULL CHECK (funded_amount > 0),
  funding_type               TEXT NOT NULL CHECK (funding_type IN
    ('vendor_payment','tax_payment','payroll','expense_reimbursement','working_capital','loan','advance','other')),
  status                     TEXT NOT NULL DEFAULT 'draft',
  -- draft | confirmed | partially_repaid | repaid | cancelled | disputed
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

-- ── Repayment allocations (cannot exceed outstanding funding — app-enforced) ─
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

-- ── Derived read model (maintained by app from the allocation ledger) ────────
CREATE TABLE IF NOT EXISTS intercompany_balances (
  relationship_id  UUID NOT NULL REFERENCES business_relationships(id) ON DELETE CASCADE,
  from_business_id UUID NOT NULL,
  to_business_id   UUID NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'IDR',
  due_from_amount  NUMERIC(20,2) NOT NULL DEFAULT 0,
  due_to_amount    NUMERIC(20,2) NOT NULL DEFAULT 0,
  last_activity_at TIMESTAMPTZ NULL,
  PRIMARY KEY (relationship_id, currency)
);

-- ── Verify ───────────────────────────────────────────────────────────────────
SELECT table_name FROM information_schema.tables
WHERE table_schema='public' AND table_name IN
  ('business_relationships','intercompany_funding_records','intercompany_settlement_allocations','intercompany_balances')
ORDER BY table_name;
