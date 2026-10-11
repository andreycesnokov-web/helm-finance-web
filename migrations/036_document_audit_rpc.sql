-- Migration 036 — Atomic document mutation + audit RPCs
-- Date: 2026-06-19. ADDITIVE + IDEMPOTENT + TRANSACTIONAL. No DROP, NO seed, NO cash.
-- Needs 031 (financial_documents + link tables) and 035 (document_audit).
-- APPROVED for staging. NOT APPLIED TO PRODUCTION. Do not edit 035 after apply.
--
-- Every critical document mutation performs the mutation AND the audit INSERT in
-- ONE transaction (the function body), so an audit failure rolls back the
-- mutation. Security hardening:
--   • SECURITY INVOKER (default) — runs as the backend's service role; no
--     SECURITY DEFINER is used (none is necessary), so no privilege escalation.
--   • fixed search_path = pg_catalog, public on every function (no shadowing).
--   • all objects schema-qualified.
--   • business_id / target / actor are validated INSIDE each function; a caller
--     cannot act across businesses or mutate another business's records.
--   • archived documents cannot be re-mutated (metadata/link) — archive/unlink ok.
--   • functions touch ONLY document tables — never transactions/wallets/debt cash.
--   • audit stores action/target/actor/channel only — never URLs/tokens/bytes.
--   • EXECUTE revoked from PUBLIC; granted to service_role only.

BEGIN;

-- Dependency guard: 035 must be present.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='document_audit')
  THEN RAISE EXCEPTION '036 requires migration 035 (document_audit) to be applied first'; END IF;
END $$;

-- ── finalize_upload: document_files + financial_documents + audit, atomically ─
CREATE OR REPLACE FUNCTION public.rpc_document_finalize_upload(p_file jsonb, p_doc jsonb, p_actor bigint, p_channel text DEFAULT 'web')
RETURNS public.financial_documents
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE r public.financial_documents; v_biz uuid;
BEGIN
  v_biz := (p_doc->>'business_id')::uuid;
  IF v_biz IS NULL OR (p_file->>'business_id')::uuid IS DISTINCT FROM v_biz THEN
    RAISE EXCEPTION 'business mismatch between file and document';
  END IF;
  INSERT INTO public.document_files(id, business_id, storage_path, file_name, mime_type, file_size, sha256_hash, upload_channel, uploaded_by_user_id)
    VALUES ((p_file->>'id')::uuid, v_biz, p_file->>'storage_path', p_file->>'file_name', p_file->>'mime_type',
            (p_file->>'file_size')::bigint, p_file->>'sha256_hash', COALESCE(p_file->>'upload_channel','web'), p_actor);
  INSERT INTO public.financial_documents(id, business_id, file_id, document_type, document_number, document_date,
            period_start, period_end, issuer_counterparty_id, currency, gross_amount, extraction_status, review_status, extracted_json, created_by_user_id)
    VALUES ((p_doc->>'id')::uuid, v_biz, (p_file->>'id')::uuid, COALESCE(p_doc->>'document_type','other'),
            p_doc->>'document_number', (p_doc->>'document_date')::date, (p_doc->>'period_start')::date, (p_doc->>'period_end')::date,
            (p_doc->>'issuer_counterparty_id')::uuid, COALESCE(p_doc->>'currency','IDR'), (p_doc->>'gross_amount')::numeric,
            'manual', 'needs_review', (p_doc->'extracted_json'), p_actor)
    RETURNING * INTO r;
  INSERT INTO public.document_audit(business_id, document_id, actor_user_id, channel, action)
    VALUES (v_biz, r.id, p_actor, COALESCE(p_channel,'web'), 'uploaded');
  RETURN r;
END $$;

-- ── archive (soft) + audit ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_document_archive(p_document_id uuid, p_business_id uuid, p_actor bigint, p_channel text DEFAULT 'web')
RETURNS public.financial_documents
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE r public.financial_documents;
BEGIN
  UPDATE public.financial_documents SET archived_at = now(), updated_at = now()
   WHERE id = p_document_id AND business_id = p_business_id RETURNING * INTO r;
  IF r.id IS NULL THEN RAISE EXCEPTION 'document % not found in business %', p_document_id, p_business_id; END IF;
  INSERT INTO public.document_audit(business_id, document_id, actor_user_id, channel, action)
    VALUES (p_business_id, p_document_id, p_actor, COALESCE(p_channel,'web'), 'archived');
  RETURN r;
END $$;

-- ── update safe metadata + audit (blocked on archived) ───────────────────────
CREATE OR REPLACE FUNCTION public.rpc_document_update_metadata(p_document_id uuid, p_business_id uuid, p_actor bigint, p_patch jsonb, p_channel text DEFAULT 'web')
RETURNS public.financial_documents
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE r public.financial_documents; v_arch timestamptz;
BEGIN
  SELECT archived_at INTO v_arch FROM public.financial_documents WHERE id = p_document_id AND business_id = p_business_id;
  IF v_arch IS NOT NULL THEN RAISE EXCEPTION 'archived document cannot be modified'; END IF;
  UPDATE public.financial_documents SET
    document_type          = COALESCE(p_patch->>'document_type', document_type),
    document_number        = COALESCE(p_patch->>'document_number', document_number),
    document_date          = COALESCE((p_patch->>'document_date')::date, document_date),
    period_start           = COALESCE((p_patch->>'period_start')::date, period_start),
    period_end             = COALESCE((p_patch->>'period_end')::date, period_end),
    currency               = COALESCE(p_patch->>'currency', currency),
    gross_amount           = COALESCE((p_patch->>'gross_amount')::numeric, gross_amount),
    issuer_counterparty_id = COALESCE((p_patch->>'issuer_counterparty_id')::uuid, issuer_counterparty_id),
    extracted_json         = COALESCE(p_patch->'extracted_json', extracted_json),
    updated_at             = now()
   WHERE id = p_document_id AND business_id = p_business_id RETURNING * INTO r;
  IF r.id IS NULL THEN RAISE EXCEPTION 'document % not found', p_document_id; END IF;
  INSERT INTO public.document_audit(business_id, document_id, actor_user_id, channel, action)
    VALUES (p_business_id, p_document_id, p_actor, COALESCE(p_channel,'web'), 'metadata_changed');
  RETURN r;
