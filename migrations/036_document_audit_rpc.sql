-- Migration 036 — Atomic document mutation + audit RPCs  (PROPOSED, NOT APPLIED)
-- Date: 2026-06-19. ADDITIVE + IDEMPOTENT + TRANSACTIONAL. No DROP, NO seed, NO cash.
-- Needs 031 (financial_documents + link tables) and 035 (document_audit).
--
-- WHY: best-effort audit is acceptable for read-only events (view / signed-url /
-- download) but NOT for critical mutations (upload-complete, metadata update,
-- link, unlink, archive). These RPCs perform the mutation AND the audit insert
-- in a SINGLE function-local transaction, so if the audit write fails the
-- mutation is rolled back — production never silently succeeds without an audit.
--
-- This migration is PROPOSED and awaiting approval. It is NOT applied and the
-- runtime is NOT yet wired to these RPCs. Do not edit 035 after it is applied.

BEGIN;

-- Archive (soft) + audit, atomically.
CREATE OR REPLACE FUNCTION rpc_document_archive(p_document_id uuid, p_business_id uuid, p_actor bigint)
RETURNS financial_documents AS $$
DECLARE r financial_documents;
BEGIN
  UPDATE financial_documents SET archived_at = NOW(), updated_at = NOW()
   WHERE id = p_document_id AND business_id = p_business_id RETURNING * INTO r;
  IF r.id IS NULL THEN RAISE EXCEPTION 'document % not found in business %', p_document_id, p_business_id; END IF;
  INSERT INTO document_audit(business_id, document_id, actor_user_id, channel, action)
    VALUES (p_business_id, p_document_id, p_actor, 'web', 'archived');
  RETURN r;
END $$ LANGUAGE plpgsql;

-- Update safe metadata + audit, atomically.
CREATE OR REPLACE FUNCTION rpc_document_update_metadata(p_document_id uuid, p_business_id uuid, p_actor bigint, p_patch jsonb)
RETURNS financial_documents AS $$
DECLARE r financial_documents;
BEGIN
  UPDATE financial_documents SET
    document_type        = COALESCE(p_patch->>'document_type', document_type),
    document_number      = COALESCE(p_patch->>'document_number', document_number),
    document_date        = COALESCE((p_patch->>'document_date')::date, document_date),
    currency             = COALESCE(p_patch->>'currency', currency),
    gross_amount         = COALESCE((p_patch->>'gross_amount')::numeric, gross_amount),
    issuer_counterparty_id = COALESCE((p_patch->>'issuer_counterparty_id')::uuid, issuer_counterparty_id),
    updated_at           = NOW()
   WHERE id = p_document_id AND business_id = p_business_id RETURNING * INTO r;
  IF r.id IS NULL THEN RAISE EXCEPTION 'document % not found', p_document_id; END IF;
  INSERT INTO document_audit(business_id, document_id, actor_user_id, channel, action)
    VALUES (p_business_id, p_document_id, p_actor, 'web', 'metadata_changed');
  RETURN r;
END $$ LANGUAGE plpgsql;

-- Link to a ledger record (debt/transaction/compliance) + audit, atomically.
-- The DB business-isolation triggers from 031 still enforce same-business.
CREATE OR REPLACE FUNCTION rpc_document_link(p_document_id uuid, p_business_id uuid, p_target_type text, p_target_id text, p_actor bigint)
RETURNS uuid AS $$
DECLARE v_link uuid;
BEGIN
  IF p_target_type = 'debt' THEN
    INSERT INTO document_debt_links(business_id, document_id, debt_id, created_by_user_id)
      VALUES (p_business_id, p_document_id, p_target_id::bigint, p_actor) RETURNING id INTO v_link;
  ELSIF p_target_type = 'transaction' THEN
    INSERT INTO document_transaction_links(business_id, document_id, transaction_id, created_by_user_id)
      VALUES (p_business_id, p_document_id, p_target_id::bigint, p_actor) RETURNING id INTO v_link;
  ELSIF p_target_type = 'compliance' THEN
    INSERT INTO document_compliance_links(business_id, document_id, compliance_event_id, created_by_user_id)
      VALUES (p_business_id, p_document_id, p_target_id::uuid, p_actor) RETURNING id INTO v_link;
  ELSE RAISE EXCEPTION 'invalid target_type %', p_target_type; END IF;
  INSERT INTO document_audit(business_id, document_id, actor_user_id, channel, action, target_type, target_id)
    VALUES (p_business_id, p_document_id, p_actor, 'web', 'linked', p_target_type, p_target_id);
  RETURN v_link;
END $$ LANGUAGE plpgsql;

-- Unlink + audit, atomically.
CREATE OR REPLACE FUNCTION rpc_document_unlink(p_link_id uuid, p_document_id uuid, p_business_id uuid, p_actor bigint)
RETURNS boolean AS $$
DECLARE v_type text;
BEGIN
  DELETE FROM document_debt_links WHERE id = p_link_id AND business_id = p_business_id AND document_id = p_document_id;
  IF FOUND THEN v_type := 'debt'; END IF;
  IF v_type IS NULL THEN
    DELETE FROM document_transaction_links WHERE id = p_link_id AND business_id = p_business_id AND document_id = p_document_id;
    IF FOUND THEN v_type := 'transaction'; END IF;
  END IF;
  IF v_type IS NULL THEN
    DELETE FROM document_compliance_links WHERE id = p_link_id AND business_id = p_business_id AND document_id = p_document_id;
    IF FOUND THEN v_type := 'compliance'; END IF;
  END IF;
  IF v_type IS NULL THEN RAISE EXCEPTION 'link % not found', p_link_id; END IF;
  INSERT INTO document_audit(business_id, document_id, actor_user_id, channel, action, target_type)
    VALUES (p_business_id, p_document_id, p_actor, 'web', 'unlinked', v_type);
  RETURN true;
END $$ LANGUAGE plpgsql;

COMMIT;

-- ── Verify ───────────────────────────────────────────────────────────────────
SELECT routine_name FROM information_schema.routines
 WHERE routine_schema='public' AND routine_name LIKE 'rpc_document_%' ORDER BY 1;
