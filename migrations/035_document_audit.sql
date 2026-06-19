-- Migration 035 — Document audit trail (append-only)
-- Date: 2026-06-19. ADDITIVE + IDEMPOTENT + TRANSACTIONAL. No DROP, NO seed, NO cash.
-- Proposed by Tax Documents Runtime V1. NOT APPLIED TO PRODUCTION — awaiting approval.
-- Runtime logs to this table best-effort: if the table is absent, document
-- operations still succeed (the audit write is swallowed). Apply this to turn the
-- audit trail on. Needs 031 (financial_documents).

BEGIN;

CREATE TABLE IF NOT EXISTS document_audit (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  document_id   UUID NULL REFERENCES financial_documents(id) ON DELETE SET NULL,
  actor_user_id BIGINT NULL,
  channel       TEXT NULL,          -- web | telegram | mobile | whatsapp | api
  action        TEXT NOT NULL,      -- uploaded | metadata_changed | linked | unlinked | archived | signed_url_issued
  target_type   TEXT NULL,          -- debt | transaction | compliance (for link/unlink)
  target_id     TEXT NULL,          -- polymorphic: debts/transactions are bigint, compliance is uuid
  metadata      JSONB NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS document_audit_business_idx ON document_audit(business_id, created_at);
CREATE INDEX IF NOT EXISTS document_audit_document_idx ON document_audit(document_id);

-- Append-only at the DB level (disable for maintenance: DISABLE TRIGGER).
CREATE OR REPLACE FUNCTION fn_document_audit_no_mutate() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'document_audit is append-only (% blocked)', TG_OP; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS document_audit_append_only ON document_audit;
CREATE TRIGGER document_audit_append_only BEFORE UPDATE OR DELETE ON document_audit
  FOR EACH ROW EXECUTE FUNCTION fn_document_audit_no_mutate();

COMMIT;

-- ── Verify ───────────────────────────────────────────────────────────────────
SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name='document_audit';