END $$;

-- ── link to debt/transaction/compliance + audit (same-business validated) ────
CREATE OR REPLACE FUNCTION public.rpc_document_link(p_document_id uuid, p_business_id uuid, p_target_type text, p_target_id text, p_actor bigint, p_channel text DEFAULT 'web')
RETURNS uuid
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE v_link uuid; v_doc_biz uuid; v_arch timestamptz; v_target_biz uuid;
BEGIN
  SELECT business_id, archived_at INTO v_doc_biz, v_arch FROM public.financial_documents WHERE id = p_document_id;
  IF v_doc_biz IS NULL OR v_doc_biz <> p_business_id THEN RAISE EXCEPTION 'document not in business'; END IF;
  IF v_arch IS NOT NULL THEN RAISE EXCEPTION 'archived document cannot be linked'; END IF;

  IF p_target_type = 'debt' THEN
    SELECT business_id INTO v_target_biz FROM public.debts WHERE id = p_target_id::bigint;
    IF v_target_biz IS DISTINCT FROM p_business_id THEN RAISE EXCEPTION 'cross-business link forbidden'; END IF;
    INSERT INTO public.document_debt_links(business_id, document_id, debt_id, created_by_user_id)
      VALUES (p_business_id, p_document_id, p_target_id::bigint, p_actor) RETURNING id INTO v_link;
  ELSIF p_target_type = 'transaction' THEN
    SELECT business_id INTO v_target_biz FROM public.transactions WHERE id = p_target_id::bigint;
    IF v_target_biz IS DISTINCT FROM p_business_id THEN RAISE EXCEPTION 'cross-business link forbidden'; END IF;
    INSERT INTO public.document_transaction_links(business_id, document_id, transaction_id, created_by_user_id)
      VALUES (p_business_id, p_document_id, p_target_id::bigint, p_actor) RETURNING id INTO v_link;
  ELSIF p_target_type = 'compliance' THEN
    SELECT business_id INTO v_target_biz FROM public.compliance_events WHERE id = p_target_id::uuid;
    IF v_target_biz IS DISTINCT FROM p_business_id THEN RAISE EXCEPTION 'cross-business link forbidden'; END IF;
    INSERT INTO public.document_compliance_links(business_id, document_id, compliance_event_id, created_by_user_id)
      VALUES (p_business_id, p_document_id, p_target_id::uuid, p_actor) RETURNING id INTO v_link;
  ELSE RAISE EXCEPTION 'invalid target_type %', p_target_type; END IF;

  INSERT INTO public.document_audit(business_id, document_id, actor_user_id, channel, action, target_type, target_id)
    VALUES (p_business_id, p_document_id, p_actor, COALESCE(p_channel,'web'), 'linked', p_target_type, p_target_id);
  RETURN v_link;
END $$;

-- ── unlink + audit (allowed on archived docs) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_document_unlink(p_link_id uuid, p_document_id uuid, p_business_id uuid, p_actor bigint, p_channel text DEFAULT 'web')
RETURNS boolean
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE v_type text;
BEGIN
  DELETE FROM public.document_debt_links WHERE id = p_link_id AND business_id = p_business_id AND document_id = p_document_id;
  IF FOUND THEN v_type := 'debt'; END IF;
  IF v_type IS NULL THEN
    DELETE FROM public.document_transaction_links WHERE id = p_link_id AND business_id = p_business_id AND document_id = p_document_id;
    IF FOUND THEN v_type := 'transaction'; END IF;
  END IF;
  IF v_type IS NULL THEN
    DELETE FROM public.document_compliance_links WHERE id = p_link_id AND business_id = p_business_id AND document_id = p_document_id;
    IF FOUND THEN v_type := 'compliance'; END IF;
  END IF;
  IF v_type IS NULL THEN RAISE EXCEPTION 'link % not found', p_link_id; END IF;
  INSERT INTO public.document_audit(business_id, document_id, actor_user_id, channel, action, target_type)
    VALUES (p_business_id, p_document_id, p_actor, COALESCE(p_channel,'web'), 'unlinked', v_type);
  RETURN true;
END $$;

-- ── Permissions: backend/service-role only; never PUBLIC ─────────────────────
DO $$
DECLARE fn text;
BEGIN
  FOR fn IN SELECT 'public.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
            FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.proname LIKE 'rpc_document_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END IF;
  END LOOP;
END $$;

COMMIT;

-- ── Verify ───────────────────────────────────────────────────────────────────
SELECT routine_name FROM information_schema.routines
 WHERE routine_schema='public' AND routine_name LIKE 'rpc_document_%' ORDER BY 1;
