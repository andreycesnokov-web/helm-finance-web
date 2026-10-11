-- Production `public` schema snapshot, 2026-10-08 — STRUCTURE ONLY, no data.
-- Built from the 2026-08-27 production schema plus migrations 045–068, then compared with the
-- live production catalog: per-table column signatures (name, type, nullability, default) for all
-- 83 tables, all 457 constraints (incl. every FK and its ON DELETE rule), 245 indexes, 41 triggers
-- and the 50 function signatures are identical. Known difference: 5 function bodies differ only in
-- formatting/line endings (fn_iso_assets, fn_iso_business_funding_records,
-- fn_iso_business_funding_repayments, rpc_execute_wallet_transfer, rpc_record_debt_payment).
-- Used by integration tests that must run against the real schema instead of a hand-written one.
-- Regenerate: pg_dump -s -n public --no-owner --no-privileges, then drop the psql \restrict lines,
-- `SET transaction_timeout` (PG17-only) and `CREATE SCHEMA public` / its comment.
--
-- PostgreSQL database dump
--


-- Dumped from database version 17.11
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--



--
-- Name: apply_notification_grants(uuid, bigint, bigint, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_notification_grants(p_business_id uuid, p_user_id bigint, p_granted_by bigint, p_actor_role text, p_changes jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  k TEXT;
  v BOOLEAN;
  prev BOOLEAN;
  changed INT := 0;
  v_actor_role TEXT;   -- DERIVED from business_members; the only role trusted for auth/audit
  ALLOWED TEXT[] := ARRAY['company_financial','tax_compliance','payables_receivables',
                          'documents_review','team_approvals','ai_cfo_summary'];
BEGIN
  IF p_business_id IS NULL OR p_user_id IS NULL OR p_granted_by IS NULL OR p_changes IS NULL
     OR jsonb_typeof(p_changes) <> 'object' THEN
    RAISE EXCEPTION 'invalid_arguments';
  END IF;

  -- ── ACTOR AUTHORIZATION (defence in depth) ────────────────────────────────
  -- Derive the actor's LIVE role from an ACTIVE membership in THIS business. A missing, inactive,
  -- removed, or cross-business actor yields NULL. v0: only 'owner' may grant/revoke. This runs
  -- BEFORE any write, so a forbidden actor produces no grant change and no audit row.
  --
  -- FOR UPDATE locks the actor's membership row, so a concurrent demotion/deactivation of the ACTOR
  -- serialises with this grant instead of racing it (mirroring the target lock below):
  --   * grant-first  → the grant is made while the actor is still a valid owner, then the demotion
  --                    commits; the grant stands as an authorised-at-the-time decision.
  --   * demote-first → this lock waits, then re-reads the now-non-owner role and raises
  --                    actor_not_authorized. No ordering lets a just-demoted owner slip a grant
  --                    through.
  -- On deadlocks: normal API calls (owner actor, CEO/CFO target) cannot form an actor/target lock
  -- cycle — the API only ever calls this with an owner granting a distinct CEO/CFO. Pathological
  -- direct service_role misuse (e.g. two callers locking the same rows in opposite order) could in
  -- principle deadlock; if it does, PostgreSQL aborts one transaction, and because everything here
  -- is one transaction, atomicity is preserved — no partial grant or audit survives.
  SELECT role INTO v_actor_role
    FROM business_members
    WHERE business_id = p_business_id AND user_id = p_granted_by AND status = 'active'
    LIMIT 1
    FOR UPDATE;
  IF v_actor_role IS NULL OR v_actor_role <> 'owner' THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;

  -- ── TARGET lock + eligibility (unchanged from 046) ────────────────────────
  -- Lock the TARGET member row first so a concurrent demotion/deactivation serialises with this
  -- grant instead of racing it (grant-first -> disabled by the demotion trigger; demote-first ->
  -- the re-read below raises member_not_grantable).
  PERFORM 1 FROM business_members
    WHERE business_id = p_business_id AND user_id = p_user_id
    FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1 FROM business_members
    WHERE business_id = p_business_id AND user_id = p_user_id
      AND status = 'active' AND role IN ('ceo','cfo')
  ) THEN
    RAISE EXCEPTION 'member_not_grantable';
  END IF;

  FOR k, v IN SELECT key, value::boolean FROM jsonb_each_text(p_changes) LOOP
    IF NOT (k = ANY(ALLOWED)) THEN
      RAISE EXCEPTION 'unknown_category';
    END IF;

    SELECT enabled INTO prev FROM business_member_notification_grants
      WHERE business_id = p_business_id AND user_id = p_user_id AND category = k;

    INSERT INTO business_member_notification_grants
      (business_id, user_id, category, enabled, granted_by_user_id)
    VALUES (p_business_id, p_user_id, k, v, p_granted_by)
    ON CONFLICT (business_id, user_id, category)
    DO UPDATE SET enabled = EXCLUDED.enabled,
                  granted_by_user_id = EXCLUDED.granted_by_user_id,
                  updated_at = now();

    -- Audit only real transitions. actor_role is the DERIVED v_actor_role, never the caller's
    -- p_actor_role — the audit trail cannot be spoofed by a caller-supplied role string.
    IF prev IS DISTINCT FROM v THEN
      INSERT INTO audit_events
        (business_id, actor_user_id, actor_role, channel, entity_type, entity_id, action, before_json, after_json)
      VALUES (p_business_id, p_granted_by, v_actor_role, 'web', 'notification_grant', p_user_id::text,
              CASE WHEN v THEN 'granted' ELSE 'revoked' END,
              jsonb_build_object('category', k, 'enabled', COALESCE(prev, false)),
              jsonb_build_object('category', k, 'enabled', v));
      changed := changed + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('changed', changed);
END $$;


--
-- Name: audit_events_no_mutate(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_events_no_mutate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only (% blocked)', TG_OP;
END;
$$;


--
-- Name: fn_access_audit_no_mutate(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_access_audit_no_mutate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN RAISE EXCEPTION 'access_audit is append-only (% blocked)', TG_OP; END $$;


--
-- Name: fn_bmng_reset_grants_on_membership_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_bmng_reset_grants_on_membership_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE r RECORD;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.role   IS NOT DISTINCT FROM OLD.role
     AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;   -- not a transition; grants are left exactly as they are
  END IF;

  FOR r IN
    SELECT category FROM business_member_notification_grants
    WHERE business_id = NEW.business_id AND user_id = NEW.user_id AND enabled = true
  LOOP
    UPDATE business_member_notification_grants
      SET enabled = false, updated_at = now()
      WHERE business_id = NEW.business_id AND user_id = NEW.user_id AND category = r.category;
    -- System-attributed: the actor of a membership change is not trusted here, and an auto-revoke
    -- is the database enforcing an invariant, not a person acting. NULL actor + 'system' channel
    -- records that honestly rather than blaming whoever happened to trigger it.
    INSERT INTO audit_events
      (business_id, actor_user_id, actor_role, channel, entity_type, entity_id, action, before_json, after_json)
    VALUES (NEW.business_id, NULL, 'system', 'system', 'notification_grant', NEW.user_id::text,
            'auto_revoked',
            jsonb_build_object('category', r.category, 'enabled', true),
            jsonb_build_object('category', r.category, 'enabled', false, 'reason', 'membership_change'));
  END LOOP;
  RETURN NEW;
END $$;


--
-- Name: fn_business_code_default(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_business_code_default() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.business_code IS NULL THEN
    NEW.business_code := 'HF-BIZ-' || LPAD(nextval('business_code_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END $$;


--
-- Name: fn_business_code_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_business_code_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.business_code IS NOT NULL AND NEW.business_code IS DISTINCT FROM OLD.business_code THEN
    RAISE EXCEPTION 'business_code is immutable (% -> %)', OLD.business_code, NEW.business_code;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'business id is immutable'; END IF;
  RETURN NEW;
END $$;


--
-- Name: fn_business_member_notification_grants_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_business_member_notification_grants_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;


--
-- Name: fn_debt_settlement_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_debt_settlement_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE ceiling NUMERIC; legacy_paid NUMERIC; d_business UUID; allocated NUMERIC; available NUMERIC;
BEGIN
  SELECT COALESCE(original_amount, amount), COALESCE(paid_amount,0), business_id
    INTO ceiling, legacy_paid, d_business FROM debts WHERE id=NEW.debt_id FOR UPDATE;
  IF ceiling IS NULL THEN RAISE EXCEPTION 'debt % not found', NEW.debt_id; END IF;
  IF d_business <> NEW.business_id THEN RAISE EXCEPTION 'isolation: debt other business'; END IF;
  IF NEW.transaction_id IS NOT NULL AND (SELECT business_id FROM transactions WHERE id=NEW.transaction_id) IS DISTINCT FROM NEW.business_id
    THEN RAISE EXCEPTION 'isolation: settlement transaction other business (use intercompany funding)'; END IF;
  IF NEW.withholding_record_id IS NOT NULL AND (SELECT business_id FROM withholding_records WHERE id=NEW.withholding_record_id) IS DISTINCT FROM NEW.business_id
    THEN RAISE EXCEPTION 'isolation: settlement withholding other business'; END IF;
  available := ceiling - legacy_paid;
  SELECT COALESCE(SUM(allocated_amount),0) INTO allocated FROM debt_settlement_allocations WHERE debt_id=NEW.debt_id AND id<>NEW.id;
  IF allocated + NEW.allocated_amount > available + 0.005 THEN
    RAISE EXCEPTION 'over-allocation: debt % alloc % + % > available % (ceiling % - legacy paid %)',
      NEW.debt_id, allocated, NEW.allocated_amount, available, ceiling, legacy_paid; END IF;
  RETURN NEW; END $$;


--
-- Name: fn_deposit_balance(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_deposit_balance(p_account uuid) RETURNS numeric
    LANGUAGE sql STABLE
    AS $$
  SELECT COALESCE(SUM(CASE
    WHEN entry_type = 'deposit_payment' THEN amount
    WHEN entry_type = 'allocation' THEN -amount
    WHEN entry_type = 'refund' THEN -amount
    WHEN entry_type = 'adjustment' THEN amount * direction
    ELSE 0 END), 0)
  FROM tax_deposit_entries WHERE deposit_account_id = p_account;
$$;


--
-- Name: fn_document_audit_no_mutate(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_document_audit_no_mutate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN RAISE EXCEPTION 'document_audit is append-only (% blocked)', TG_OP; END $$;


--
-- Name: fn_email_identity_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_email_identity_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;


--
-- Name: fn_ic_funding_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_ic_funding_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
END $$;


--
-- Name: fn_ic_settlement_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_ic_settlement_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
END $$;


--
-- Name: fn_incoming_payment_candidate_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_incoming_payment_candidate_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_biz UUID;
BEGIN
  SELECT business_id INTO v_biz FROM incoming_payments WHERE id = NEW.incoming_payment_id;
  IF v_biz IS NULL OR v_biz <> NEW.business_id THEN
    RAISE EXCEPTION 'candidate business_id must match its incoming payment';
  END IF;

  IF NEW.target_debt_id IS NOT NULL THEN
    SELECT business_id INTO v_biz FROM debts WHERE id = NEW.target_debt_id;
    IF v_biz IS DISTINCT FROM NEW.business_id THEN
      RAISE EXCEPTION 'candidate target debt belongs to a different business';
    END IF;
  END IF;

  IF NEW.target_transaction_id IS NOT NULL THEN
    SELECT business_id INTO v_biz FROM transactions WHERE id = NEW.target_transaction_id;
    IF v_biz IS DISTINCT FROM NEW.business_id THEN
      RAISE EXCEPTION 'candidate target transaction belongs to a different business';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END $$;


--
-- Name: fn_incoming_payments_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_incoming_payments_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;


--
-- Name: fn_iso_assets(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_iso_assets() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.purchase_debt_id IS NOT NULL AND (SELECT business_id FROM public.debts WHERE id = NEW.purchase_debt_id) IS DISTINCT FROM NEW.business_id
    THEN RAISE EXCEPTION 'isolation: asset bill belongs to another business'; END IF;
  IF NEW.purchase_transaction_id IS NOT NULL AND (SELECT business_id FROM public.transactions WHERE id = NEW.purchase_transaction_id) IS DISTINCT FROM NEW.business_id
    THEN RAISE EXCEPTION 'isolation: asset payment belongs to another business'; END IF;
  IF NEW.purchase_document_id IS NOT NULL AND (SELECT business_id FROM public.financial_documents WHERE id = NEW.purchase_document_id) IS DISTINCT FROM NEW.business_id
    THEN RAISE EXCEPTION 'isolation: asset document belongs to another business'; END IF;
  IF NEW.supplier_counterparty_id IS NOT NULL AND (SELECT business_id FROM public.counterparties WHERE id = NEW.supplier_counterparty_id) IS DISTINCT FROM NEW.business_id
    THEN RAISE EXCEPTION 'isolation: asset supplier belongs to another business'; END IF;
  RETURN NEW;
END $$;


--
-- Name: fn_iso_bank_import_batch_document(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_iso_bank_import_batch_document() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.document_id IS NOT NULL THEN
    IF (SELECT business_id FROM public.financial_documents WHERE id = NEW.document_id) IS DISTINCT FROM NEW.business_id THEN
      RAISE EXCEPTION 'isolation: bank_import_batches document_id belongs to another business';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: fn_iso_business_funding_records(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_iso_business_funding_records() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.counterparty_id IS NOT NULL AND (SELECT business_id FROM public.counterparties WHERE id = NEW.counterparty_id) IS DISTINCT FROM NEW.business_id
    THEN RAISE EXCEPTION 'isolation: lender belongs to another business'; END IF;
  IF NEW.received_transaction_id IS NOT NULL AND (SELECT business_id FROM public.transactions WHERE id = NEW.received_transaction_id) IS DISTINCT FROM NEW.business_id
    THEN RAISE EXCEPTION 'isolation: funding transaction belongs to another business'; END IF;
  RETURN NEW;
END $$;


--
-- Name: fn_iso_business_funding_repayments(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_iso_business_funding_repayments() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE rec_business UUID; rec_instrument TEXT;
BEGIN
  SELECT business_id, instrument INTO rec_business, rec_instrument FROM public.business_funding_records WHERE id = NEW.funding_record_id;
  IF rec_business IS DISTINCT FROM NEW.business_id THEN RAISE EXCEPTION 'isolation: repayment belongs to another business'; END IF;
  IF rec_instrument <> 'loan' THEN RAISE EXCEPTION 'only a loan has repayments'; END IF;
  IF NEW.paid_transaction_id IS NOT NULL AND (SELECT business_id FROM public.transactions WHERE id = NEW.paid_transaction_id) IS DISTINCT FROM NEW.business_id
    THEN RAISE EXCEPTION 'isolation: repayment transaction belongs to another business'; END IF;
  RETURN NEW;
END $$;


--
-- Name: fn_iso_counterparty_bank_accounts(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_iso_counterparty_bank_accounts() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (SELECT business_id FROM public.counterparties WHERE id = NEW.counterparty_id)
     IS DISTINCT FROM NEW.business_id THEN
    RAISE EXCEPTION 'isolation: counterparty belongs to another business';
  END IF;
  RETURN NEW;
END $$;


--
-- Name: fn_iso_doc_comp_links(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_iso_doc_comp_links() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (SELECT business_id FROM financial_documents WHERE id=NEW.document_id) IS DISTINCT FROM NEW.business_id
     OR (SELECT business_id FROM compliance_events WHERE id=NEW.compliance_event_id) IS DISTINCT FROM NEW.business_id
  THEN RAISE EXCEPTION 'isolation: document_compliance_links cross-business'; END IF;
  RETURN NEW; END $$;


--
-- Name: fn_iso_doc_debt_links(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_iso_doc_debt_links() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (SELECT business_id FROM financial_documents WHERE id=NEW.document_id) IS DISTINCT FROM NEW.business_id
     OR (SELECT business_id FROM debts WHERE id=NEW.debt_id) IS DISTINCT FROM NEW.business_id
  THEN RAISE EXCEPTION 'isolation: document_debt_links cross-business'; END IF;
  RETURN NEW; END $$;


--
-- Name: fn_iso_doc_tx_links(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_iso_doc_tx_links() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (SELECT business_id FROM financial_documents WHERE id=NEW.document_id) IS DISTINCT FROM NEW.business_id
     OR (SELECT business_id FROM transactions WHERE id=NEW.transaction_id) IS DISTINCT FROM NEW.business_id
  THEN RAISE EXCEPTION 'isolation: document_transaction_links cross-business'; END IF;
  RETURN NEW; END $$;


--
-- Name: fn_iso_document_links(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_iso_document_links() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (SELECT business_id FROM financial_documents WHERE id=NEW.source_document_id) IS DISTINCT FROM NEW.business_id
     OR (SELECT business_id FROM financial_documents WHERE id=NEW.target_document_id) IS DISTINCT FROM NEW.business_id
  THEN RAISE EXCEPTION 'isolation: document_links cross-business'; END IF;
  RETURN NEW; END $$;


--
-- Name: fn_iso_financial_documents(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_iso_financial_documents() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (SELECT business_id FROM document_files WHERE id=NEW.file_id) IS DISTINCT FROM NEW.business_id THEN RAISE EXCEPTION 'isolation: file other business'; END IF;
  IF NEW.issuer_counterparty_id IS NOT NULL AND (SELECT business_id FROM counterparties WHERE id=NEW.issuer_counterparty_id) IS DISTINCT FROM NEW.business_id THEN RAISE EXCEPTION 'isolation: counterparty other business'; END IF;
  RETURN NEW; END $$;


--
-- Name: fn_iso_tax_treatments(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_iso_tax_treatments() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.debt_id IS NOT NULL AND (SELECT business_id FROM debts WHERE id=NEW.debt_id) IS DISTINCT FROM NEW.business_id THEN RAISE EXCEPTION 'isolation: treatment debt other business'; END IF;
  IF NEW.invoice_document_id IS NOT NULL AND (SELECT business_id FROM financial_documents WHERE id=NEW.invoice_document_id) IS DISTINCT FROM NEW.business_id THEN RAISE EXCEPTION 'isolation: treatment invoice other business'; END IF;
  RETURN NEW; END $$;


--
-- Name: fn_iso_withholding(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_iso_withholding() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.tax_treatment_id IS NOT NULL AND (SELECT business_id FROM tax_treatments WHERE id=NEW.tax_treatment_id) IS DISTINCT FROM NEW.business_id THEN RAISE EXCEPTION 'isolation: withholding treatment other business'; END IF;
  IF NEW.debt_id IS NOT NULL AND (SELECT business_id FROM debts WHERE id=NEW.debt_id) IS DISTINCT FROM NEW.business_id THEN RAISE EXCEPTION 'isolation: withholding debt other business'; END IF;
  RETURN NEW; END $$;


--
-- Name: fn_onboarding_touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_onboarding_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;


--
-- Name: fn_payment_credential_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_payment_credential_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_biz UUID; v_provider TEXT; v_env TEXT;
BEGIN
  SELECT business_id, provider, environment
    INTO v_biz, v_provider, v_env
    FROM payment_provider_connections WHERE id = NEW.connection_id;

  IF v_biz IS NULL THEN
    RAISE EXCEPTION 'credential references a connection that does not exist';
  END IF;
  IF v_biz <> NEW.business_id THEN
    RAISE EXCEPTION 'credential business_id must match its connection';
  END IF;
  IF v_provider IS DISTINCT FROM NEW.provider THEN
    RAISE EXCEPTION 'credential provider must match its connection';
  END IF;
  IF v_env IS DISTINCT FROM NEW.environment THEN
    RAISE EXCEPTION 'credential environment must match its connection';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END $$;


--
-- Name: fn_payment_provider_connections_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_payment_provider_connections_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;


--
-- Name: fn_personal_v1_owner_only_membership(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_personal_v1_owner_only_membership() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_type text;
  v_owner bigint;
BEGIN
  SELECT type, owner_user_id
    INTO v_type, v_owner
    FROM public.businesses
   WHERE id = NEW.business_id;

  IF v_type = 'personal'
     AND NEW.user_id IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'personal workspace is owner-only in V1';
  END IF;

  RETURN NEW;
END
$$;


--
-- Name: fn_support_conversation_created_event(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_support_conversation_created_event() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO support_events (conversation_id, business_id, actor_user_id, event_type, event_payload)
  VALUES (NEW.id, NEW.business_id, NEW.created_by_user_id, 'conversation_created',
          jsonb_build_object('channel', NEW.channel, 'category', NEW.category,
                             'priority', NEW.priority));
  RETURN NULL;
END $$;


--
-- Name: fn_support_conversations_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_support_conversations_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;


--
-- Name: fn_support_message_touch_conversation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_support_message_touch_conversation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE support_conversations
     SET last_message_at = NEW.created_at
   WHERE id = NEW.conversation_id;

  INSERT INTO support_events (conversation_id, business_id, actor_user_id, event_type, event_payload)
  VALUES (NEW.conversation_id, NEW.business_id, NEW.sender_user_id, 'message_created',
          -- Metadata only. The body stays in support_messages and is never copied here.
          jsonb_build_object('message_id', NEW.id,
                             'sender_type', NEW.sender_type,
                             'is_internal', NEW.is_internal));
  RETURN NULL;
END $$;


--
-- Name: fn_tax_billing_alloc_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_tax_billing_alloc_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE nominal NUMERIC; doc_business UUID; allocated NUMERIC;
BEGIN
  SELECT COALESCE(gross_amount, official_tax_amount), business_id INTO nominal, doc_business
    FROM financial_documents WHERE id = NEW.billing_document_id FOR UPDATE;
  IF doc_business IS DISTINCT FROM NEW.business_id THEN RAISE EXCEPTION 'business isolation: billing doc other business'; END IF;
  IF NEW.tax_treatment_id IS NOT NULL AND (SELECT business_id FROM tax_treatments WHERE id=NEW.tax_treatment_id) IS DISTINCT FROM NEW.business_id THEN RAISE EXCEPTION 'isolation: billing target treatment other business'; END IF;
  IF NEW.withholding_record_id IS NOT NULL AND (SELECT business_id FROM withholding_records WHERE id=NEW.withholding_record_id) IS DISTINCT FROM NEW.business_id THEN RAISE EXCEPTION 'isolation: billing target withholding other business'; END IF;
  IF NEW.compliance_event_id IS NOT NULL AND (SELECT business_id FROM compliance_events WHERE id=NEW.compliance_event_id) IS DISTINCT FROM NEW.business_id THEN RAISE EXCEPTION 'isolation: billing target compliance other business'; END IF;
  IF nominal IS NOT NULL THEN
    SELECT COALESCE(SUM(allocated_amount),0) INTO allocated
      FROM tax_billing_allocations WHERE billing_document_id = NEW.billing_document_id AND id <> NEW.id;
    IF allocated + NEW.allocated_amount > nominal + 0.005 THEN
      RAISE EXCEPTION 'over-allocation: billing % would be % > nominal %', NEW.billing_document_id, allocated + NEW.allocated_amount, nominal;
    END IF;
  END IF;
  RETURN NEW;
END $$;


--
-- Name: fn_tax_deposit_alloc_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_tax_deposit_alloc_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
  IF NEW.allocated_amount > bal + 0.005 THEN
    RAISE EXCEPTION 'deposit over-allocation: % exceeds available balance %', NEW.allocated_amount, bal;
  END IF;
  RETURN NEW;
END $$;


--
-- Name: fn_telegram_user_state_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_telegram_user_state_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;


--
-- Name: fn_user_channel_state_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_user_channel_state_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;


--
-- Name: fn_wht_payment_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_wht_payment_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE w_amount NUMERIC; w_business UUID; allocated NUMERIC;
BEGIN
  SELECT withholding_amount, business_id INTO w_amount, w_business FROM withholding_records WHERE id=NEW.withholding_record_id FOR UPDATE;
  IF w_amount IS NULL THEN RAISE EXCEPTION 'withholding % missing amount', NEW.withholding_record_id; END IF;
  IF w_business <> NEW.business_id THEN RAISE EXCEPTION 'isolation: withholding other business'; END IF;
  IF (SELECT business_id FROM transactions WHERE id=NEW.transaction_id) IS DISTINCT FROM NEW.business_id THEN RAISE EXCEPTION 'isolation: tax payment transaction other business'; END IF;
  SELECT COALESCE(SUM(allocated_amount),0) INTO allocated FROM withholding_payment_allocations WHERE withholding_record_id=NEW.withholding_record_id AND id<>NEW.id;
  IF allocated + NEW.allocated_amount > w_amount + 0.005 THEN RAISE EXCEPTION 'over-allocation: withholding % %>%', NEW.withholding_record_id, allocated+NEW.allocated_amount, w_amount; END IF;
  RETURN NEW; END $$;


--
-- Name: next_app_user_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.next_app_user_id() RETURNS bigint
    LANGUAGE sql
    SET search_path TO 'pg_catalog', 'public'
    AS $$ SELECT nextval('public.app_user_id_seq') $$;


--
-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


--
-- Name: rpc_delete_wallet_transfer(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_delete_wallet_transfer(p_business_id uuid, p_transfer_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.transactions
  WHERE business_id = p_business_id
    AND (transfer_id = p_transfer_id OR source = ('xfer:' || p_transfer_id::text));
  
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'deleted_legs', v_count,
    'transfer_id', p_transfer_id
  );
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: financial_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.financial_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    file_id uuid NOT NULL,
    page_start integer DEFAULT 1 NOT NULL,
    page_end integer DEFAULT 1 NOT NULL,
    document_type text NOT NULL,
    document_number text,
    document_date date,
    period_start date,
    period_end date,
    issuer_counterparty_id uuid,
    recipient_business_id uuid,
    currency text DEFAULT 'IDR'::text,
    commercial_base_amount numeric(20,2),
    commercial_tax_amount numeric(20,2),
    gross_amount numeric(20,2),
    official_tax_base numeric(20,2),
    official_tax_amount numeric(20,2),
    extraction_status text DEFAULT 'pending'::text NOT NULL,
    extracted_json jsonb,
    review_status text DEFAULT 'needs_review'::text NOT NULL,
    reviewed_by_user_id bigint,
    reviewed_at timestamp with time zone,
    created_by_user_id bigint,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    archived_at timestamp with time zone,
    CONSTRAINT financial_documents_check CHECK ((page_end >= page_start)),
    CONSTRAINT financial_documents_check1 CHECK (((period_start IS NULL) OR (period_end IS NULL) OR (period_end >= period_start))),
    CONSTRAINT financial_documents_commercial_base_amount_check CHECK (((commercial_base_amount IS NULL) OR (commercial_base_amount >= (0)::numeric))),
    CONSTRAINT financial_documents_commercial_tax_amount_check CHECK (((commercial_tax_amount IS NULL) OR (commercial_tax_amount >= (0)::numeric))),
    CONSTRAINT financial_documents_document_type_check CHECK ((document_type = ANY (ARRAY['vendor_invoice'::text, 'customer_invoice'::text, 'tax_invoice'::text, 'bukti_potong'::text, 'tax_billing'::text, 'payment_proof'::text, 'filing_confirmation'::text, 'bank_document'::text, 'other'::text]))),
    CONSTRAINT financial_documents_gross_amount_check CHECK (((gross_amount IS NULL) OR (gross_amount >= (0)::numeric))),
    CONSTRAINT financial_documents_official_tax_amount_check CHECK (((official_tax_amount IS NULL) OR (official_tax_amount >= (0)::numeric))),
    CONSTRAINT financial_documents_official_tax_base_check CHECK (((official_tax_base IS NULL) OR (official_tax_base >= (0)::numeric))),
    CONSTRAINT financial_documents_page_start_check CHECK ((page_start > 0))
);


--
-- Name: rpc_document_archive(uuid, uuid, bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_document_archive(p_document_id uuid, p_business_id uuid, p_actor bigint, p_channel text DEFAULT 'web'::text) RETURNS public.financial_documents
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
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


--
-- Name: rpc_document_finalize_upload(jsonb, jsonb, bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_document_finalize_upload(p_file jsonb, p_doc jsonb, p_actor bigint, p_channel text DEFAULT 'web'::text) RETURNS public.financial_documents
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
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


--
-- Name: rpc_document_link(uuid, uuid, text, text, bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_document_link(p_document_id uuid, p_business_id uuid, p_target_type text, p_target_id text, p_actor bigint, p_channel text DEFAULT 'web'::text) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
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


--
-- Name: rpc_document_unlink(uuid, uuid, uuid, bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_document_unlink(p_link_id uuid, p_document_id uuid, p_business_id uuid, p_actor bigint, p_channel text DEFAULT 'web'::text) RETURNS boolean
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
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


--
-- Name: rpc_document_update_metadata(uuid, uuid, bigint, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_document_update_metadata(p_document_id uuid, p_business_id uuid, p_actor bigint, p_patch jsonb, p_channel text DEFAULT 'web'::text) RETURNS public.financial_documents
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
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


--
-- Name: rpc_execute_wallet_transfer(uuid, bigint, uuid, uuid, numeric, text, numeric, numeric, numeric, text, numeric, numeric, text, text, date, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_execute_wallet_transfer(p_business_id uuid, p_user_id bigint, p_from_wallet_id uuid, p_to_wallet_id uuid, p_source_amount numeric, p_source_currency text, p_source_amount_idr numeric, p_source_booked_rate numeric, p_target_amount numeric, p_target_currency text, p_target_amount_idr numeric, p_target_booked_rate numeric, p_rate_source text, p_description text, p_transaction_date date, p_transfer_id uuid, p_scope text DEFAULT 'business'::text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_from_wallet RECORD;
  v_to_wallet RECORD;
  v_debit_id bigint;
  v_credit_id bigint;
  v_transfer_ref text;
  v_desc text;
BEGIN
  -- Validate amounts
  IF p_source_amount <= 0 OR p_target_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_transfer_amount: Source and target amounts must be greater than zero';
  END IF;

  -- Validate distinct wallets
  IF p_from_wallet_id = p_to_wallet_id THEN
    RAISE EXCEPTION 'cannot_transfer_to_same_wallet: Source and destination wallets must be different';
  END IF;

  -- Replay / idempotency protection: return existing record if transfer_id was already executed
  IF p_transfer_id IS NOT NULL THEN
    SELECT 
      MAX(CASE WHEN type = 'expense' THEN id END),
      MAX(CASE WHEN type = 'income' THEN id END)
    INTO v_debit_id, v_credit_id
    FROM public.transactions
    WHERE business_id = p_business_id AND transfer_id = p_transfer_id;

    IF v_debit_id IS NOT NULL OR v_credit_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok', true,
        'is_replay', true,
        'transfer_id', p_transfer_id,
        'debit_transaction_id', v_debit_id,
        'credit_transaction_id', v_credit_id,
        'from_wallet_id', p_from_wallet_id,
        'to_wallet_id', p_to_wallet_id,
        'source_amount', p_source_amount,
        'source_currency', upper(trim(p_source_currency)),
        'target_amount', p_target_amount,
        'target_currency', upper(trim(p_target_currency)),
        'transaction_date', p_transaction_date
      );
    END IF;
  END IF;

  -- Lock and verify source wallet (enforcing business workspace boundary)
  SELECT * INTO v_from_wallet
  FROM public.wallets
  WHERE id = p_from_wallet_id AND business_id = p_business_id AND is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'source_wallet_not_found: Source wallet does not exist or does not belong to active business';
  END IF;

  -- Lock and verify target wallet (enforcing business workspace boundary)
  SELECT * INTO v_to_wallet
  FROM public.wallets
  WHERE id = p_to_wallet_id AND business_id = p_business_id AND is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'target_wallet_not_found: Target wallet does not exist or does not belong to active business';
  END IF;

  -- Re-check transfer replay under wallet row locks
  IF p_transfer_id IS NOT NULL THEN
    SELECT 
      MAX(CASE WHEN type = 'expense' THEN id END),
      MAX(CASE WHEN type = 'income' THEN id END)
    INTO v_debit_id, v_credit_id
    FROM public.transactions
    WHERE business_id = p_business_id AND transfer_id = p_transfer_id;

    IF v_debit_id IS NOT NULL OR v_credit_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok', true,
        'is_replay', true,
        'transfer_id', p_transfer_id,
        'debit_transaction_id', v_debit_id,
        'credit_transaction_id', v_credit_id,
        'from_wallet_id', p_from_wallet_id,
        'to_wallet_id', p_to_wallet_id,
        'source_amount', p_source_amount,
        'source_currency', upper(trim(p_source_currency)),
        'target_amount', p_target_amount,
        'target_currency', upper(trim(p_target_currency)),
        'transaction_date', p_transaction_date
      );
    END IF;
  END IF;

  v_transfer_ref := 'xfer:' || p_transfer_id::text;
  v_desc := COALESCE(p_description, 'Transfer: ' || v_from_wallet.name || ' → ' || v_to_wallet.name);

  -- Insert Debit Leg (Expense from source wallet)
  INSERT INTO public.transactions (
    business_id,
    created_by_user_id,
    type,
    amount_original,
    currency_original,
    amount_idr,
    booked_rate,
    rate_source,
    description,
    source,
    wallet_id,
    scope,
    category,
    transaction_date,
    transfer_id
  ) VALUES (
    p_business_id,
    p_user_id,
    'expense',
    p_source_amount,
    upper(trim(p_source_currency)),
    p_source_amount_idr,
    p_source_booked_rate,
    p_rate_source,
    v_desc,
    v_transfer_ref,
    p_from_wallet_id,
    p_scope,
    'Transfer',
    p_transaction_date,
    p_transfer_id
  ) RETURNING id INTO v_debit_id;

  -- Insert Credit Leg (Income to destination wallet)
  INSERT INTO public.transactions (
    business_id,
    created_by_user_id,
    type,
    amount_original,
    currency_original,
    amount_idr,
    booked_rate,
    rate_source,
    description,
    source,
    wallet_id,
    scope,
    category,
    transaction_date,
    transfer_id
  ) VALUES (
    p_business_id,
    p_user_id,
    'income',
    p_target_amount,
    upper(trim(p_target_currency)),
    p_target_amount_idr,
    p_target_booked_rate,
    p_rate_source,
    v_desc,
    v_transfer_ref,
    p_to_wallet_id,
    p_scope,
    'Transfer',
    p_transaction_date,
    p_transfer_id
  ) RETURNING id INTO v_credit_id;

  RETURN jsonb_build_object(
    'ok', true,
    'transfer_id', p_transfer_id,
    'debit_transaction_id', v_debit_id,
    'credit_transaction_id', v_credit_id,
    'from_wallet_id', p_from_wallet_id,
    'to_wallet_id', p_to_wallet_id,
    'source_amount', p_source_amount,
    'source_currency', upper(trim(p_source_currency)),
    'target_amount', p_target_amount,
    'target_currency', upper(trim(p_target_currency)),
    'transaction_date', p_transaction_date
  );
END;
$$;


--
-- Name: rpc_record_debt_payment(uuid, bigint, bigint, uuid, numeric, text, numeric, numeric, text, date, text, text, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_record_debt_payment(p_business_id uuid, p_user_id bigint, p_debt_id bigint, p_wallet_id uuid, p_amount numeric, p_currency text, p_amount_idr numeric, p_booked_rate numeric, p_rate_source text, p_payment_date date, p_idempotency_key text, p_request_hash text, p_account_name text DEFAULT NULL::text, p_created_at timestamp with time zone DEFAULT now()) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_existing RECORD;
  v_debt RECORD;
  v_wallet RECORD;
  v_remaining numeric;
  v_new_paid numeric;
  v_effective_total numeric;
  v_is_fully_paid boolean;
  v_new_status text;
  v_tx_id bigint;
  v_tx_type text;
  v_result jsonb;
BEGIN
  -- 1. Check idempotency record first
  IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
    SELECT * INTO v_existing
    FROM public.debt_payment_idempotency
    WHERE business_id = p_business_id AND key = trim(p_idempotency_key);

    IF FOUND THEN
      IF v_existing.request_hash = p_request_hash THEN
        -- Exact replay with identical parameters: return cached response
        RETURN jsonb_build_object(
          'ok', true,
          'is_replay', true,
          'status', v_existing.response_status,
          'data', v_existing.response_body
        );
      ELSE
        -- Same key used with different payload: reject
        RAISE EXCEPTION 'idempotency_key_mismatch: Key already used with different payment parameters';
      END IF;
    END IF;
  END IF;

  -- 2. Lock debt row FOR UPDATE and verify ownership and currency
  SELECT * INTO v_debt
  FROM public.debts
  WHERE id = p_debt_id AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'debt_not_found: Debt does not exist or does not belong to active business';
  END IF;

  IF v_debt.currency IS NULL OR upper(trim(v_debt.currency)) <> upper(trim(p_currency)) THEN
    RAISE EXCEPTION 'debt_currency_mismatch: Debt currency does not match payment currency';
  END IF;

  -- 3. Lock wallet row FOR UPDATE and verify ownership and currency
  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE id = p_wallet_id AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'wallet_not_found: Wallet does not exist or does not belong to active business';
  END IF;

  IF v_wallet.currency IS NULL OR upper(trim(v_wallet.currency)) <> upper(trim(p_currency)) THEN
    RAISE EXCEPTION 'wallet_currency_mismatch: Wallet currency does not match payment currency';
  END IF;

  -- 3b. Re-check idempotency record after acquiring locks to prevent concurrent race
  IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
    SELECT * INTO v_existing
    FROM public.debt_payment_idempotency
    WHERE business_id = p_business_id AND key = trim(p_idempotency_key);

    IF FOUND THEN
      IF v_existing.request_hash = p_request_hash THEN
        RETURN jsonb_build_object(
          'ok', true,
          'is_replay', true,
          'status', v_existing.response_status,
          'data', v_existing.response_body
        );
      ELSE
        RAISE EXCEPTION 'idempotency_key_mismatch: Key already used with different payment parameters';
      END IF;
    END IF;
  END IF;

  -- 4. Calculate remaining balance with exact precision
  v_effective_total := COALESCE(v_debt.original_amount, v_debt.amount, 0);
  v_remaining := GREATEST(0, v_effective_total - COALESCE(v_debt.paid_amount, 0));

  IF p_amount > v_remaining + 0.01 THEN
    RAISE EXCEPTION 'payment_exceeds_remaining: Payment amount % exceeds remaining debt balance %', p_amount, v_remaining;
  END IF;

  -- 5. Determine new payment states
  v_new_paid := COALESCE(v_debt.paid_amount, 0) + p_amount;
  v_is_fully_paid := v_new_paid >= (v_effective_total - 0.01);
  v_new_status := CASE WHEN v_is_fully_paid THEN 'paid' ELSE 'partial' END;
  v_tx_type := CASE WHEN v_debt.type = 'payable' THEN 'expense' ELSE 'income' END;

  -- 6. Insert ledger transaction
  INSERT INTO public.transactions (
    business_id,
    created_by_user_id,
    type,
    amount_original,
    currency_original,
    amount_idr,
    booked_rate,
    rate_source,
    description,
    source,
    wallet_id,
    scope,
    transaction_date,
    created_at
  ) VALUES (
    p_business_id,
    p_user_id,
    v_tx_type,
    p_amount,
    upper(trim(p_currency)),
    p_amount_idr,
    p_booked_rate,
    p_rate_source,
    'Payment: ' || COALESCE(v_debt.counterparty, 'Debt #' || v_debt.id),
    COALESCE(p_account_name, v_wallet.name),
    v_wallet.id,
    COALESCE(v_debt.scope, v_wallet.scope, 'business'),
    p_payment_date,
    COALESCE(p_created_at, now())
  ) RETURNING id INTO v_tx_id;

  -- 7. Update debt
  UPDATE public.debts SET
    paid_amount = v_new_paid,
    status = v_new_status,
    is_settled = v_is_fully_paid,
    settled_at = CASE WHEN v_is_fully_paid THEN COALESCE(settled_at, now()) ELSE NULL END,
    last_payment_at = now(),
    linked_transaction_id = v_tx_id
  WHERE id = v_debt.id;

  -- 8. Build success response body
  v_result := jsonb_build_object(
    'ok', true,
    'isFullyPaid', v_is_fully_paid,
    'remaining', GREATEST(0, v_effective_total - v_new_paid),
    'paid_amount', v_new_paid,
    'status', v_new_status,
    'transaction_id', v_tx_id,
    'debt_id', v_debt.id,
    'debt', (SELECT to_jsonb(d) FROM public.debts d WHERE d.id = v_debt.id)
  );

  -- 9. Store in idempotency table if key provided
  IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
    INSERT INTO public.debt_payment_idempotency (
      business_id,
      debt_id,
      user_id,
      key,
      request_hash,
      transaction_id,
      response_status,
      response_body
    ) VALUES (
      p_business_id,
      v_debt.id,
      p_user_id,
      trim(p_idempotency_key),
      p_request_hash,
      v_tx_id,
      200,
      v_result
    )
    ON CONFLICT (business_id, key) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'is_replay', false,
    'status', 200,
    'data', v_result
  );
END;
$$;


--
-- Name: rpc_reset_business_financial(uuid, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_reset_business_financial(p_business uuid, p_actor_user_id bigint) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  r       jsonb := '{}'::jsonb;   -- per-table delete counts
  n       bigint;
  v_type  text;
  v_role  text;
BEGIN
  -- ── Authorization (runs BEFORE any delete; a reject touches no data) ─────────
  SELECT b.type INTO v_type FROM public.businesses b WHERE b.id = p_business;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'deleted', '{}'::jsonb, 'error', 'business_not_found');
  END IF;
  IF v_type = 'personal' THEN
    RETURN jsonb_build_object('ok', false, 'deleted', '{}'::jsonb, 'error', 'personal_workspace_not_allowed');
  END IF;

  -- Active membership with an approver role is REQUIRED — even for the owner.
  SELECT m.role INTO v_role
    FROM public.business_members m
   WHERE m.business_id = p_business
     AND m.user_id     = p_actor_user_id
     AND m.status      = 'active';
  IF NOT FOUND OR v_role NOT IN ('owner', 'admin', 'ceo', 'cfo') THEN
    RETURN jsonb_build_object('ok', false, 'deleted', '{}'::jsonb, 'error', 'forbidden');
  END IF;

  -- ── Atomic delete set (subtransaction: any error rolls the whole thing back) ─
  BEGIN
    -- 1) Allocation / link rows first. These RESTRICT-reference transactions, debts,
    --    withholding_records and tax_treatments, so every allocation must go before the
    --    records and the core rows it points at. Order within this block matters:
    --    tax_deposit_allocations references withholding_records + tax_treatments, so it
    --    must precede them (and precede tax_deposit_entries / accounts).
    IF to_regclass('public.withholding_payment_allocations') IS NOT NULL THEN
      DELETE FROM public.withholding_payment_allocations WHERE business_id = p_business;
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('withholding_payment_allocations', n);
    END IF;
    IF to_regclass('public.debt_settlement_allocations') IS NOT NULL THEN
      DELETE FROM public.debt_settlement_allocations WHERE business_id = p_business;
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('debt_payments', n);
    END IF;
    IF to_regclass('public.tax_deposit_allocations') IS NOT NULL THEN
      DELETE FROM public.tax_deposit_allocations WHERE business_id = p_business;
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('tax_deposit_allocations', n);
    END IF;
    -- Intercompany settlement allocations have no business_id column — scope through the
    -- funding record (either side of the transfer touching this business).
    IF to_regclass('public.intercompany_settlement_allocations') IS NOT NULL
       AND to_regclass('public.intercompany_funding_records') IS NOT NULL THEN
      DELETE FROM public.intercompany_settlement_allocations a
        USING public.intercompany_funding_records f
       WHERE a.funding_record_id = f.id
         AND (f.cash_payer_business_id = p_business OR f.economic_owner_business_id = p_business);
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('intercompany_settlement_allocations', n);
    END IF;
    IF to_regclass('public.document_transaction_links') IS NOT NULL THEN
      DELETE FROM public.document_transaction_links WHERE business_id = p_business;
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('document_transaction_links', n);
    END IF;
    IF to_regclass('public.document_debt_links') IS NOT NULL THEN
      DELETE FROM public.document_debt_links WHERE business_id = p_business;
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('document_debt_links', n);
    END IF;

    -- 1b) Tax-deposit (034) + intercompany funding (033) parent rows. RESTRICT-reference
    --     transactions / debts, so delete after their allocations and before the core rows.
    IF to_regclass('public.tax_deposit_entries') IS NOT NULL THEN
      DELETE FROM public.tax_deposit_entries WHERE business_id = p_business;
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('tax_deposit_entries', n);
    END IF;
    IF to_regclass('public.tax_deposit_accounts') IS NOT NULL THEN
      DELETE FROM public.tax_deposit_accounts WHERE business_id = p_business;
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('tax_deposit_accounts', n);
    END IF;
    IF to_regclass('public.intercompany_funding_records') IS NOT NULL THEN
      DELETE FROM public.intercompany_funding_records
       WHERE cash_payer_business_id = p_business OR economic_owner_business_id = p_business;
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('intercompany_funding_records', n);
    END IF;

    -- 1c) Tax records (now unreferenced by the allocations above; still before debts).
    IF to_regclass('public.withholding_records') IS NOT NULL THEN
      DELETE FROM public.withholding_records WHERE business_id = p_business;
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('withholding_records', n);
    END IF;
    IF to_regclass('public.tax_treatments') IS NOT NULL THEN
      DELETE FROM public.tax_treatments WHERE business_id = p_business;
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('tax_treatments', n);
    END IF;

    -- 2) Bank import staging / history (children before batches)
    IF to_regclass('public.bank_import_matches') IS NOT NULL THEN
      DELETE FROM public.bank_import_matches WHERE business_id = p_business;
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('bank_import_matches', n);
    END IF;
    IF to_regclass('public.bank_reconciliations') IS NOT NULL THEN
      DELETE FROM public.bank_reconciliations WHERE business_id = p_business;
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('bank_reconciliations', n);
    END IF;
    IF to_regclass('public.bank_import_rows') IS NOT NULL THEN
      DELETE FROM public.bank_import_rows WHERE business_id = p_business;
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('bank_import_rows', n);
    END IF;
    IF to_regclass('public.bank_import_batches') IS NOT NULL THEN
      DELETE FROM public.bank_import_batches WHERE business_id = p_business;
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('bank_import_batches', n);
    END IF;

    -- 3) Payroll financial child rows — COLUMN-SAFE. The static DELETE inside each
    --    branch is only PLANNED when its guard is true (plpgsql plans lazily), so a
    --    missing business_id column never raises. Falls back to the FK link, then
    --    skips cleanly if neither path exists (the row is CASCADE-cleared with the
    --    parent payroll_payments below in that case).
    IF to_regclass('public.payroll_payment_items') IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'payroll_payment_items'
                    AND column_name = 'business_id') THEN
        DELETE FROM public.payroll_payment_items WHERE business_id = p_business;
        GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('payroll_payment_items', n);
      ELSIF to_regclass('public.payroll_payments') IS NOT NULL
            AND EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'payroll_payment_items'
                           AND column_name = 'payroll_payment_id') THEN
        DELETE FROM public.payroll_payment_items i
          USING public.payroll_payments pp
         WHERE i.payroll_payment_id = pp.id AND pp.business_id = p_business;
        GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('payroll_payment_items', n);
      ELSE
        -- No scoping column available — leave to ON DELETE CASCADE from payroll_payments.
        r := r || jsonb_build_object('payroll_payment_items', 'skipped_no_scope_column');
      END IF;
    END IF;
    IF to_regclass('public.payroll_payments') IS NOT NULL THEN
      DELETE FROM public.payroll_payments WHERE business_id = p_business;
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('payroll_payments', n);
    END IF;

    -- 4) Core financial rows
    DELETE FROM public.transactions WHERE business_id = p_business;
    GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('transactions', n);
    DELETE FROM public.debts WHERE business_id = p_business;
    GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('debts', n);
    IF to_regclass('public.reminders') IS NOT NULL THEN
      DELETE FROM public.reminders WHERE business_id = p_business;
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('reminders', n);
    END IF;
    -- payroll_employees is PRESERVED (employee master, like team), but its
    -- default_wallet_id RESTRICT-references wallets — null it for this business's
    -- wallets first so wallet deletion can't fail. Scoped via wallet membership
    -- (no dependency on payroll_employees.business_id), guarded for column presence.
    IF to_regclass('public.payroll_employees') IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'payroll_employees'
                      AND column_name = 'default_wallet_id') THEN
      UPDATE public.payroll_employees
         SET default_wallet_id = NULL
       WHERE default_wallet_id IN (SELECT id FROM public.wallets WHERE business_id = p_business);
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('payroll_employee_wallet_refs_cleared', n);
    END IF;
    DELETE FROM public.wallets WHERE business_id = p_business;
    GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('wallets', n);

  EXCEPTION WHEN OTHERS THEN
    -- Any failure → whole subtransaction rolls back. Nothing was deleted.
    RETURN jsonb_build_object('ok', false, 'deleted', '{}'::jsonb, 'error', 'reset_failed');
  END;

  RETURN jsonb_build_object('ok', true, 'deleted', r, 'error', null);
END
$$;


--
-- Name: access_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.access_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    business_code text,
    action text NOT NULL,
    previous_plan text,
    previous_effective_plan text,
    new_plan text,
    new_effective_plan text,
    access_source text,
    reason text,
    changed_by_user_id bigint,
    changed_at timestamp with time zone DEFAULT now(),
    override_ends_at timestamp with time zone,
    metadata jsonb
);


--
-- Name: accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts (
    id integer NOT NULL,
    user_id bigint,
    name text NOT NULL,
    currency text DEFAULT 'IDR'::text NOT NULL,
    balance numeric(18,2) DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    type text DEFAULT 'personal'::text
);


--
-- Name: accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.accounts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: accounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.accounts_id_seq OWNED BY public.accounts.id;


--
-- Name: activity_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id bigint,
    name text NOT NULL,
    code text,
    is_system boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    language text DEFAULT 'en'::text,
    is_template boolean DEFAULT false NOT NULL,
    source text DEFAULT 'user'::text,
    business_id uuid
);


--
-- Name: ai_usage_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_usage_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid,
    feature text NOT NULL,
    batch_id uuid,
    rows_processed integer,
    model text,
    input_tokens integer,
    output_tokens integer,
    cost_estimate numeric,
    created_by_user_id bigint,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: app_user_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.app_user_id_seq
    START WITH -1
    INCREMENT BY -1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    name text NOT NULL,
    asset_type text NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    cost numeric(20,2) NOT NULL,
    currency text DEFAULT 'IDR'::text NOT NULL,
    acquired_on date NOT NULL,
    supplier_counterparty_id uuid,
    purchase_debt_id bigint,
    purchase_transaction_id bigint,
    purchase_document_id uuid,
    asset_group text,
    useful_life_months integer,
    depreciation_method text DEFAULT 'straight_line'::text NOT NULL,
    depreciation_rule_id uuid,
    location text,
    custodian text,
    notes text,
    disposed_on date,
    created_by_user_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT assets_asset_type_check CHECK ((asset_type = ANY (ARRAY['machines'::text, 'vehicles'::text, 'computers'::text, 'furniture'::text, 'buildings'::text, 'other'::text]))),
    CONSTRAINT assets_check CHECK (((disposed_on IS NULL) OR (disposed_on >= acquired_on))),
    CONSTRAINT assets_check1 CHECK (((useful_life_months IS NULL) = (depreciation_rule_id IS NULL))),
    CONSTRAINT assets_cost_check CHECK ((cost > (0)::numeric)),
    CONSTRAINT assets_depreciation_method_check CHECK ((depreciation_method = 'straight_line'::text)),
    CONSTRAINT assets_name_check CHECK ((length(btrim(name)) > 0)),
    CONSTRAINT assets_quantity_check CHECK ((quantity >= 1)),
    CONSTRAINT assets_useful_life_months_check CHECK (((useful_life_months IS NULL) OR ((useful_life_months >= 1) AND (useful_life_months <= 600))))
);


--
-- Name: TABLE assets; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.assets IS 'Design v2 P-11: asset register. Depreciation is computed (straight line) from a verified depreciation tax rule; never stored, never guessed.';


--
-- Name: audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid,
    actor_user_id bigint,
    actor_role text,
    channel text,
    entity_type text NOT NULL,
    entity_id text,
    action text NOT NULL,
    before_json jsonb,
    after_json jsonb,
    request_id text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: bank_import_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank_import_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    wallet_id uuid,
    uploaded_by_user_id bigint,
    source_channel text DEFAULT 'web'::text NOT NULL,
    file_name text,
    file_type text,
    bank_format text,
    currency text DEFAULT 'IDR'::text,
    statement_start date,
    statement_end date,
    opening_balance numeric,
    closing_balance numeric,
    row_count integer DEFAULT 0 NOT NULL,
    matched_count integer DEFAULT 0 NOT NULL,
    duplicate_count integer DEFAULT 0 NOT NULL,
    imported_count integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'uploaded'::text NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    document_id uuid
);


--
-- Name: bank_import_matches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank_import_matches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    batch_id uuid NOT NULL,
    row_id uuid NOT NULL,
    business_id uuid NOT NULL,
    matched_transaction_id bigint,
    match_type text,
    confidence numeric,
    status text DEFAULT 'suggested'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: bank_import_rows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank_import_rows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    batch_id uuid NOT NULL,
    business_id uuid NOT NULL,
    row_index integer NOT NULL,
    raw jsonb DEFAULT '{}'::jsonb,
    tx_date date,
    description text,
    amount numeric,
    direction text,
    bank_reference text,
    balance_after numeric,
    dedup_hash text,
    suggested_type text,
    suggested_category text,
    suggested_counterparty text,
    confidence numeric,
    match_status text DEFAULT 'review_required'::text NOT NULL,
    matched_transaction_id bigint,
    linked_transaction_id bigint,
    created_at timestamp with time zone DEFAULT now(),
    suggested_transaction_type text,
    suggested_category_id uuid,
    suggested_counterparty_id uuid,
    suggested_scope text,
    suggested_match_type text,
    suggested_match_id text,
    suggestion_source text,
    suggestion_confidence numeric,
    suggestion_reason text,
    review_status text DEFAULT 'unprocessed'::text,
    reviewed_by_user_id bigint,
    reviewed_at timestamp with time zone,
    final_transaction_type text,
    final_category_id uuid,
    final_counterparty_id uuid,
    final_scope text
);


--
-- Name: bank_reconciliations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank_reconciliations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    batch_id uuid NOT NULL,
    business_id uuid NOT NULL,
    wallet_id uuid,
    opening_balance numeric,
    closing_balance numeric,
    computed_closing numeric,
    difference numeric,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: business_addons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_addons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    addon text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    granted_by bigint,
    granted_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: business_code_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.business_code_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: business_directions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_directions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id bigint,
    name text NOT NULL,
    slug text,
    is_system boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    language text DEFAULT 'en'::text,
    is_template boolean DEFAULT false NOT NULL,
    source text DEFAULT 'user'::text,
    business_id uuid
);


--
-- Name: business_funding_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_funding_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    source_kind text NOT NULL,
    instrument text NOT NULL,
    counterparty_id uuid,
    lender_name text,
    amount numeric(20,2) NOT NULL,
    currency text DEFAULT 'IDR'::text NOT NULL,
    received_on date NOT NULL,
    received_transaction_id bigint,
    interest_rate_annual numeric(7,4),
    terms_text text,
    due_on date,
    status text DEFAULT 'active'::text NOT NULL,
    created_by_user_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT business_funding_records_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT business_funding_records_check CHECK (((counterparty_id IS NOT NULL) OR (length(btrim(COALESCE(lender_name, ''::text))) > 0))),
    CONSTRAINT business_funding_records_check1 CHECK (((instrument = 'loan'::text) OR ((interest_rate_annual IS NULL) AND (due_on IS NULL)))),
    CONSTRAINT business_funding_records_check2 CHECK (((due_on IS NULL) OR (due_on >= received_on))),
    CONSTRAINT business_funding_records_instrument_check CHECK ((instrument = ANY (ARRAY['equity'::text, 'loan'::text]))),
    CONSTRAINT business_funding_records_interest_rate_annual_check CHECK (((interest_rate_annual IS NULL) OR ((interest_rate_annual >= (0)::numeric) AND (interest_rate_annual <= (100)::numeric)))),
    CONSTRAINT business_funding_records_source_kind_check CHECK ((source_kind = ANY (ARRAY['founder'::text, 'investor'::text, 'bank'::text, 'other_lender'::text]))),
    CONSTRAINT business_funding_records_status_check CHECK ((status = ANY (ARRAY['active'::text, 'repaid'::text, 'converted'::text, 'written_off'::text])))
);


--
-- Name: TABLE business_funding_records; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.business_funding_records IS 'Design v2 P-03: equity and loans a business raised. Never revenue; no link to Personal.';


--
-- Name: business_funding_repayments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_funding_repayments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    funding_record_id uuid NOT NULL,
    due_on date NOT NULL,
    principal numeric(20,2) DEFAULT 0 NOT NULL,
    interest numeric(20,2) DEFAULT 0 NOT NULL,
    paid_on date,
    paid_transaction_id bigint,
    created_by_user_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT business_funding_repayments_check CHECK (((principal + interest) > (0)::numeric)),
    CONSTRAINT business_funding_repayments_check1 CHECK (((paid_transaction_id IS NULL) OR (paid_on IS NOT NULL))),
    CONSTRAINT business_funding_repayments_interest_check CHECK ((interest >= (0)::numeric)),
    CONSTRAINT business_funding_repayments_principal_check CHECK ((principal >= (0)::numeric))
);


--
-- Name: business_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    invited_by bigint NOT NULL,
    code text NOT NULL,
    role text DEFAULT 'employee'::text NOT NULL,
    label text,
    max_uses integer DEFAULT 1,
    uses_count integer DEFAULT 0,
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval),
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: business_member_notification_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_member_notification_grants (
    id bigint NOT NULL,
    business_id uuid NOT NULL,
    user_id bigint NOT NULL,
    category text NOT NULL,
    enabled boolean NOT NULL,
    granted_by_user_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: business_member_notification_grants_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.business_member_notification_grants_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: business_member_notification_grants_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.business_member_notification_grants_id_seq OWNED BY public.business_member_notification_grants.id;


--
-- Name: business_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    user_id bigint NOT NULL,
    role text DEFAULT 'owner'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    invited_by_user_id bigint,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    display_name text,
    joined_at timestamp with time zone DEFAULT now(),
    invited_by bigint,
    invite_code text,
    onboarding_status text DEFAULT 'not_started'::text,
    onboarding_step text,
    telegram_connected_at timestamp with time zone,
    telegram_test_completed_at timestamp with time zone,
    last_onboarding_event_at timestamp with time zone
);


--
-- Name: business_relationships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_relationships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    from_business_id uuid NOT NULL,
    to_business_id uuid NOT NULL,
    relationship_type text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    effective_from date,
    effective_to date,
    created_by_user_id bigint,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT business_relationships_check CHECK ((from_business_id <> to_business_id)),
    CONSTRAINT business_relationships_check1 CHECK (((effective_to IS NULL) OR (effective_from IS NULL) OR (effective_to >= effective_from))),
    CONSTRAINT business_relationships_relationship_type_check CHECK ((relationship_type = ANY (ARRAY['parent'::text, 'subsidiary'::text, 'sister_company'::text, 'related_party'::text, 'funding_company'::text, 'operating_company'::text, 'management_company'::text])))
);


--
-- Name: businesses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.businesses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_user_id bigint NOT NULL,
    name text NOT NULL,
    base_currency text DEFAULT 'IDR'::text NOT NULL,
    timezone text,
    country text,
    status text DEFAULT 'active'::text NOT NULL,
    plan text DEFAULT 'free'::text NOT NULL,
    trial_status text DEFAULT 'active'::text NOT NULL,
    trial_started_at timestamp with time zone DEFAULT now(),
    trial_ends_at timestamp with time zone DEFAULT (now() + '7 days'::interval),
    subscription_status text DEFAULT 'trialing'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    business_code text,
    type text DEFAULT 'business'::text NOT NULL,
    admin_override_plan text,
    override_started_at timestamp with time zone,
    override_ends_at timestamp with time zone,
    override_reason text,
    override_created_by_user_id bigint,
    override_created_at timestamp with time zone,
    runway_target_days integer,
    min_cash_idr numeric(20,2),
    weekly_brief_cron text,
    CONSTRAINT businesses_min_cash_idr_chk CHECK (((min_cash_idr IS NULL) OR (min_cash_idr >= (0)::numeric))),
    CONSTRAINT businesses_runway_target_days_chk CHECK (((runway_target_days IS NULL) OR ((runway_target_days >= 1) AND (runway_target_days <= 730)))),
    CONSTRAINT businesses_type_chk CHECK ((type = ANY (ARRAY['business'::text, 'personal'::text]))),
    CONSTRAINT businesses_weekly_brief_cron_chk CHECK (((weekly_brief_cron IS NULL) OR (weekly_brief_cron ~ '^([0-5]?[0-9]) ([01]?[0-9]|2[0-3]) \* \* [0-6]$'::text)))
);


--
-- Name: COLUMN businesses.runway_target_days; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.businesses.runway_target_days IS 'Design v2 P-01: runway target in days. NULL = product default (60).';


--
-- Name: COLUMN businesses.min_cash_idr; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.businesses.min_cash_idr IS 'Design v2 P-08: minimum cash to keep, IDR. NULL = not set.';


--
-- Name: COLUMN businesses.weekly_brief_cron; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.businesses.weekly_brief_cron IS 'Design v2 P-08: weekly brief time, "m h * * dow" in the business timezone. NULL = off. Recipients come from notificationPolicy, never from here.';


--
-- Name: cashflow_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cashflow_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id bigint,
    name text NOT NULL,
    group_type text NOT NULL,
    activity_type text,
    sub_category text,
    description text,
    is_system boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    language text DEFAULT 'en'::text,
    is_template boolean DEFAULT false NOT NULL,
    source text DEFAULT 'user'::text,
    business_id uuid,
    pnl_group text,
    CONSTRAINT cashflow_categories_pnl_group_business_chk CHECK (((pnl_group IS NULL) OR (business_id IS NOT NULL))),
    CONSTRAINT cashflow_categories_pnl_group_chk CHECK (((pnl_group IS NULL) OR (pnl_group = ANY (ARRAY['revenue'::text, 'direct_cost'::text, 'operating_cost'::text, 'interest'::text, 'other_income'::text, 'tax'::text, 'asset_purchase'::text, 'funding'::text, 'transfer'::text]))))
);


--
-- Name: COLUMN cashflow_categories.pnl_group; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.cashflow_categories.pnl_group IS 'Design v2 P-10: profit group confirmed by a person for this business. NULL = not confirmed.';


--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    id integer NOT NULL,
    user_id bigint,
    name text NOT NULL,
    type text NOT NULL,
    emoji text DEFAULT '💰'::text,
    is_default boolean DEFAULT false
);


--
-- Name: categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.categories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.categories_id_seq OWNED BY public.categories.id;


--
-- Name: channel_link_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.channel_link_tokens (
    token_hash text NOT NULL,
    user_id bigint NOT NULL,
    intended_channel text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    used_by_channel text,
    used_by_external_id text,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT channel_link_tokens_intended_channel_check CHECK ((intended_channel = 'telegram'::text))
);


--
-- Name: classification_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.classification_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    bank_import_row_id uuid,
    normalized_desc text,
    suggested_category_id uuid,
    final_category_id uuid,
    suggested_transaction_type text,
    final_transaction_type text,
    confidence numeric,
    accepted boolean,
    source text,
    reviewed_by_user_id bigint,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: classification_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.classification_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    rule_name text,
    match_type text DEFAULT 'contains'::text NOT NULL,
    match_value text NOT NULL,
    normalized_value text NOT NULL,
    transaction_type text,
    category_id uuid,
    counterparty_id uuid,
    scope text,
    priority integer DEFAULT 100 NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    created_by_user_id bigint,
    created_from text,
    confirmed_examples_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: compliance_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compliance_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    rule_id uuid,
    rule_code text,
    obligation_type text,
    title text,
    period text,
    due_date date,
    estimated_amount numeric,
    currency text DEFAULT 'IDR'::text,
    status text DEFAULT 'upcoming'::text NOT NULL,
    professional_review_status text DEFAULT 'not_started'::text,
    owner_approval_status text DEFAULT 'not_required'::text,
    payment_status text DEFAULT 'unpaid'::text,
    filing_status text DEFAULT 'not_filed'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    rule_version integer,
    period_start date,
    period_end date,
    amount_status text DEFAULT 'unknown'::text NOT NULL,
    confirmed_amount numeric,
    calculation_status text,
    source_snapshot_json jsonb,
    generated_at timestamp with time zone,
    generated_by bigint,
    source_verification_required boolean DEFAULT false NOT NULL
);


--
-- Name: counterparties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.counterparties (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id bigint NOT NULL,
    name text NOT NULL,
    group_name text,
    type text,
    email text,
    phone text,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    business_id uuid,
    legal_name text,
    display_name text,
    npwp text,
    pkp_status text,
    address text,
    aliases text[],
    default_category text,
    default_tax_treatment text,
    status text DEFAULT 'active'::text NOT NULL,
    source_system text,
    external_id text,
    external_url text,
    last_synced_at timestamp with time zone,
    entity_form text,
    payment_terms_days integer,
    CONSTRAINT counterparties_entity_form_chk CHECK (((entity_form IS NULL) OR (entity_form = ANY (ARRAY['pt'::text, 'cv'::text, 'person'::text, 'foreign'::text, 'other'::text])))),
    CONSTRAINT counterparties_payment_terms_days_chk CHECK (((payment_terms_days IS NULL) OR ((payment_terms_days >= 0) AND (payment_terms_days <= 365)))),
    CONSTRAINT counterparties_pkp_chk CHECK (((pkp_status IS NULL) OR (pkp_status = ANY (ARRAY['unknown'::text, 'pkp'::text, 'non_pkp'::text])))),
    CONSTRAINT counterparties_status_chk CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))
);


--
-- Name: COLUMN counterparties.entity_form; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.counterparties.entity_form IS 'Design v2 P-04: pt | cv | person | foreign | other. Owner-stated; the rule engine decides any tax treatment.';


--
-- Name: COLUMN counterparties.payment_terms_days; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.counterparties.payment_terms_days IS 'Design v2 P-04: usual payment terms in days (0..365). NULL = not set.';


--
-- Name: counterparty_bank_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.counterparty_bank_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    counterparty_id uuid NOT NULL,
    bank_name text,
    account_number text NOT NULL,
    account_number_normalized text GENERATED ALWAYS AS (regexp_replace(account_number, '\D'::text, ''::text, 'g'::text)) STORED,
    account_name text,
    currency text DEFAULT 'IDR'::text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    created_by_user_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: debt_payment_idempotency; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.debt_payment_idempotency (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    debt_id bigint NOT NULL,
    user_id bigint NOT NULL,
    key text NOT NULL,
    request_hash text NOT NULL,
    transaction_id bigint,
    response_status integer DEFAULT 200 NOT NULL,
    response_body jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: debt_settlement_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.debt_settlement_allocations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    debt_id bigint NOT NULL,
    settlement_source_type text NOT NULL,
    transaction_id bigint,
    withholding_record_id uuid,
    credit_note_document_id uuid,
    allocated_amount numeric(20,2) NOT NULL,
    created_by_user_id bigint,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT debt_settlement_allocations_allocated_amount_check CHECK ((allocated_amount > (0)::numeric)),
    CONSTRAINT debt_settlement_allocations_check CHECK ((((settlement_source_type = 'transaction'::text) AND (transaction_id IS NOT NULL) AND (withholding_record_id IS NULL) AND (credit_note_document_id IS NULL)) OR ((settlement_source_type = 'withholding_record'::text) AND (withholding_record_id IS NOT NULL) AND (transaction_id IS NULL) AND (credit_note_document_id IS NULL)) OR ((settlement_source_type = 'credit_note'::text) AND (credit_note_document_id IS NOT NULL) AND (transaction_id IS NULL) AND (withholding_record_id IS NULL)) OR ((settlement_source_type = 'adjustment'::text) AND (transaction_id IS NULL) AND (withholding_record_id IS NULL) AND (credit_note_document_id IS NULL)))),
    CONSTRAINT debt_settlement_allocations_settlement_source_type_check CHECK ((settlement_source_type = ANY (ARRAY['transaction'::text, 'withholding_record'::text, 'credit_note'::text, 'adjustment'::text])))
);


--
-- Name: debts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.debts (
    id integer NOT NULL,
    user_id bigint,
    type text NOT NULL,
    counterparty text NOT NULL,
    description text,
    amount numeric(18,2) NOT NULL,
    currency text DEFAULT 'IDR'::text NOT NULL,
    due_date timestamp with time zone,
    scope text DEFAULT 'personal'::text,
    is_settled boolean DEFAULT false,
    settled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    status text DEFAULT 'open'::text,
    paid_amount numeric DEFAULT 0,
    original_amount numeric,
    last_payment_at timestamp with time zone,
    priority text,
    notes text,
    source_channel text DEFAULT 'web'::text,
    raw_input_text text,
    raw_input_language text,
    confidence_score numeric,
    attachment_url text,
    created_by_user_id bigint,
    created_by_telegram_id bigint,
    created_by_name text,
    created_by_role text,
    approval_status text DEFAULT 'approved'::text,
    approved_by_user_id bigint,
    approved_at timestamp with time zone,
    rejected_reason text,
    linked_transaction_id bigint,
    approved_via_channel text,
    last_action_channel text,
    info_request_note text,
    info_requested_at timestamp with time zone,
    info_requested_by bigint,
    business_id uuid,
    is_training boolean DEFAULT false,
    training_type text,
    attachments jsonb DEFAULT '[]'::jsonb,
    accountant_checked_at timestamp with time zone,
    accountant_checked_by bigint,
    CONSTRAINT debts_accountant_check_pair_chk CHECK (((accountant_checked_at IS NULL) = (accountant_checked_by IS NULL))),
    CONSTRAINT debts_type_check CHECK ((type = ANY (ARRAY['receivable'::text, 'payable'::text])))
);


--
-- Name: COLUMN debts.accountant_checked_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.debts.accountant_checked_at IS 'Design v2 P-05: when an accountant marked this bill checked. A status mark only.';


--
-- Name: debts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.debts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: debts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.debts_id_seq OWNED BY public.debts.id;


--
-- Name: document_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    document_id uuid,
    actor_user_id bigint,
    channel text,
    action text NOT NULL,
    target_type text,
    target_id text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: document_compliance_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_compliance_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    document_id uuid NOT NULL,
    compliance_event_id uuid NOT NULL,
    created_by_user_id bigint,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: document_debt_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_debt_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    document_id uuid NOT NULL,
    debt_id bigint NOT NULL,
    created_by_user_id bigint,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: document_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    storage_path text NOT NULL,
    file_name text,
    mime_type text,
    file_size bigint,
    sha256_hash text NOT NULL,
    upload_channel text,
    uploaded_by_user_id bigint,
    created_at timestamp with time zone DEFAULT now(),
    archived_at timestamp with time zone,
    CONSTRAINT document_files_file_size_check CHECK (((file_size IS NULL) OR (file_size >= 0)))
);


--
-- Name: document_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    source_document_id uuid NOT NULL,
    target_document_id uuid NOT NULL,
    link_type text NOT NULL,
    match_confidence numeric,
    match_reason text,
    match_status text DEFAULT 'suggested'::text NOT NULL,
    confirmed_by_user_id bigint,
    confirmed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT document_links_check CHECK ((source_document_id <> target_document_id)),
    CONSTRAINT document_links_link_type_check CHECK ((link_type = ANY (ARRAY['supports'::text, 'tax_invoice_for'::text, 'withholding_for'::text, 'payment_proof_for'::text, 'tax_billing_for'::text, 'filing_for'::text, 'supersedes'::text, 'related'::text]))),
    CONSTRAINT document_links_match_confidence_check CHECK (((match_confidence IS NULL) OR ((match_confidence >= (0)::numeric) AND (match_confidence <= (1)::numeric))))
);


--
-- Name: document_transaction_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_transaction_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    document_id uuid NOT NULL,
    transaction_id bigint NOT NULL,
    created_by_user_id bigint,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: email_login_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_login_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    code_hash text NOT NULL,
    purpose text DEFAULT 'login'::text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    consumed_by_user_id bigint,
    attempts integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_login_codes_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT email_login_codes_email_normalized CHECK ((email = lower(btrim(email)))),
    CONSTRAINT email_login_codes_purpose_check CHECK ((purpose = ANY (ARRAY['login'::text, 'invite_accept'::text])))
);


--
-- Name: incoming_payment_match_candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incoming_payment_match_candidates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    incoming_payment_id uuid NOT NULL,
    target_type text NOT NULL,
    target_debt_id bigint,
    target_transaction_id bigint,
    score numeric(5,4) DEFAULT 0 NOT NULL,
    match_reasons jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'suggested'::text NOT NULL,
    decided_by_user_id bigint,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT incoming_payment_candidates_decision_stamp CHECK ((((status = 'suggested'::text) AND (decided_by_user_id IS NULL) AND (decided_at IS NULL)) OR ((status <> 'suggested'::text) AND (decided_by_user_id IS NOT NULL) AND (decided_at IS NOT NULL)))),
    CONSTRAINT incoming_payment_candidates_one_target CHECK ((((target_type = 'debt'::text) AND (target_debt_id IS NOT NULL) AND (target_transaction_id IS NULL)) OR ((target_type = 'transaction'::text) AND (target_transaction_id IS NOT NULL) AND (target_debt_id IS NULL)))),
    CONSTRAINT incoming_payment_match_candidates_score_check CHECK (((score >= (0)::numeric) AND (score <= (1)::numeric))),
    CONSTRAINT incoming_payment_match_candidates_status_check CHECK ((status = ANY (ARRAY['suggested'::text, 'accepted'::text, 'rejected'::text]))),
    CONSTRAINT incoming_payment_match_candidates_target_type_check CHECK ((target_type = ANY (ARRAY['debt'::text, 'transaction'::text])))
);


--
-- Name: incoming_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incoming_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    wallet_id uuid,
    source_type text NOT NULL,
    provider text,
    provider_account_id text,
    provider_transaction_id text,
    provider_order_id text,
    provider_settlement_id text,
    settlement_batch_reference text,
    payment_method text,
    gross_amount numeric(20,2) NOT NULL,
    fee_amount numeric(20,2),
    tax_or_withholding_amount numeric(20,2),
    net_amount numeric(20,2) NOT NULL,
    currency text DEFAULT 'IDR'::text NOT NULL,
    transaction_at timestamp with time zone,
    settled_at timestamp with time zone,
    payer_name text,
    payer_reference text,
    description text,
    status text DEFAULT 'draft'::text NOT NULL,
    reconciliation_status text DEFAULT 'unmatched'::text NOT NULL,
    linked_transaction_id bigint,
    linked_debt_id bigint,
    raw_provider_payload jsonb,
    idempotency_key text NOT NULL,
    created_by_user_id bigint,
    reviewed_by_user_id bigint,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    bank_import_batch_id uuid,
    bank_import_row_id uuid,
    CONSTRAINT incoming_payments_fee_amount_check CHECK (((fee_amount IS NULL) OR (fee_amount >= (0)::numeric))),
    CONSTRAINT incoming_payments_gross_amount_check CHECK ((gross_amount >= (0)::numeric)),
    CONSTRAINT incoming_payments_idempotency_key_check CHECK ((length(TRIM(BOTH FROM idempotency_key)) > 0)),
    CONSTRAINT incoming_payments_net_amount_check CHECK ((net_amount >= (0)::numeric)),
    CONSTRAINT incoming_payments_net_consistent CHECK (((fee_amount IS NULL) OR (tax_or_withholding_amount IS NULL) OR (net_amount = ((gross_amount - fee_amount) - tax_or_withholding_amount)))),
    CONSTRAINT incoming_payments_reconciliation_status_check CHECK ((reconciliation_status = ANY (ARRAY['unmatched'::text, 'candidate'::text, 'matched'::text, 'ignored'::text]))),
    CONSTRAINT incoming_payments_review_stamp CHECK ((((reviewed_by_user_id IS NULL) AND (reviewed_at IS NULL)) OR ((reviewed_by_user_id IS NOT NULL) AND (reviewed_at IS NOT NULL)))),
    CONSTRAINT incoming_payments_source_type_check CHECK ((source_type = ANY (ARRAY['manual_bank_entry'::text, 'manual_gateway_import'::text, 'gateway_settlement'::text, 'bank_statement_import'::text, 'future_gateway_api'::text, 'future_bank_api'::text]))),
    CONSTRAINT incoming_payments_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'reviewed'::text, 'rejected'::text]))),
    CONSTRAINT incoming_payments_tax_or_withholding_amount_check CHECK (((tax_or_withholding_amount IS NULL) OR (tax_or_withholding_amount >= (0)::numeric)))
);


--
-- Name: industry_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.industry_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kbli_prefix text NOT NULL,
    category_name text NOT NULL,
    pnl_group text NOT NULL,
    note text,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT industry_templates_category_name_check CHECK ((length(btrim(category_name)) > 0)),
    CONSTRAINT industry_templates_kbli_prefix_check CHECK (((kbli_prefix = '*'::text) OR (kbli_prefix ~ '^[0-9]{2,5}$'::text))),
    CONSTRAINT industry_templates_pnl_group_check CHECK ((pnl_group = ANY (ARRAY['revenue'::text, 'direct_cost'::text, 'operating_cost'::text, 'interest'::text, 'other_income'::text, 'tax'::text, 'asset_purchase'::text, 'funding'::text, 'transfer'::text])))
);


--
-- Name: TABLE industry_templates; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.industry_templates IS 'Design v2 P-10: suggested category → profit group per KBLI prefix. Suggestions only; never read into profit.';


--
-- Name: intercompany_funding_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intercompany_funding_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    relationship_id uuid NOT NULL,
    economic_owner_business_id uuid NOT NULL,
    cash_payer_business_id uuid NOT NULL,
    currency text DEFAULT 'IDR'::text NOT NULL,
    funded_amount numeric(20,2) NOT NULL,
    funding_type text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    funded_debt_id bigint,
    funded_transaction_id bigint,
    funded_tax_treatment_id uuid,
    funded_compliance_event_id uuid,
    description text,
    funded_at timestamp with time zone,
    created_by_user_id bigint,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT intercompany_funding_records_check CHECK ((economic_owner_business_id <> cash_payer_business_id)),
    CONSTRAINT intercompany_funding_records_funded_amount_check CHECK ((funded_amount > (0)::numeric)),
    CONSTRAINT intercompany_funding_records_funding_type_check CHECK ((funding_type = ANY (ARRAY['vendor_payment'::text, 'tax_payment'::text, 'payroll'::text, 'expense_reimbursement'::text, 'working_capital'::text, 'loan'::text, 'advance'::text, 'other'::text])))
);


--
-- Name: intercompany_settlement_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intercompany_settlement_allocations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_relationship_id uuid NOT NULL,
    funding_record_id uuid NOT NULL,
    repayment_transaction_id bigint NOT NULL,
    allocated_amount numeric(20,2) NOT NULL,
    created_by_user_id bigint,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT intercompany_settlement_allocations_allocated_amount_check CHECK ((allocated_amount > (0)::numeric))
);


--
-- Name: intercompany_balances; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.intercompany_balances AS
 WITH repaid AS (
         SELECT intercompany_settlement_allocations.funding_record_id,
            sum(intercompany_settlement_allocations.allocated_amount) AS repaid
           FROM public.intercompany_settlement_allocations
          GROUP BY intercompany_settlement_allocations.funding_record_id
        )
 SELECT f.relationship_id,
    f.cash_payer_business_id AS creditor_business_id,
    f.economic_owner_business_id AS debtor_business_id,
    f.currency,
    sum(f.funded_amount) AS funded_total,
    COALESCE(sum(r.repaid), (0)::numeric) AS repaid_total,
    (sum(f.funded_amount) - COALESCE(sum(r.repaid), (0)::numeric)) AS outstanding,
    max(f.updated_at) AS last_activity_at
   FROM (public.intercompany_funding_records f
     LEFT JOIN repaid r ON ((r.funding_record_id = f.id)))
  WHERE (f.status = ANY (ARRAY['confirmed'::text, 'partially_repaid'::text, 'repaid'::text]))
  GROUP BY f.relationship_id, f.cash_payer_business_id, f.economic_owner_business_id, f.currency;


--
-- Name: mcp_oauth_clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mcp_oauth_clients (
    client_id text NOT NULL,
    client_name text,
    redirect_uris text[] NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mcp_oauth_clients_redirects_nonempty CHECK ((cardinality(redirect_uris) > 0))
);


--
-- Name: mcp_oauth_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mcp_oauth_codes (
    code_hash text NOT NULL,
    client_id text NOT NULL,
    user_id bigint NOT NULL,
    redirect_uri text NOT NULL,
    code_challenge text NOT NULL,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    resource text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone
);


--
-- Name: mcp_oauth_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mcp_oauth_requests (
    id text NOT NULL,
    client_id text NOT NULL,
    redirect_uri text NOT NULL,
    code_challenge text NOT NULL,
    state text,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    resource text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    decided_at timestamp with time zone,
    decision text,
    decided_by_user_id bigint,
    CONSTRAINT mcp_oauth_requests_decision_check CHECK ((decision = ANY (ARRAY['approved'::text, 'denied'::text])))
);


--
-- Name: mcp_oauth_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mcp_oauth_tokens (
    token_hash text NOT NULL,
    kind text NOT NULL,
    grant_id uuid NOT NULL,
    client_id text NOT NULL,
    user_id bigint NOT NULL,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    resource text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT mcp_oauth_tokens_kind_check CHECK ((kind = ANY (ARRAY['access'::text, 'refresh'::text])))
);


--
-- Name: official_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.official_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jurisdiction text NOT NULL,
    authority text NOT NULL,
    title text NOT NULL,
    url text NOT NULL,
    publication_date date,
    last_verified_at timestamp with time zone,
    verified_by_user_id bigint,
    created_at timestamp with time zone DEFAULT now(),
    source_type text,
    document_number text,
    effective_from date,
    effective_to date,
    language text,
    content_hash text,
    status text DEFAULT 'draft'::text NOT NULL,
    notes text,
    updated_at timestamp with time zone DEFAULT now(),
    relevant_sections text,
    quoted_section_reference text,
    interpretation_notes text,
    superseded_documents jsonb,
    known_amendments jsonb,
    accessed_at timestamp with time zone
);


--
-- Name: onboarding_context_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.onboarding_context_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id bigint NOT NULL,
    business_id uuid,
    snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: onboarding_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.onboarding_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id bigint,
    business_id uuid,
    flow_id uuid,
    step_id uuid,
    event_type text NOT NULL,
    event_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT onboarding_events_event_type_check CHECK ((length(TRIM(BOTH FROM event_type)) > 0))
);


--
-- Name: onboarding_flows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.onboarding_flows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    flow_key text NOT NULL,
    title text NOT NULL,
    description text,
    title_i18n jsonb DEFAULT '{}'::jsonb NOT NULL,
    description_i18n jsonb DEFAULT '{}'::jsonb NOT NULL,
    mode text NOT NULL,
    audience text DEFAULT 'business_owner'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT onboarding_flows_audience_check CHECK ((audience = ANY (ARRAY['business_owner'::text, 'accountant'::text, 'admin'::text, 'personal_user'::text, 'all'::text]))),
    CONSTRAINT onboarding_flows_mode_check CHECK ((mode = ANY (ARRAY['quick_setup'::text, 'full_tour'::text, 'feature_tour'::text])))
);


--
-- Name: onboarding_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.onboarding_progress (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id bigint NOT NULL,
    business_id uuid,
    flow_id uuid NOT NULL,
    status text DEFAULT 'not_started'::text NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    dismissed_at timestamp with time zone,
    current_step_id uuid,
    progress_percent numeric(5,2) DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT onboarding_progress_progress_percent_check CHECK (((progress_percent >= (0)::numeric) AND (progress_percent <= (100)::numeric))),
    CONSTRAINT onboarding_progress_status_check CHECK ((status = ANY (ARRAY['not_started'::text, 'in_progress'::text, 'completed'::text, 'skipped'::text, 'dismissed'::text])))
);


--
-- Name: onboarding_step_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.onboarding_step_progress (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    progress_id uuid NOT NULL,
    step_id uuid NOT NULL,
    status text DEFAULT 'not_started'::text NOT NULL,
    first_viewed_at timestamp with time zone,
    completed_at timestamp with time zone,
    skipped_at timestamp with time zone,
    completion_source text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT onboarding_step_progress_completion_source_check CHECK (((completion_source IS NULL) OR (completion_source = ANY (ARRAY['user'::text, 'system'::text, 'admin'::text, 'event'::text])))),
    CONSTRAINT onboarding_step_progress_status_check CHECK ((status = ANY (ARRAY['not_started'::text, 'viewed'::text, 'completed'::text, 'skipped'::text])))
);


--
-- Name: onboarding_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.onboarding_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    flow_id uuid NOT NULL,
    step_key text NOT NULL,
    title text NOT NULL,
    description text,
    title_i18n jsonb DEFAULT '{}'::jsonb NOT NULL,
    description_i18n jsonb DEFAULT '{}'::jsonb NOT NULL,
    instructions_i18n jsonb DEFAULT '{}'::jsonb NOT NULL,
    page_path text,
    target_selector text,
    action_type text DEFAULT 'read'::text NOT NULL,
    product_area text DEFAULT 'general'::text NOT NULL,
    required boolean DEFAULT false NOT NULL,
    skippable boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT onboarding_steps_action_type_check CHECK ((action_type = ANY (ARRAY['read'::text, 'visit_page'::text, 'create_workspace'::text, 'complete_company_profile'::text, 'add_wallet'::text, 'upload_document'::text, 'review_document'::text, 'create_invoice'::text, 'create_receivable'::text, 'create_payable'::text, 'connect_payment_provider'::text, 'invite_team_member'::text, 'view_report'::text, 'open_ai_accountant'::text, 'complete_tax_profile'::text, 'open_support'::text, 'custom'::text]))),
    CONSTRAINT onboarding_steps_product_area_check CHECK ((product_area = ANY (ARRAY['general'::text, 'pulse'::text, 'radar'::text, 'ai_cfo'::text, 'ai_accountant'::text, 'transactions'::text, 'accounts'::text, 'invoices'::text, 'receivables'::text, 'payables'::text, 'funding'::text, 'bank_import'::text, 'incoming_payments'::text, 'payment_connections'::text, 'intercompany'::text, 'payroll'::text, 'approvals'::text, 'team'::text, 'documents'::text, 'settings'::text, 'support'::text, 'admin'::text])))
);


--
-- Name: payment_provider_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_provider_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    provider text NOT NULL,
    environment text DEFAULT 'sandbox'::text NOT NULL,
    status text DEFAULT 'disconnected'::text NOT NULL,
    display_name text,
    provider_account_id text,
    linked_wallet_id uuid,
    last_sync_at timestamp with time zone,
    last_webhook_at timestamp with time zone,
    last_error text,
    created_by_user_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payment_provider_connections_environment_check CHECK ((environment = ANY (ARRAY['sandbox'::text, 'production'::text]))),
    CONSTRAINT payment_provider_connections_provider_check CHECK ((provider = ANY (ARRAY['midtrans'::text, 'xendit'::text, 'doku'::text, 'hitpay'::text, 'duitku'::text, 'ipaymu'::text, 'manual'::text, 'bank'::text]))),
    CONSTRAINT payment_provider_connections_status_check CHECK ((status = ANY (ARRAY['disconnected'::text, 'connected'::text, 'error'::text, 'disabled'::text])))
);


--
-- Name: payment_provider_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_provider_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    connection_id uuid NOT NULL,
    business_id uuid NOT NULL,
    provider text NOT NULL,
    environment text NOT NULL,
    credential_type text NOT NULL,
    encrypted_value text NOT NULL,
    encryption_iv text NOT NULL,
    encryption_tag text NOT NULL,
    value_fingerprint text NOT NULL,
    value_last4 text,
    status text DEFAULT 'active'::text NOT NULL,
    created_by_user_id bigint,
    revoked_by_user_id bigint,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payment_credentials_revocation_stamp CHECK ((((status = 'active'::text) AND (revoked_at IS NULL) AND (revoked_by_user_id IS NULL)) OR ((status = 'revoked'::text) AND (revoked_at IS NOT NULL)))),
    CONSTRAINT payment_provider_credentials_credential_type_check CHECK ((credential_type = ANY (ARRAY['api_key'::text, 'secret_key'::text, 'server_key'::text, 'client_key'::text, 'webhook_secret'::text, 'merchant_id'::text, 'other'::text]))),
    CONSTRAINT payment_provider_credentials_encrypted_value_check CHECK ((length(encrypted_value) > 0)),
    CONSTRAINT payment_provider_credentials_encryption_iv_check CHECK ((length(encryption_iv) > 0)),
    CONSTRAINT payment_provider_credentials_encryption_tag_check CHECK ((length(encryption_tag) > 0)),
    CONSTRAINT payment_provider_credentials_status_check CHECK ((status = ANY (ARRAY['active'::text, 'revoked'::text]))),
    CONSTRAINT payment_provider_credentials_value_fingerprint_check CHECK ((length(value_fingerprint) > 0)),
    CONSTRAINT payment_provider_credentials_value_last4_check CHECK (((value_last4 IS NULL) OR (length(value_last4) <= 4)))
);


--
-- Name: payroll_employees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_employees (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id bigint NOT NULL,
    name text NOT NULL,
    role text,
    default_salary numeric,
    currency text DEFAULT 'IDR'::text,
    pay_day integer,
    default_wallet_id uuid,
    status text DEFAULT 'active'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    business_id uuid,
    created_by_user_id bigint,
    CONSTRAINT payroll_employees_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'archived'::text])))
);


--
-- Name: payroll_payment_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_payment_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id bigint NOT NULL,
    payroll_payment_id uuid,
    item_type text NOT NULL,
    label text NOT NULL,
    amount numeric NOT NULL,
    direction text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    business_id uuid,
    CONSTRAINT payroll_payment_items_direction_check CHECK ((direction = ANY (ARRAY['addition'::text, 'deduction'::text])))
);


--
-- Name: payroll_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id bigint NOT NULL,
    employee_id uuid,
    transaction_id bigint,
    employee_name text NOT NULL,
    amount numeric NOT NULL,
    currency text DEFAULT 'IDR'::text,
    payment_type text DEFAULT 'salary'::text,
    period_month text,
    payment_date date,
    wallet_id uuid,
    status text DEFAULT 'paid'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    gross_amount numeric DEFAULT 0,
    deduction_amount numeric DEFAULT 0,
    net_amount numeric,
    business_id uuid,
    created_by_user_id bigint,
    CONSTRAINT payroll_payments_payment_type_check CHECK ((payment_type = ANY (ARRAY['salary'::text, 'bonus'::text, 'advance'::text, 'commission'::text, 'other'::text]))),
    CONSTRAINT payroll_payments_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'scheduled'::text, 'paid'::text, 'cancelled'::text])))
);


--
-- Name: plan_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plan_limits (
    plan text NOT NULL,
    max_businesses integer,
    max_users integer,
    max_wallets integer,
    max_transactions_per_month integer,
    max_invoices_per_month integer,
    max_ai_questions_per_month integer,
    max_voice_inputs_per_month integer,
    payroll_enabled boolean DEFAULT false,
    team_access_enabled boolean DEFAULT false,
    approval_flow_enabled boolean DEFAULT false,
    advanced_radar_enabled boolean DEFAULT false,
    export_enabled boolean DEFAULT false,
    integrations_enabled boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: reminders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reminders (
    id integer NOT NULL,
    user_id bigint,
    title text NOT NULL,
    meta text,
    due_date timestamp with time zone,
    is_recurring boolean DEFAULT false,
    recur_interval text,
    scope text DEFAULT 'personal'::text,
    is_done boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    snoozed_until timestamp with time zone,
    business_id uuid
);


--
-- Name: reminders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reminders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reminders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reminders_id_seq OWNED BY public.reminders.id;


--
-- Name: support_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid,
    created_by_user_id bigint NOT NULL,
    assigned_to_user_id bigint,
    channel text DEFAULT 'in_app'::text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    priority text DEFAULT 'normal'::text NOT NULL,
    category text DEFAULT 'general'::text NOT NULL,
    subject text,
    ai_mode text DEFAULT 'not_started'::text NOT NULL,
    ai_confidence numeric(5,4),
    last_message_at timestamp with time zone,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT support_conversations_ai_confidence_check CHECK (((ai_confidence IS NULL) OR ((ai_confidence >= (0)::numeric) AND (ai_confidence <= (1)::numeric)))),
    CONSTRAINT support_conversations_ai_mode_check CHECK ((ai_mode = ANY (ARRAY['not_started'::text, 'ai_active'::text, 'handoff_recommended'::text, 'human_only'::text]))),
    CONSTRAINT support_conversations_category_check CHECK ((category = ANY (ARRAY['general'::text, 'billing'::text, 'accounting'::text, 'documents'::text, 'payment_connections'::text, 'incoming_payments'::text, 'tax_compliance'::text, 'bug'::text, 'feature_request'::text]))),
    CONSTRAINT support_conversations_channel_check CHECK ((channel = ANY (ARRAY['in_app'::text, 'email'::text, 'telegram'::text, 'admin_created'::text]))),
    CONSTRAINT support_conversations_closed_stamp CHECK ((((status = 'closed'::text) AND (closed_at IS NOT NULL)) OR ((status <> 'closed'::text) AND (closed_at IS NULL)))),
    CONSTRAINT support_conversations_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text]))),
    CONSTRAINT support_conversations_status_check CHECK ((status = ANY (ARRAY['open'::text, 'waiting_user'::text, 'ai_answered'::text, 'human_needed'::text, 'assigned'::text, 'closed'::text])))
);


--
-- Name: support_escalations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_escalations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    business_id uuid,
    reason text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    requested_by text DEFAULT 'ai'::text NOT NULL,
    assigned_to_user_id bigint,
    resolved_by_user_id bigint,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT support_escalations_reason_check CHECK ((length(TRIM(BOTH FROM reason)) > 0)),
    CONSTRAINT support_escalations_requested_by_check CHECK ((requested_by = ANY (ARRAY['user'::text, 'ai'::text, 'manager'::text, 'system'::text]))),
    CONSTRAINT support_escalations_resolved_stamp CHECK ((((status = ANY (ARRAY['resolved'::text, 'cancelled'::text])) AND (resolved_at IS NOT NULL)) OR ((status = ANY (ARRAY['open'::text, 'assigned'::text])) AND (resolved_at IS NULL)))),
    CONSTRAINT support_escalations_status_check CHECK ((status = ANY (ARRAY['open'::text, 'assigned'::text, 'resolved'::text, 'cancelled'::text])))
);


--
-- Name: support_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    business_id uuid,
    actor_user_id bigint,
    event_type text NOT NULL,
    event_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT support_events_event_type_check CHECK ((length(TRIM(BOTH FROM event_type)) > 0))
);


--
-- Name: support_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    business_id uuid,
    sender_type text NOT NULL,
    sender_user_id bigint,
    body text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_internal boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT support_messages_body_check CHECK ((length(TRIM(BOTH FROM body)) > 0)),
    CONSTRAINT support_messages_internal_sender CHECK (((is_internal = false) OR (sender_type = ANY (ARRAY['manager'::text, 'system'::text])))),
    CONSTRAINT support_messages_sender_type_check CHECK ((sender_type = ANY (ARRAY['user'::text, 'ai'::text, 'manager'::text, 'system'::text])))
);


--
-- Name: tax_billing_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tax_billing_allocations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    billing_document_id uuid NOT NULL,
    tax_treatment_id uuid,
    withholding_record_id uuid,
    compliance_event_id uuid,
    allocated_amount numeric(20,2) NOT NULL,
    allocated_by_user_id bigint,
    allocated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT tax_billing_allocations_allocated_amount_check CHECK ((allocated_amount > (0)::numeric)),
    CONSTRAINT tax_billing_allocations_check CHECK ((((((tax_treatment_id IS NOT NULL))::integer + ((withholding_record_id IS NOT NULL))::integer) + ((compliance_event_id IS NOT NULL))::integer) = 1))
);


--
-- Name: tax_deposit_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tax_deposit_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    currency text DEFAULT 'IDR'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: tax_deposit_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tax_deposit_allocations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    deposit_entry_id uuid NOT NULL,
    deposit_account_id uuid NOT NULL,
    tax_treatment_id uuid,
    withholding_record_id uuid,
    compliance_event_id uuid,
    allocated_amount numeric(20,2) NOT NULL,
    allocated_by_user_id bigint,
    allocated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT tax_deposit_allocations_allocated_amount_check CHECK ((allocated_amount > (0)::numeric)),
    CONSTRAINT tax_deposit_allocations_check CHECK ((((((tax_treatment_id IS NOT NULL))::integer + ((withholding_record_id IS NOT NULL))::integer) + ((compliance_event_id IS NOT NULL))::integer) = 1))
);


--
-- Name: tax_deposit_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tax_deposit_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    deposit_account_id uuid NOT NULL,
    entry_type text NOT NULL,
    amount numeric(20,2) NOT NULL,
    direction smallint,
    reason text,
    transaction_id bigint,
    billing_document_id uuid,
    tax_allocation_id uuid,
    occurred_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT tax_deposit_entries_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT tax_deposit_entries_check CHECK (((entry_type <> 'adjustment'::text) OR ((direction IS NOT NULL) AND (reason IS NOT NULL)))),
    CONSTRAINT tax_deposit_entries_direction_check CHECK ((direction = ANY (ARRAY['-1'::integer, 1]))),
    CONSTRAINT tax_deposit_entries_entry_type_check CHECK ((entry_type = ANY (ARRAY['deposit_payment'::text, 'allocation'::text, 'refund'::text, 'adjustment'::text])))
);


--
-- Name: tax_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tax_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    country text,
    jurisdiction text,
    legal_entity_type text,
    tax_residency text,
    tax_regime text,
    tax_identifier text,
    financial_year_start text,
    financial_year_end text,
    vat_status text,
    pkp_status text,
    employee_status text,
    payroll_tax_status text,
    industry text,
    business_activity_codes text,
    accounting_method text,
    reporting_currency text DEFAULT 'IDR'::text,
    filing_frequency text,
    professional_partner_id bigint,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    npwp text,
    nib text,
    withholding_tax_status text,
    profile_status text DEFAULT 'incomplete'::text NOT NULL,
    verified_by_user_id bigint,
    verified_at timestamp with time zone,
    created_by_user_id bigint
);


--
-- Name: tax_rule_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tax_rule_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tax_rule_id uuid NOT NULL,
    rule_version integer,
    reviewer_user_id bigint,
    reviewer_name text,
    reviewer_role text,
    license_number text,
    license_type text,
    issuing_authority text,
    license_verification_status text DEFAULT 'unverified'::text NOT NULL,
    review_status text DEFAULT 'pending'::text NOT NULL,
    review_scope text,
    review_notes text,
    changes_requested_json jsonb,
    reviewed_at timestamp with time zone,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    verification_method text,
    CONSTRAINT tax_rule_reviews_approved_integrity_chk CHECK (((review_status <> 'approved'::text) OR ((reviewer_name IS NOT NULL) AND (license_number IS NOT NULL) AND (license_verification_status = 'verified'::text) AND (reviewed_at IS NOT NULL)))),
    CONSTRAINT tax_rule_reviews_license_status_chk CHECK ((license_verification_status = ANY (ARRAY['unverified'::text, 'verified'::text, 'failed'::text]))),
    CONSTRAINT tax_rule_reviews_review_status_chk CHECK ((review_status = ANY (ARRAY['pending'::text, 'in_review'::text, 'changes_required'::text, 'approved'::text, 'rejected'::text, 'expired'::text, 'superseded'::text])))
);


--
-- Name: tax_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tax_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jurisdiction text NOT NULL,
    country text NOT NULL,
    legal_entity_type text,
    tax_regime text,
    obligation_type text NOT NULL,
    rule_code text NOT NULL,
    title text NOT NULL,
    description text,
    calculation_method text,
    parameters jsonb DEFAULT '{}'::jsonb,
    filing_frequency text,
    payment_frequency text,
    due_date_rule text,
    applies_when jsonb DEFAULT '{}'::jsonb,
    official_source_id uuid,
    effective_from date,
    effective_to date,
    last_verified_at timestamp with time zone,
    verified_by_user_id bigint,
    version integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    legal_entity_types jsonb,
    tax_regimes jsonb,
    due_date_rule_json jsonb,
    supersedes_rule_id uuid,
    reviewed_by_user_id bigint,
    reviewed_at timestamp with time zone,
    created_by_user_id bigint,
    updated_at timestamp with time zone DEFAULT now(),
    interpretation_notes text,
    exceptions jsonb,
    required_profile_fields jsonb,
    parameters_status text DEFAULT 'not_defined'::text NOT NULL
);


--
-- Name: tax_treatments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tax_treatments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    debt_id bigint,
    invoice_document_id uuid,
    treatment_status text DEFAULT 'suggested'::text NOT NULL,
    tax_type text,
    tax_nature text,
    tax_object_code text,
    commercial_base numeric(20,2),
    vat_dpp numeric(20,2),
    vat_amount numeric(20,2),
    withholding_dpp numeric(20,2),
    withholding_rate numeric,
    withholding_amount numeric(20,2),
    expected_vendor_net numeric(20,2),
    rule_id uuid,
    rule_version integer,
    source_id uuid,
    suggestion_source text,
    confidence numeric,
    reviewed_by_user_id bigint,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    withholding_mode text,
    context_type text,
    payroll_payment_id uuid,
    compliance_event_id uuid,
    period_start date,
    period_end date,
    CONSTRAINT tax_treatments_commercial_base_check CHECK (((commercial_base IS NULL) OR (commercial_base >= (0)::numeric))),
    CONSTRAINT tax_treatments_confidence_check CHECK (((confidence IS NULL) OR ((confidence >= (0)::numeric) AND (confidence <= (1)::numeric)))),
    CONSTRAINT tax_treatments_expected_vendor_net_check CHECK (((expected_vendor_net IS NULL) OR (expected_vendor_net >= (0)::numeric))),
    CONSTRAINT tax_treatments_vat_amount_check CHECK (((vat_amount IS NULL) OR (vat_amount >= (0)::numeric))),
    CONSTRAINT tax_treatments_vat_dpp_check CHECK (((vat_dpp IS NULL) OR (vat_dpp >= (0)::numeric))),
    CONSTRAINT tax_treatments_withholding_amount_check CHECK (((withholding_amount IS NULL) OR (withholding_amount >= (0)::numeric))),
    CONSTRAINT tax_treatments_withholding_dpp_check CHECK (((withholding_dpp IS NULL) OR (withholding_dpp >= (0)::numeric))),
    CONSTRAINT tax_treatments_withholding_mode_chk CHECK (((withholding_mode IS NULL) OR (withholding_mode = ANY (ARRAY['deducted_from_vendor'::text, 'company_bears_tax'::text, 'paid_gross_not_deducted'::text, 'not_deducted_requires_review'::text, 'gross_up'::text, 'unknown'::text])))),
    CONSTRAINT tax_treatments_withholding_rate_check CHECK (((withholding_rate IS NULL) OR ((withholding_rate >= (0)::numeric) AND (withholding_rate <= (1)::numeric))))
);


--
-- Name: telegram_user_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telegram_user_state (
    user_id bigint NOT NULL,
    active_business_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transactions (
    id integer NOT NULL,
    user_id bigint,
    account_id integer,
    category_id integer,
    type text NOT NULL,
    amount_original numeric(18,2) NOT NULL,
    currency_original text NOT NULL,
    amount_idr numeric(18,2),
    description text,
    scope text DEFAULT 'personal'::text,
    project text,
    created_at timestamp with time zone DEFAULT now(),
    source text,
    category text,
    cashflow_category_id uuid,
    counterparty_id uuid,
    counterparty_name text,
    business_direction_id uuid,
    activity_type_id uuid,
    wallet_id uuid,
    transaction_date date,
    business_id uuid,
    created_by_user_id bigint,
    is_training boolean DEFAULT false,
    training_type text,
    booked_rate numeric(38,18),
    rate_source text,
    fx_quote_id uuid,
    rate_effective_date date,
    transfer_id uuid
);


--
-- Name: transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.transactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.transactions_id_seq OWNED BY public.transactions.id;


--
-- Name: user_channel_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_channel_links (
    id bigint NOT NULL,
    channel text NOT NULL,
    external_user_id text NOT NULL,
    user_id bigint NOT NULL,
    display_handle text,
    channel_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    linked_at timestamp with time zone DEFAULT now() NOT NULL,
    linked_via text DEFAULT 'link_token'::text NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by_user_id bigint,
    CONSTRAINT user_channel_links_channel_check CHECK ((channel = 'telegram'::text))
);


--
-- Name: user_channel_links_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_channel_links_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_channel_links_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_channel_links_id_seq OWNED BY public.user_channel_links.id;


--
-- Name: user_channel_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_channel_state (
    user_id bigint NOT NULL,
    channel text NOT NULL,
    active_business_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_channel_state_channel_check CHECK ((channel = 'telegram'::text))
);


--
-- Name: user_email_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_email_identities (
    user_id bigint NOT NULL,
    email text NOT NULL,
    email_verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_email_identities_email_normalized CHECK ((email = lower(btrim(email))))
);


--
-- Name: user_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_profiles (
    user_id bigint NOT NULL,
    display_name text,
    locale text,
    timezone text,
    avatar_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id bigint NOT NULL,
    username text,
    first_name text,
    role text DEFAULT 'personal'::text NOT NULL,
    default_currency text DEFAULT 'IDR'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    last_name text DEFAULT ''::text,
    photo_url text DEFAULT ''::text,
    language text DEFAULT 'ru'::text,
    timezone text DEFAULT 'Asia/Makassar'::text
);


--
-- Name: wallets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id bigint NOT NULL,
    name text NOT NULL,
    currency text DEFAULT 'IDR'::text NOT NULL,
    type text,
    entity_name text,
    color text,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    scope text DEFAULT 'business'::text NOT NULL,
    business_id uuid,
    created_by_user_id bigint,
    CONSTRAINT wallets_scope_check CHECK ((scope = ANY (ARRAY['business'::text, 'personal'::text])))
);


--
-- Name: withholding_payment_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.withholding_payment_allocations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    withholding_record_id uuid NOT NULL,
    transaction_id bigint NOT NULL,
    allocated_amount numeric(20,2) NOT NULL,
    created_by_user_id bigint,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT withholding_payment_allocations_allocated_amount_check CHECK ((allocated_amount > (0)::numeric))
);


--
-- Name: withholding_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.withholding_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    tax_treatment_id uuid,
    debt_id bigint,
    invoice_document_id uuid,
    bukti_potong_document_id uuid,
    tax_type text,
    tax_nature text,
    tax_object_code text,
    tax_base numeric(20,2),
    tax_rate numeric,
    withholding_amount numeric(20,2),
    expected_vendor_net_amount numeric(20,2),
    status text DEFAULT 'suggested'::text NOT NULL,
    reported_at timestamp with time zone,
    paid_at timestamp with time zone,
    filing_status text DEFAULT 'not_filed'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    withholding_mode text,
    context_type text,
    compliance_event_id uuid,
    CONSTRAINT withholding_records_expected_vendor_net_amount_check CHECK (((expected_vendor_net_amount IS NULL) OR (expected_vendor_net_amount >= (0)::numeric))),
    CONSTRAINT withholding_records_tax_base_check CHECK (((tax_base IS NULL) OR (tax_base >= (0)::numeric))),
    CONSTRAINT withholding_records_tax_rate_check CHECK (((tax_rate IS NULL) OR ((tax_rate >= (0)::numeric) AND (tax_rate <= (1)::numeric)))),
    CONSTRAINT withholding_records_withholding_amount_check CHECK (((withholding_amount IS NULL) OR (withholding_amount >= (0)::numeric)))
);


--
-- Name: accounts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts ALTER COLUMN id SET DEFAULT nextval('public.accounts_id_seq'::regclass);


--
-- Name: business_member_notification_grants id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_member_notification_grants ALTER COLUMN id SET DEFAULT nextval('public.business_member_notification_grants_id_seq'::regclass);


--
-- Name: categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories ALTER COLUMN id SET DEFAULT nextval('public.categories_id_seq'::regclass);


--
-- Name: debts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.debts ALTER COLUMN id SET DEFAULT nextval('public.debts_id_seq'::regclass);


--
-- Name: reminders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminders ALTER COLUMN id SET DEFAULT nextval('public.reminders_id_seq'::regclass);


--
-- Name: transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions ALTER COLUMN id SET DEFAULT nextval('public.transactions_id_seq'::regclass);


--
-- Name: user_channel_links id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_channel_links ALTER COLUMN id SET DEFAULT nextval('public.user_channel_links_id_seq'::regclass);


--
-- Name: access_audit access_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_audit
    ADD CONSTRAINT access_audit_pkey PRIMARY KEY (id);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: activity_types activity_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_types
    ADD CONSTRAINT activity_types_pkey PRIMARY KEY (id);


--
-- Name: ai_usage_events ai_usage_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_events
    ADD CONSTRAINT ai_usage_events_pkey PRIMARY KEY (id);


--
-- Name: assets assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_pkey PRIMARY KEY (id);


--
-- Name: audit_events audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_pkey PRIMARY KEY (id);


--
-- Name: bank_import_batches bank_import_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_import_batches
    ADD CONSTRAINT bank_import_batches_pkey PRIMARY KEY (id);


--
-- Name: bank_import_matches bank_import_matches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_import_matches
    ADD CONSTRAINT bank_import_matches_pkey PRIMARY KEY (id);


--
-- Name: bank_import_rows bank_import_rows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_import_rows
    ADD CONSTRAINT bank_import_rows_pkey PRIMARY KEY (id);


--
-- Name: bank_reconciliations bank_reconciliations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_reconciliations
    ADD CONSTRAINT bank_reconciliations_pkey PRIMARY KEY (id);


--
-- Name: business_addons business_addons_business_id_addon_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_addons
    ADD CONSTRAINT business_addons_business_id_addon_key UNIQUE (business_id, addon);


--
-- Name: business_addons business_addons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_addons
    ADD CONSTRAINT business_addons_pkey PRIMARY KEY (id);


--
-- Name: business_directions business_directions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_directions
    ADD CONSTRAINT business_directions_pkey PRIMARY KEY (id);


--
-- Name: business_funding_records business_funding_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_funding_records
    ADD CONSTRAINT business_funding_records_pkey PRIMARY KEY (id);


--
-- Name: business_funding_repayments business_funding_repayments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_funding_repayments
    ADD CONSTRAINT business_funding_repayments_pkey PRIMARY KEY (id);


--
-- Name: business_invites business_invites_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_invites
    ADD CONSTRAINT business_invites_code_key UNIQUE (code);


--
-- Name: business_invites business_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_invites
    ADD CONSTRAINT business_invites_pkey PRIMARY KEY (id);


--
-- Name: business_member_notification_grants business_member_notification_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_member_notification_grants
    ADD CONSTRAINT business_member_notification_grants_pkey PRIMARY KEY (id);


--
-- Name: business_members business_members_business_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_members
    ADD CONSTRAINT business_members_business_id_user_id_key UNIQUE (business_id, user_id);


--
-- Name: business_members business_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_members
    ADD CONSTRAINT business_members_pkey PRIMARY KEY (id);


--
-- Name: business_relationships business_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_relationships
    ADD CONSTRAINT business_relationships_pkey PRIMARY KEY (id);


--
-- Name: businesses businesses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.businesses
    ADD CONSTRAINT businesses_pkey PRIMARY KEY (id);


--
-- Name: cashflow_categories cashflow_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cashflow_categories
    ADD CONSTRAINT cashflow_categories_pkey PRIMARY KEY (id);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: channel_link_tokens channel_link_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_link_tokens
    ADD CONSTRAINT channel_link_tokens_pkey PRIMARY KEY (token_hash);


--
-- Name: classification_feedback classification_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classification_feedback
    ADD CONSTRAINT classification_feedback_pkey PRIMARY KEY (id);


--
-- Name: classification_rules classification_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classification_rules
    ADD CONSTRAINT classification_rules_pkey PRIMARY KEY (id);


--
-- Name: compliance_events compliance_events_business_id_rule_code_period_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_events
    ADD CONSTRAINT compliance_events_business_id_rule_code_period_key UNIQUE (business_id, rule_code, period);


--
-- Name: compliance_events compliance_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_events
    ADD CONSTRAINT compliance_events_pkey PRIMARY KEY (id);


--
-- Name: counterparties counterparties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.counterparties
    ADD CONSTRAINT counterparties_pkey PRIMARY KEY (id);


--
-- Name: counterparty_bank_accounts counterparty_bank_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.counterparty_bank_accounts
    ADD CONSTRAINT counterparty_bank_accounts_pkey PRIMARY KEY (id);


--
-- Name: debt_payment_idempotency debt_payment_idempotency_biz_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.debt_payment_idempotency
    ADD CONSTRAINT debt_payment_idempotency_biz_key_unique UNIQUE (business_id, key);


--
-- Name: debt_payment_idempotency debt_payment_idempotency_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.debt_payment_idempotency
    ADD CONSTRAINT debt_payment_idempotency_pkey PRIMARY KEY (id);


--
-- Name: debt_settlement_allocations debt_settlement_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.debt_settlement_allocations
    ADD CONSTRAINT debt_settlement_allocations_pkey PRIMARY KEY (id);


--
-- Name: debts debts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.debts
    ADD CONSTRAINT debts_pkey PRIMARY KEY (id);


--
-- Name: document_audit document_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_audit
    ADD CONSTRAINT document_audit_pkey PRIMARY KEY (id);


--
-- Name: document_compliance_links document_compliance_links_document_id_compliance_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_compliance_links
    ADD CONSTRAINT document_compliance_links_document_id_compliance_event_id_key UNIQUE (document_id, compliance_event_id);


--
-- Name: document_compliance_links document_compliance_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_compliance_links
    ADD CONSTRAINT document_compliance_links_pkey PRIMARY KEY (id);


--
-- Name: document_debt_links document_debt_links_document_id_debt_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_debt_links
    ADD CONSTRAINT document_debt_links_document_id_debt_id_key UNIQUE (document_id, debt_id);


--
-- Name: document_debt_links document_debt_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_debt_links
    ADD CONSTRAINT document_debt_links_pkey PRIMARY KEY (id);


--
-- Name: document_files document_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_files
    ADD CONSTRAINT document_files_pkey PRIMARY KEY (id);


--
-- Name: document_links document_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_links
    ADD CONSTRAINT document_links_pkey PRIMARY KEY (id);


--
-- Name: document_transaction_links document_transaction_links_document_id_transaction_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_transaction_links
    ADD CONSTRAINT document_transaction_links_document_id_transaction_id_key UNIQUE (document_id, transaction_id);


--
-- Name: document_transaction_links document_transaction_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_transaction_links
    ADD CONSTRAINT document_transaction_links_pkey PRIMARY KEY (id);


--
-- Name: email_login_codes email_login_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_login_codes
    ADD CONSTRAINT email_login_codes_pkey PRIMARY KEY (id);


--
-- Name: financial_documents financial_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_documents
    ADD CONSTRAINT financial_documents_pkey PRIMARY KEY (id);


--
-- Name: incoming_payment_match_candidates incoming_payment_match_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incoming_payment_match_candidates
    ADD CONSTRAINT incoming_payment_match_candidates_pkey PRIMARY KEY (id);


--
-- Name: incoming_payments incoming_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incoming_payments
    ADD CONSTRAINT incoming_payments_pkey PRIMARY KEY (id);


--
-- Name: industry_templates industry_templates_kbli_prefix_category_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.industry_templates
    ADD CONSTRAINT industry_templates_kbli_prefix_category_name_key UNIQUE (kbli_prefix, category_name);


--
-- Name: industry_templates industry_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.industry_templates
    ADD CONSTRAINT industry_templates_pkey PRIMARY KEY (id);


--
-- Name: intercompany_funding_records intercompany_funding_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intercompany_funding_records
    ADD CONSTRAINT intercompany_funding_records_pkey PRIMARY KEY (id);


--
-- Name: intercompany_settlement_allocations intercompany_settlement_alloc_funding_record_id_repayment_t_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intercompany_settlement_allocations
    ADD CONSTRAINT intercompany_settlement_alloc_funding_record_id_repayment_t_key UNIQUE (funding_record_id, repayment_transaction_id);


--
-- Name: intercompany_settlement_allocations intercompany_settlement_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intercompany_settlement_allocations
    ADD CONSTRAINT intercompany_settlement_allocations_pkey PRIMARY KEY (id);


--
-- Name: mcp_oauth_clients mcp_oauth_clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_oauth_clients
    ADD CONSTRAINT mcp_oauth_clients_pkey PRIMARY KEY (client_id);


--
-- Name: mcp_oauth_codes mcp_oauth_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_oauth_codes
    ADD CONSTRAINT mcp_oauth_codes_pkey PRIMARY KEY (code_hash);


--
-- Name: mcp_oauth_requests mcp_oauth_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_oauth_requests
    ADD CONSTRAINT mcp_oauth_requests_pkey PRIMARY KEY (id);


--
-- Name: mcp_oauth_tokens mcp_oauth_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_oauth_tokens
    ADD CONSTRAINT mcp_oauth_tokens_pkey PRIMARY KEY (token_hash);


--
-- Name: official_sources official_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.official_sources
    ADD CONSTRAINT official_sources_pkey PRIMARY KEY (id);


--
-- Name: onboarding_context_snapshots onboarding_context_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_context_snapshots
    ADD CONSTRAINT onboarding_context_snapshots_pkey PRIMARY KEY (id);


--
-- Name: onboarding_events onboarding_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_events
    ADD CONSTRAINT onboarding_events_pkey PRIMARY KEY (id);


--
-- Name: onboarding_flows onboarding_flows_flow_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_flows
    ADD CONSTRAINT onboarding_flows_flow_key_key UNIQUE (flow_key);


--
-- Name: onboarding_flows onboarding_flows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_flows
    ADD CONSTRAINT onboarding_flows_pkey PRIMARY KEY (id);


--
-- Name: onboarding_progress onboarding_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_progress
    ADD CONSTRAINT onboarding_progress_pkey PRIMARY KEY (id);


--
-- Name: onboarding_step_progress onboarding_step_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_step_progress
    ADD CONSTRAINT onboarding_step_progress_pkey PRIMARY KEY (id);


--
-- Name: onboarding_step_progress onboarding_step_progress_progress_id_step_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_step_progress
    ADD CONSTRAINT onboarding_step_progress_progress_id_step_id_key UNIQUE (progress_id, step_id);


--
-- Name: onboarding_steps onboarding_steps_flow_id_step_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_steps
    ADD CONSTRAINT onboarding_steps_flow_id_step_key_key UNIQUE (flow_id, step_key);


--
-- Name: onboarding_steps onboarding_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_steps
    ADD CONSTRAINT onboarding_steps_pkey PRIMARY KEY (id);


--
-- Name: payment_provider_connections payment_provider_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_provider_connections
    ADD CONSTRAINT payment_provider_connections_pkey PRIMARY KEY (id);


--
-- Name: payment_provider_credentials payment_provider_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_provider_credentials
    ADD CONSTRAINT payment_provider_credentials_pkey PRIMARY KEY (id);


--
-- Name: payroll_employees payroll_employees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_employees
    ADD CONSTRAINT payroll_employees_pkey PRIMARY KEY (id);


--
-- Name: payroll_payment_items payroll_payment_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_payment_items
    ADD CONSTRAINT payroll_payment_items_pkey PRIMARY KEY (id);


--
-- Name: payroll_payments payroll_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_payments
    ADD CONSTRAINT payroll_payments_pkey PRIMARY KEY (id);


--
-- Name: plan_limits plan_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_limits
    ADD CONSTRAINT plan_limits_pkey PRIMARY KEY (plan);


--
-- Name: reminders reminders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminders
    ADD CONSTRAINT reminders_pkey PRIMARY KEY (id);


--
-- Name: support_conversations support_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_conversations
    ADD CONSTRAINT support_conversations_pkey PRIMARY KEY (id);


--
-- Name: support_escalations support_escalations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_escalations
    ADD CONSTRAINT support_escalations_pkey PRIMARY KEY (id);


--
-- Name: support_events support_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_events
    ADD CONSTRAINT support_events_pkey PRIMARY KEY (id);


--
-- Name: support_messages support_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_pkey PRIMARY KEY (id);


--
-- Name: tax_billing_allocations tax_billing_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_billing_allocations
    ADD CONSTRAINT tax_billing_allocations_pkey PRIMARY KEY (id);


--
-- Name: tax_deposit_accounts tax_deposit_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_deposit_accounts
    ADD CONSTRAINT tax_deposit_accounts_pkey PRIMARY KEY (id);


--
-- Name: tax_deposit_allocations tax_deposit_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_deposit_allocations
    ADD CONSTRAINT tax_deposit_allocations_pkey PRIMARY KEY (id);


--
-- Name: tax_deposit_entries tax_deposit_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_deposit_entries
    ADD CONSTRAINT tax_deposit_entries_pkey PRIMARY KEY (id);


--
-- Name: tax_profiles tax_profiles_business_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_profiles
    ADD CONSTRAINT tax_profiles_business_id_key UNIQUE (business_id);


--
-- Name: tax_profiles tax_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_profiles
    ADD CONSTRAINT tax_profiles_pkey PRIMARY KEY (id);


--
-- Name: tax_rule_reviews tax_rule_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_rule_reviews
    ADD CONSTRAINT tax_rule_reviews_pkey PRIMARY KEY (id);


--
-- Name: tax_rules tax_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_rules
    ADD CONSTRAINT tax_rules_pkey PRIMARY KEY (id);


--
-- Name: tax_treatments tax_treatments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_treatments
    ADD CONSTRAINT tax_treatments_pkey PRIMARY KEY (id);


--
-- Name: telegram_user_state telegram_user_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_user_state
    ADD CONSTRAINT telegram_user_state_pkey PRIMARY KEY (user_id);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: user_channel_links user_channel_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_channel_links
    ADD CONSTRAINT user_channel_links_pkey PRIMARY KEY (id);


--
-- Name: user_channel_state user_channel_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_channel_state
    ADD CONSTRAINT user_channel_state_pkey PRIMARY KEY (user_id, channel);


--
-- Name: user_email_identities user_email_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_email_identities
    ADD CONSTRAINT user_email_identities_pkey PRIMARY KEY (user_id);


--
-- Name: user_profiles user_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_pkey PRIMARY KEY (user_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: wallets wallets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_pkey PRIMARY KEY (id);


--
-- Name: withholding_payment_allocations withholding_payment_allocatio_withholding_record_id_transac_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.withholding_payment_allocations
    ADD CONSTRAINT withholding_payment_allocatio_withholding_record_id_transac_key UNIQUE (withholding_record_id, transaction_id);


--
-- Name: withholding_payment_allocations withholding_payment_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.withholding_payment_allocations
    ADD CONSTRAINT withholding_payment_allocations_pkey PRIMARY KEY (id);


--
-- Name: withholding_records withholding_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.withholding_records
    ADD CONSTRAINT withholding_records_pkey PRIMARY KEY (id);


--
-- Name: access_audit_business_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX access_audit_business_idx ON public.access_audit USING btree (business_id, changed_at);


--
-- Name: activity_types_business_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activity_types_business_id_idx ON public.activity_types USING btree (business_id);


--
-- Name: ai_usage_events_biz_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_usage_events_biz_idx ON public.ai_usage_events USING btree (business_id, feature, created_at);


--
-- Name: assets_business_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assets_business_idx ON public.assets USING btree (business_id, acquired_on);


--
-- Name: assets_purchase_debt_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX assets_purchase_debt_uniq ON public.assets USING btree (purchase_debt_id) WHERE (purchase_debt_id IS NOT NULL);


--
-- Name: assets_purchase_tx_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX assets_purchase_tx_uniq ON public.assets USING btree (purchase_transaction_id) WHERE (purchase_transaction_id IS NOT NULL);


--
-- Name: audit_events_business_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_business_idx ON public.audit_events USING btree (business_id, created_at);


--
-- Name: audit_events_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_entity_idx ON public.audit_events USING btree (entity_type, entity_id);


--
-- Name: bank_import_batches_business_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bank_import_batches_business_idx ON public.bank_import_batches USING btree (business_id, created_at);


--
-- Name: bank_import_matches_row_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bank_import_matches_row_idx ON public.bank_import_matches USING btree (row_id);


--
-- Name: bank_import_rows_batch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bank_import_rows_batch_idx ON public.bank_import_rows USING btree (batch_id);


--
-- Name: bank_import_rows_dedup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bank_import_rows_dedup_idx ON public.bank_import_rows USING btree (business_id, dedup_hash);


--
-- Name: bank_import_rows_review_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bank_import_rows_review_idx ON public.bank_import_rows USING btree (batch_id, review_status);


--
-- Name: bank_reconciliations_batch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bank_reconciliations_batch_idx ON public.bank_reconciliations USING btree (batch_id);


--
-- Name: bfr_business_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bfr_business_idx ON public.business_funding_records USING btree (business_id, received_on);


--
-- Name: bfrp_business_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bfrp_business_due_idx ON public.business_funding_repayments USING btree (business_id, due_on) WHERE (paid_on IS NULL);


--
-- Name: bfrp_paid_tx_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bfrp_paid_tx_uniq ON public.business_funding_repayments USING btree (paid_transaction_id) WHERE (paid_transaction_id IS NOT NULL);


--
-- Name: bfrp_record_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bfrp_record_idx ON public.business_funding_repayments USING btree (funding_record_id, due_on);


--
-- Name: business_addons_business_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX business_addons_business_id_idx ON public.business_addons USING btree (business_id);


--
-- Name: business_directions_business_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX business_directions_business_id_idx ON public.business_directions USING btree (business_id);


--
-- Name: business_invites_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX business_invites_code_idx ON public.business_invites USING btree (code);


--
-- Name: business_member_notification_grants_biz_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX business_member_notification_grants_biz_idx ON public.business_member_notification_grants USING btree (business_id) WHERE (enabled = true);


--
-- Name: business_member_notification_grants_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX business_member_notification_grants_uidx ON public.business_member_notification_grants USING btree (business_id, user_id, category);


--
-- Name: business_members_onboarding_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX business_members_onboarding_status_idx ON public.business_members USING btree (onboarding_status);


--
-- Name: business_relationships_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX business_relationships_uniq ON public.business_relationships USING btree (from_business_id, to_business_id, relationship_type, effective_from);


--
-- Name: businesses_business_code_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX businesses_business_code_uidx ON public.businesses USING btree (business_code);


--
-- Name: businesses_one_personal_v1_per_owner_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX businesses_one_personal_v1_per_owner_uidx ON public.businesses USING btree (owner_user_id) WHERE (type = 'personal'::text);


--
-- Name: cashflow_categories_business_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cashflow_categories_business_id_idx ON public.cashflow_categories USING btree (business_id);


--
-- Name: channel_link_tokens_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX channel_link_tokens_expires_idx ON public.channel_link_tokens USING btree (expires_at) WHERE (used_at IS NULL);


--
-- Name: channel_link_tokens_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX channel_link_tokens_user_idx ON public.channel_link_tokens USING btree (user_id, intended_channel);


--
-- Name: classification_feedback_biz_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX classification_feedback_biz_idx ON public.classification_feedback USING btree (business_id, normalized_desc);


--
-- Name: classification_rules_biz_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX classification_rules_biz_idx ON public.classification_rules USING btree (business_id, is_enabled, priority);


--
-- Name: classification_rules_norm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX classification_rules_norm_idx ON public.classification_rules USING btree (business_id, normalized_value);


--
-- Name: compliance_events_business_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX compliance_events_business_idx ON public.compliance_events USING btree (business_id, due_date);


--
-- Name: counterparties_business_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX counterparties_business_id_idx ON public.counterparties USING btree (business_id);


--
-- Name: counterparties_business_npwp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX counterparties_business_npwp_idx ON public.counterparties USING btree (business_id, npwp) WHERE (npwp IS NOT NULL);


--
-- Name: counterparties_business_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX counterparties_business_status_idx ON public.counterparties USING btree (business_id, status);


--
-- Name: counterparties_external_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX counterparties_external_idx ON public.counterparties USING btree (business_id, source_system, external_id) WHERE ((source_system IS NOT NULL) AND (external_id IS NOT NULL));


--
-- Name: counterparties_external_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX counterparties_external_uniq ON public.counterparties USING btree (business_id, source_system, external_id) WHERE ((source_system IS NOT NULL) AND (external_id IS NOT NULL));


--
-- Name: cp_bank_acct_business_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cp_bank_acct_business_idx ON public.counterparty_bank_accounts USING btree (business_id, account_number_normalized);


--
-- Name: cp_bank_acct_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cp_bank_acct_uniq ON public.counterparty_bank_accounts USING btree (counterparty_id, account_number_normalized);


--
-- Name: debt_settle_debt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX debt_settle_debt_idx ON public.debt_settlement_allocations USING btree (debt_id);


--
-- Name: debt_settle_tx_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX debt_settle_tx_uniq ON public.debt_settlement_allocations USING btree (debt_id, transaction_id) WHERE (transaction_id IS NOT NULL);


--
-- Name: debt_settle_wht_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX debt_settle_wht_uniq ON public.debt_settlement_allocations USING btree (debt_id, withholding_record_id) WHERE (withholding_record_id IS NOT NULL);


--
-- Name: debts_business_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX debts_business_id_idx ON public.debts USING btree (business_id);


--
-- Name: debts_is_training_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX debts_is_training_idx ON public.debts USING btree (is_training);


--
-- Name: document_audit_business_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_audit_business_idx ON public.document_audit USING btree (business_id, created_at);


--
-- Name: document_audit_document_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_audit_document_idx ON public.document_audit USING btree (document_id);


--
-- Name: document_files_dedup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX document_files_dedup_idx ON public.document_files USING btree (business_id, sha256_hash);


--
-- Name: document_links_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX document_links_uniq ON public.document_links USING btree (source_document_id, target_document_id, link_type);


--
-- Name: email_login_codes_email_purpose_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_login_codes_email_purpose_idx ON public.email_login_codes USING btree (email, purpose, created_at DESC);


--
-- Name: email_login_codes_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_login_codes_expires_idx ON public.email_login_codes USING btree (expires_at);


--
-- Name: fin_docs_business_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fin_docs_business_type_idx ON public.financial_documents USING btree (business_id, document_type);


--
-- Name: fin_docs_file_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fin_docs_file_idx ON public.financial_documents USING btree (file_id);


--
-- Name: fin_docs_number_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fin_docs_number_idx ON public.financial_documents USING btree (business_id, document_number);


--
-- Name: ic_funding_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ic_funding_owner_idx ON public.intercompany_funding_records USING btree (economic_owner_business_id, status);


--
-- Name: ic_funding_payer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ic_funding_payer_idx ON public.intercompany_funding_records USING btree (cash_payer_business_id, status);


--
-- Name: ic_settle_funding_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ic_settle_funding_idx ON public.intercompany_settlement_allocations USING btree (funding_record_id);


--
-- Name: idx_bank_import_batches_document_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bank_import_batches_document_id ON public.bank_import_batches USING btree (document_id);


--
-- Name: idx_debt_payment_idempotency_debt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_debt_payment_idempotency_debt ON public.debt_payment_idempotency USING btree (debt_id);


--
-- Name: idx_debt_payment_idempotency_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_debt_payment_idempotency_key ON public.debt_payment_idempotency USING btree (business_id, key);


--
-- Name: idx_debts_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_debts_user ON public.debts USING btree (user_id, is_settled);


--
-- Name: idx_reminders_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reminders_user ON public.reminders USING btree (user_id, is_done);


--
-- Name: idx_transactions_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_scope ON public.transactions USING btree (user_id, scope);


--
-- Name: idx_transactions_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_source ON public.transactions USING btree (user_id, source);


--
-- Name: idx_transactions_transfer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_transfer_id ON public.transactions USING btree (transfer_id);


--
-- Name: idx_transactions_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_type ON public.transactions USING btree (user_id, type);


--
-- Name: incoming_payment_candidates_business_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX incoming_payment_candidates_business_idx ON public.incoming_payment_match_candidates USING btree (business_id, status);


--
-- Name: incoming_payment_candidates_payment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX incoming_payment_candidates_payment_idx ON public.incoming_payment_match_candidates USING btree (incoming_payment_id, status, score DESC);


--
-- Name: incoming_payment_candidates_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX incoming_payment_candidates_uidx ON public.incoming_payment_match_candidates USING btree (incoming_payment_id, target_type, COALESCE(target_debt_id, ('-1'::integer)::bigint), COALESCE(target_transaction_id, ('-1'::integer)::bigint));


--
-- Name: incoming_payments_bank_batch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX incoming_payments_bank_batch_idx ON public.incoming_payments USING btree (business_id, bank_import_batch_id) WHERE (bank_import_batch_id IS NOT NULL);


--
-- Name: incoming_payments_bank_row_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX incoming_payments_bank_row_uidx ON public.incoming_payments USING btree (business_id, bank_import_row_id) WHERE (bank_import_row_id IS NOT NULL);


--
-- Name: incoming_payments_business_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX incoming_payments_business_idx ON public.incoming_payments USING btree (business_id, created_at DESC);


--
-- Name: incoming_payments_idempotency_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX incoming_payments_idempotency_uidx ON public.incoming_payments USING btree (business_id, source_type, COALESCE(provider, ''::text), idempotency_key);


--
-- Name: incoming_payments_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX incoming_payments_provider_idx ON public.incoming_payments USING btree (business_id, provider);


--
-- Name: incoming_payments_provider_txn_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX incoming_payments_provider_txn_uidx ON public.incoming_payments USING btree (business_id, COALESCE(provider, ''::text), provider_transaction_id) WHERE (provider_transaction_id IS NOT NULL);


--
-- Name: incoming_payments_reconciliation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX incoming_payments_reconciliation_idx ON public.incoming_payments USING btree (business_id, reconciliation_status);


--
-- Name: incoming_payments_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX incoming_payments_status_idx ON public.incoming_payments USING btree (business_id, status);


--
-- Name: mcp_oauth_codes_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mcp_oauth_codes_user_idx ON public.mcp_oauth_codes USING btree (user_id);


--
-- Name: mcp_oauth_requests_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mcp_oauth_requests_expires_idx ON public.mcp_oauth_requests USING btree (expires_at);


--
-- Name: mcp_oauth_tokens_grant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mcp_oauth_tokens_grant_idx ON public.mcp_oauth_tokens USING btree (grant_id);


--
-- Name: mcp_oauth_tokens_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mcp_oauth_tokens_user_idx ON public.mcp_oauth_tokens USING btree (user_id);


--
-- Name: official_sources_jurisdiction_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX official_sources_jurisdiction_idx ON public.official_sources USING btree (jurisdiction);


--
-- Name: onboarding_events_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX onboarding_events_created_idx ON public.onboarding_events USING btree (created_at DESC);


--
-- Name: onboarding_events_flow_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX onboarding_events_flow_idx ON public.onboarding_events USING btree (flow_id, event_type);


--
-- Name: onboarding_events_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX onboarding_events_user_idx ON public.onboarding_events USING btree (user_id, created_at DESC);


--
-- Name: onboarding_flows_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX onboarding_flows_active_idx ON public.onboarding_flows USING btree (is_active, sort_order);


--
-- Name: onboarding_flows_mode_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX onboarding_flows_mode_idx ON public.onboarding_flows USING btree (mode);


--
-- Name: onboarding_progress_business_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX onboarding_progress_business_idx ON public.onboarding_progress USING btree (business_id, status);


--
-- Name: onboarding_progress_nobiz_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX onboarding_progress_nobiz_uidx ON public.onboarding_progress USING btree (user_id, flow_id) WHERE (business_id IS NULL);


--
-- Name: onboarding_progress_scoped_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX onboarding_progress_scoped_uidx ON public.onboarding_progress USING btree (user_id, business_id, flow_id) WHERE (business_id IS NOT NULL);


--
-- Name: onboarding_progress_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX onboarding_progress_user_idx ON public.onboarding_progress USING btree (user_id, status);


--
-- Name: onboarding_snapshots_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX onboarding_snapshots_user_idx ON public.onboarding_context_snapshots USING btree (user_id, created_at DESC);


--
-- Name: onboarding_step_progress_progress_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX onboarding_step_progress_progress_idx ON public.onboarding_step_progress USING btree (progress_id, status);


--
-- Name: onboarding_steps_area_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX onboarding_steps_area_idx ON public.onboarding_steps USING btree (product_area);


--
-- Name: onboarding_steps_flow_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX onboarding_steps_flow_idx ON public.onboarding_steps USING btree (flow_id, sort_order);


--
-- Name: payment_credentials_business_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_credentials_business_idx ON public.payment_provider_credentials USING btree (business_id, status);


--
-- Name: payment_credentials_connection_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_credentials_connection_idx ON public.payment_provider_credentials USING btree (connection_id, status);


--
-- Name: payment_credentials_fingerprint_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_credentials_fingerprint_idx ON public.payment_provider_credentials USING btree (business_id, value_fingerprint);


--
-- Name: payment_credentials_one_active_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX payment_credentials_one_active_uidx ON public.payment_provider_credentials USING btree (connection_id, credential_type) WHERE (status = 'active'::text);


--
-- Name: payment_provider_connections_account_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX payment_provider_connections_account_uidx ON public.payment_provider_connections USING btree (business_id, provider, environment, provider_account_id) WHERE (provider_account_id IS NOT NULL);


--
-- Name: payment_provider_connections_business_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_provider_connections_business_idx ON public.payment_provider_connections USING btree (business_id, created_at DESC);


--
-- Name: payment_provider_connections_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_provider_connections_provider_idx ON public.payment_provider_connections USING btree (provider);


--
-- Name: payment_provider_connections_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_provider_connections_status_idx ON public.payment_provider_connections USING btree (status);


--
-- Name: payment_provider_connections_wallet_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_provider_connections_wallet_idx ON public.payment_provider_connections USING btree (linked_wallet_id) WHERE (linked_wallet_id IS NOT NULL);


--
-- Name: payroll_employees_business_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payroll_employees_business_id_idx ON public.payroll_employees USING btree (business_id);


--
-- Name: payroll_employees_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payroll_employees_user_id_idx ON public.payroll_employees USING btree (user_id);


--
-- Name: payroll_payment_items_business_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payroll_payment_items_business_id_idx ON public.payroll_payment_items USING btree (business_id);


--
-- Name: payroll_payment_items_payment_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payroll_payment_items_payment_id_idx ON public.payroll_payment_items USING btree (payroll_payment_id);


--
-- Name: payroll_payment_items_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payroll_payment_items_user_id_idx ON public.payroll_payment_items USING btree (user_id);


--
-- Name: payroll_payments_business_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payroll_payments_business_id_idx ON public.payroll_payments USING btree (business_id);


--
-- Name: payroll_payments_employee_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payroll_payments_employee_id_idx ON public.payroll_payments USING btree (employee_id);


--
-- Name: payroll_payments_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payroll_payments_user_id_idx ON public.payroll_payments USING btree (user_id);


--
-- Name: reminders_business_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reminders_business_id_idx ON public.reminders USING btree (business_id);


--
-- Name: support_conversations_assignee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX support_conversations_assignee_idx ON public.support_conversations USING btree (assigned_to_user_id) WHERE (assigned_to_user_id IS NOT NULL);


--
-- Name: support_conversations_business_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX support_conversations_business_idx ON public.support_conversations USING btree (business_id, last_message_at DESC NULLS LAST);


--
-- Name: support_conversations_creator_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX support_conversations_creator_idx ON public.support_conversations USING btree (created_by_user_id, created_at DESC);


--
-- Name: support_conversations_last_message_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX support_conversations_last_message_idx ON public.support_conversations USING btree (last_message_at DESC NULLS LAST);


--
-- Name: support_conversations_priority_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX support_conversations_priority_idx ON public.support_conversations USING btree (priority);


--
-- Name: support_conversations_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX support_conversations_status_idx ON public.support_conversations USING btree (status);


--
-- Name: support_escalations_business_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX support_escalations_business_idx ON public.support_escalations USING btree (business_id, status);


--
-- Name: support_escalations_conversation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX support_escalations_conversation_idx ON public.support_escalations USING btree (conversation_id, created_at DESC);


--
-- Name: support_escalations_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX support_escalations_status_idx ON public.support_escalations USING btree (status, created_at DESC);


--
-- Name: support_events_conversation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX support_events_conversation_idx ON public.support_events USING btree (conversation_id, created_at);


--
-- Name: support_messages_business_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX support_messages_business_idx ON public.support_messages USING btree (business_id, created_at DESC);


--
-- Name: support_messages_conversation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX support_messages_conversation_idx ON public.support_messages USING btree (conversation_id, created_at);


--
-- Name: tax_billing_alloc_doc_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tax_billing_alloc_doc_idx ON public.tax_billing_allocations USING btree (billing_document_id);


--
-- Name: tax_deposit_accounts_business_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tax_deposit_accounts_business_idx ON public.tax_deposit_accounts USING btree (business_id);


--
-- Name: tax_deposit_alloc_acct_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tax_deposit_alloc_acct_idx ON public.tax_deposit_allocations USING btree (deposit_account_id);


--
-- Name: tax_deposit_entries_acct_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tax_deposit_entries_acct_idx ON public.tax_deposit_entries USING btree (deposit_account_id, entry_type);


--
-- Name: tax_rule_reviews_one_approved; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tax_rule_reviews_one_approved ON public.tax_rule_reviews USING btree (tax_rule_id, rule_version) WHERE (review_status = 'approved'::text);


--
-- Name: tax_rule_reviews_rule_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tax_rule_reviews_rule_idx ON public.tax_rule_reviews USING btree (tax_rule_id, rule_version);


--
-- Name: tax_rule_reviews_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tax_rule_reviews_status_idx ON public.tax_rule_reviews USING btree (review_status);


--
-- Name: tax_rules_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tax_rules_code_idx ON public.tax_rules USING btree (rule_code, version);


--
-- Name: tax_rules_code_version_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tax_rules_code_version_uniq ON public.tax_rules USING btree (rule_code, version);


--
-- Name: tax_rules_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tax_rules_lookup_idx ON public.tax_rules USING btree (jurisdiction, status);


--
-- Name: tax_treatments_business_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tax_treatments_business_idx ON public.tax_treatments USING btree (business_id, treatment_status);


--
-- Name: tax_treatments_debt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tax_treatments_debt_idx ON public.tax_treatments USING btree (debt_id);


--
-- Name: transactions_business_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX transactions_business_id_idx ON public.transactions USING btree (business_id);


--
-- Name: user_channel_links_active_external_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_channel_links_active_external_uidx ON public.user_channel_links USING btree (channel, external_user_id) WHERE (revoked_at IS NULL);


--
-- Name: user_channel_links_active_user_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_channel_links_active_user_uidx ON public.user_channel_links USING btree (channel, user_id) WHERE (revoked_at IS NULL);


--
-- Name: user_channel_links_user_channel_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_channel_links_user_channel_idx ON public.user_channel_links USING btree (user_id, channel);


--
-- Name: user_email_identities_email_lower_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_email_identities_email_lower_uidx ON public.user_email_identities USING btree (lower(email));


--
-- Name: wallets_business_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wallets_business_id_idx ON public.wallets USING btree (business_id);


--
-- Name: wht_alloc_record_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wht_alloc_record_idx ON public.withholding_payment_allocations USING btree (withholding_record_id);


--
-- Name: withholding_records_business_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX withholding_records_business_idx ON public.withholding_records USING btree (business_id, status);


--
-- Name: withholding_records_debt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX withholding_records_debt_idx ON public.withholding_records USING btree (debt_id);


--
-- Name: access_audit access_audit_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER access_audit_append_only BEFORE DELETE OR UPDATE ON public.access_audit FOR EACH ROW EXECUTE FUNCTION public.fn_access_audit_no_mutate();


--
-- Name: audit_events audit_events_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_events_append_only BEFORE DELETE OR UPDATE ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.audit_events_no_mutate();


--
-- Name: document_audit document_audit_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER document_audit_append_only BEFORE DELETE OR UPDATE ON public.document_audit FOR EACH ROW EXECUTE FUNCTION public.fn_document_audit_no_mutate();


--
-- Name: business_members trg_bmng_reset_on_membership; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bmng_reset_on_membership AFTER INSERT OR UPDATE OF role, status ON public.business_members FOR EACH ROW EXECUTE FUNCTION public.fn_bmng_reset_grants_on_membership_change();


--
-- Name: business_member_notification_grants trg_bmng_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bmng_updated_at BEFORE UPDATE ON public.business_member_notification_grants FOR EACH ROW EXECUTE FUNCTION public.fn_business_member_notification_grants_updated_at();


--
-- Name: businesses trg_business_code_default; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_business_code_default BEFORE INSERT ON public.businesses FOR EACH ROW EXECUTE FUNCTION public.fn_business_code_default();


--
-- Name: businesses trg_business_code_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_business_code_immutable BEFORE UPDATE ON public.businesses FOR EACH ROW EXECUTE FUNCTION public.fn_business_code_immutable();


--
-- Name: debt_settlement_allocations trg_debt_settlement_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_debt_settlement_guard BEFORE INSERT OR UPDATE ON public.debt_settlement_allocations FOR EACH ROW EXECUTE FUNCTION public.fn_debt_settlement_guard();


--
-- Name: intercompany_funding_records trg_ic_funding_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ic_funding_guard BEFORE INSERT OR UPDATE ON public.intercompany_funding_records FOR EACH ROW EXECUTE FUNCTION public.fn_ic_funding_guard();


--
-- Name: intercompany_settlement_allocations trg_ic_settlement_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ic_settlement_guard BEFORE INSERT OR UPDATE ON public.intercompany_settlement_allocations FOR EACH ROW EXECUTE FUNCTION public.fn_ic_settlement_guard();


--
-- Name: incoming_payment_match_candidates trg_incoming_payment_candidate_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_incoming_payment_candidate_guard BEFORE INSERT OR UPDATE ON public.incoming_payment_match_candidates FOR EACH ROW EXECUTE FUNCTION public.fn_incoming_payment_candidate_guard();


--
-- Name: incoming_payments trg_incoming_payments_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_incoming_payments_updated_at BEFORE UPDATE ON public.incoming_payments FOR EACH ROW EXECUTE FUNCTION public.fn_incoming_payments_updated_at();


--
-- Name: assets trg_iso_assets; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_iso_assets BEFORE INSERT OR UPDATE ON public.assets FOR EACH ROW EXECUTE FUNCTION public.fn_iso_assets();


--
-- Name: bank_import_batches trg_iso_bank_import_batch_doc; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_iso_bank_import_batch_doc BEFORE INSERT OR UPDATE ON public.bank_import_batches FOR EACH ROW EXECUTE FUNCTION public.fn_iso_bank_import_batch_document();


--
-- Name: business_funding_records trg_iso_business_funding_records; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_iso_business_funding_records BEFORE INSERT OR UPDATE ON public.business_funding_records FOR EACH ROW EXECUTE FUNCTION public.fn_iso_business_funding_records();


--
-- Name: business_funding_repayments trg_iso_business_funding_repayments; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_iso_business_funding_repayments BEFORE INSERT OR UPDATE ON public.business_funding_repayments FOR EACH ROW EXECUTE FUNCTION public.fn_iso_business_funding_repayments();


--
-- Name: counterparty_bank_accounts trg_iso_cp_bank_accounts; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_iso_cp_bank_accounts BEFORE INSERT OR UPDATE ON public.counterparty_bank_accounts FOR EACH ROW EXECUTE FUNCTION public.fn_iso_counterparty_bank_accounts();


--
-- Name: document_compliance_links trg_iso_doc_comp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_iso_doc_comp BEFORE INSERT OR UPDATE ON public.document_compliance_links FOR EACH ROW EXECUTE FUNCTION public.fn_iso_doc_comp_links();


--
-- Name: document_debt_links trg_iso_doc_debt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_iso_doc_debt BEFORE INSERT OR UPDATE ON public.document_debt_links FOR EACH ROW EXECUTE FUNCTION public.fn_iso_doc_debt_links();


--
-- Name: document_transaction_links trg_iso_doc_tx; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_iso_doc_tx BEFORE INSERT OR UPDATE ON public.document_transaction_links FOR EACH ROW EXECUTE FUNCTION public.fn_iso_doc_tx_links();


--
-- Name: document_links trg_iso_document_links; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_iso_document_links BEFORE INSERT OR UPDATE ON public.document_links FOR EACH ROW EXECUTE FUNCTION public.fn_iso_document_links();


--
-- Name: financial_documents trg_iso_fin_docs; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_iso_fin_docs BEFORE INSERT OR UPDATE ON public.financial_documents FOR EACH ROW EXECUTE FUNCTION public.fn_iso_financial_documents();


--
-- Name: tax_treatments trg_iso_treatment; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_iso_treatment BEFORE INSERT OR UPDATE ON public.tax_treatments FOR EACH ROW EXECUTE FUNCTION public.fn_iso_tax_treatments();


--
-- Name: withholding_records trg_iso_withholding; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_iso_withholding BEFORE INSERT OR UPDATE ON public.withholding_records FOR EACH ROW EXECUTE FUNCTION public.fn_iso_withholding();


--
-- Name: onboarding_flows trg_onboarding_flows_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_onboarding_flows_updated_at BEFORE UPDATE ON public.onboarding_flows FOR EACH ROW EXECUTE FUNCTION public.fn_onboarding_touch_updated_at();


--
-- Name: onboarding_progress trg_onboarding_progress_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_onboarding_progress_updated_at BEFORE UPDATE ON public.onboarding_progress FOR EACH ROW EXECUTE FUNCTION public.fn_onboarding_touch_updated_at();


--
-- Name: onboarding_step_progress trg_onboarding_step_progress_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_onboarding_step_progress_updated_at BEFORE UPDATE ON public.onboarding_step_progress FOR EACH ROW EXECUTE FUNCTION public.fn_onboarding_touch_updated_at();


--
-- Name: onboarding_steps trg_onboarding_steps_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_onboarding_steps_updated_at BEFORE UPDATE ON public.onboarding_steps FOR EACH ROW EXECUTE FUNCTION public.fn_onboarding_touch_updated_at();


--
-- Name: payment_provider_credentials trg_payment_credential_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_payment_credential_guard BEFORE INSERT OR UPDATE ON public.payment_provider_credentials FOR EACH ROW EXECUTE FUNCTION public.fn_payment_credential_guard();


--
-- Name: payment_provider_connections trg_payment_provider_connections_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_payment_provider_connections_updated_at BEFORE UPDATE ON public.payment_provider_connections FOR EACH ROW EXECUTE FUNCTION public.fn_payment_provider_connections_updated_at();


--
-- Name: business_members trg_personal_v1_owner_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_personal_v1_owner_only BEFORE INSERT OR UPDATE ON public.business_members FOR EACH ROW EXECUTE FUNCTION public.fn_personal_v1_owner_only_membership();


--
-- Name: support_conversations trg_support_conversation_created_event; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_support_conversation_created_event AFTER INSERT ON public.support_conversations FOR EACH ROW EXECUTE FUNCTION public.fn_support_conversation_created_event();


--
-- Name: support_conversations trg_support_conversations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_support_conversations_updated_at BEFORE UPDATE ON public.support_conversations FOR EACH ROW EXECUTE FUNCTION public.fn_support_conversations_updated_at();


--
-- Name: support_messages trg_support_message_touch_conversation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_support_message_touch_conversation AFTER INSERT ON public.support_messages FOR EACH ROW EXECUTE FUNCTION public.fn_support_message_touch_conversation();


--
-- Name: tax_billing_allocations trg_tax_billing_alloc_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tax_billing_alloc_guard BEFORE INSERT OR UPDATE ON public.tax_billing_allocations FOR EACH ROW EXECUTE FUNCTION public.fn_tax_billing_alloc_guard();


--
-- Name: tax_deposit_allocations trg_tax_deposit_alloc_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tax_deposit_alloc_guard BEFORE INSERT OR UPDATE ON public.tax_deposit_allocations FOR EACH ROW EXECUTE FUNCTION public.fn_tax_deposit_alloc_guard();


--
-- Name: telegram_user_state trg_telegram_user_state_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_telegram_user_state_updated_at BEFORE UPDATE ON public.telegram_user_state FOR EACH ROW EXECUTE FUNCTION public.fn_telegram_user_state_set_updated_at();


--
-- Name: user_email_identities trg_uei_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_uei_updated_at BEFORE UPDATE ON public.user_email_identities FOR EACH ROW EXECUTE FUNCTION public.fn_email_identity_set_updated_at();


--
-- Name: user_channel_state trg_user_channel_state_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_user_channel_state_updated_at BEFORE UPDATE ON public.user_channel_state FOR EACH ROW EXECUTE FUNCTION public.fn_user_channel_state_set_updated_at();


--
-- Name: user_profiles trg_user_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_user_profiles_updated_at BEFORE UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION public.fn_email_identity_set_updated_at();


--
-- Name: withholding_payment_allocations trg_wht_payment_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_wht_payment_guard BEFORE INSERT OR UPDATE ON public.withholding_payment_allocations FOR EACH ROW EXECUTE FUNCTION public.fn_wht_payment_guard();


--
-- Name: access_audit access_audit_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_audit
    ADD CONSTRAINT access_audit_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;


--
-- Name: accounts accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: activity_types activity_types_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_types
    ADD CONSTRAINT activity_types_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id);


--
-- Name: ai_usage_events ai_usage_events_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_events
    ADD CONSTRAINT ai_usage_events_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;


--
-- Name: assets assets_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;


--
-- Name: assets assets_depreciation_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_depreciation_rule_id_fkey FOREIGN KEY (depreciation_rule_id) REFERENCES public.tax_rules(id) ON DELETE RESTRICT;


--
-- Name: assets assets_purchase_debt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_purchase_debt_id_fkey FOREIGN KEY (purchase_debt_id) REFERENCES public.debts(id) ON DELETE RESTRICT;


--
-- Name: assets assets_purchase_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_purchase_document_id_fkey FOREIGN KEY (purchase_document_id) REFERENCES public.financial_documents(id) ON DELETE RESTRICT;


--
-- Name: assets assets_purchase_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_purchase_transaction_id_fkey FOREIGN KEY (purchase_transaction_id) REFERENCES public.transactions(id) ON DELETE RESTRICT;


--
-- Name: assets assets_supplier_counterparty_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_supplier_counterparty_id_fkey FOREIGN KEY (supplier_counterparty_id) REFERENCES public.counterparties(id) ON DELETE RESTRICT;


--
-- Name: audit_events audit_events_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;


--
-- Name: bank_import_batches bank_import_batches_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_import_batches
    ADD CONSTRAINT bank_import_batches_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;


--
-- Name: bank_import_batches bank_import_batches_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_import_batches
    ADD CONSTRAINT bank_import_batches_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.financial_documents(id) ON DELETE SET NULL;


--
-- Name: bank_import_batches bank_import_batches_wallet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_import_batches
    ADD CONSTRAINT bank_import_batches_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES public.wallets(id);


--
-- Name: bank_import_matches bank_import_matches_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_import_matches
    ADD CONSTRAINT bank_import_matches_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.bank_import_batches(id) ON DELETE CASCADE;


--
-- Name: bank_import_matches bank_import_matches_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_import_matches
    ADD CONSTRAINT bank_import_matches_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;


--
-- Name: bank_import_matches bank_import_matches_row_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_import_matches
    ADD CONSTRAINT bank_import_matches_row_id_fkey FOREIGN KEY (row_id) REFERENCES public.bank_import_rows(id) ON DELETE CASCADE;


--
-- Name: bank_import_rows bank_import_rows_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_import_rows
    ADD CONSTRAINT bank_import_rows_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.bank_import_batches(id) ON DELETE CASCADE;


--
-- Name: bank_import_rows bank_import_rows_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_import_rows
    ADD CONSTRAINT bank_import_rows_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;


--
-- Name: bank_import_rows bank_import_rows_final_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_import_rows
    ADD CONSTRAINT bank_import_rows_final_category_id_fkey FOREIGN KEY (final_category_id) REFERENCES public.cashflow_categories(id);


--
-- Name: bank_import_rows bank_import_rows_final_counterparty_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_import_rows
    ADD CONSTRAINT bank_import_rows_final_counterparty_id_fkey FOREIGN KEY (final_counterparty_id) REFERENCES public.counterparties(id);


--
-- Name: bank_import_rows bank_import_rows_suggested_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_import_rows
    ADD CONSTRAINT bank_import_rows_suggested_category_id_fkey FOREIGN KEY (suggested_category_id) REFERENCES public.cashflow_categories(id);


--
-- Name: bank_import_rows bank_import_rows_suggested_counterparty_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_import_rows
    ADD CONSTRAINT bank_import_rows_suggested_counterparty_id_fkey FOREIGN KEY (suggested_counterparty_id) REFERENCES public.counterparties(id);


--
-- Name: bank_reconciliations bank_reconciliations_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_reconciliations
    ADD CONSTRAINT bank_reconciliations_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.bank_import_batches(id) ON DELETE CASCADE;


--
-- Name: bank_reconciliations bank_reconciliations_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_reconciliations
    ADD CONSTRAINT bank_reconciliations_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;


--
-- Name: bank_reconciliations bank_reconciliations_wallet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_reconciliations
    ADD CONSTRAINT bank_reconciliations_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES public.wallets(id);


--
-- Name: business_addons business_addons_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_addons
    ADD CONSTRAINT business_addons_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;


--
-- Name: business_directions business_directions_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_directions
    ADD CONSTRAINT business_directions_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id);


--
-- Name: business_funding_records business_funding_records_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_funding_records
    ADD CONSTRAINT business_funding_records_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;


--
-- Name: business_funding_records business_funding_records_counterparty_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_funding_records
    ADD CONSTRAINT business_funding_records_counterparty_id_fkey FOREIGN KEY (counterparty_id) REFERENCES public.counterparties(id) ON DELETE RESTRICT;


--
-- Name: business_funding_records business_funding_records_received_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_funding_records
    ADD CONSTRAINT business_funding_records_received_transaction_id_fkey FOREIGN KEY (received_transaction_id) REFERENCES public.transactions(id) ON DELETE RESTRICT;


--
-- Name: business_funding_repayments business_funding_repayments_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_funding_repayments
    ADD CONSTRAINT business_funding_repayments_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;


--
-- Name: business_funding_repayments business_funding_repayments_funding_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_funding_repayments
    ADD CONSTRAINT business_funding_repayments_funding_record_id_fkey FOREIGN KEY (funding_record_id) REFERENCES public.business_funding_records(id) ON DELETE RESTRICT;


--
-- Name: business_funding_repayments business_funding_repayments_paid_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_funding_repayments
    ADD CONSTRAINT business_funding_repayments_paid_transaction_id_fkey FOREIGN KEY (paid_transaction_id) REFERENCES public.transactions(id) ON DELETE RESTRICT;


--
-- Name: business_invites business_invites_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_invites
    ADD CONSTRAINT business_invites_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;


--
-- Name: business_member_notification_grants business_member_notification_grants_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_member_notification_grants
    ADD CONSTRAINT business_member_notification_grants_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;


--
-- Name: business_member_notification_grants business_member_notification_grants_granted_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_member_notification_grants
    ADD CONSTRAINT business_member_notification_grants_granted_by_user_id_fkey FOREIGN KEY (granted_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: business_member_notification_grants business_member_notification_grants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_member_notification_grants
    ADD CONSTRAINT business_member_notification_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: business_members business_members_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_members
    ADD CONSTRAINT business_members_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;


--
-- Name: business_members business_members_invited_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_members
    ADD CONSTRAINT business_members_invited_by_user_id_fkey FOREIGN KEY (invited_by_user_id) REFERENCES public.users(id);


--
-- Name: business_members business_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_members
    ADD CONSTRAINT business_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: business_relationships business_relationships_from_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_relationships
    ADD CONSTRAINT business_relationships_from_business_id_fkey FOREIGN KEY (from_business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;


--
-- Name: business_relationships business_relationships_to_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_relationships
    ADD CONSTRAINT business_relationships_to_business_id_fkey FOREIGN KEY (to_business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;


--
-- Name: businesses businesses_override_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.businesses
    ADD CONSTRAINT businesses_override_created_by_user_id_fkey FOREIGN KEY (override_created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: businesses businesses_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.businesses
    ADD CONSTRAINT businesses_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: cashflow_categories cashflow_categories_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cashflow_categories
    ADD CONSTRAINT cashflow_categories_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id);


--
-- Name: categories categories_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: channel_link_tokens channel_link_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_link_tokens
    ADD CONSTRAINT channel_link_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: classification_feedback classification_feedback_bank_import_row_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classification_feedback
    ADD CONSTRAINT classification_feedback_bank_import_row_id_fkey FOREIGN KEY (bank_import_row_id) REFERENCES public.bank_import_rows(id) ON DELETE SET NULL;


--
-- Name: classification_feedback classification_feedback_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classification_feedback
    ADD CONSTRAINT classification_feedback_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;


--
-- Name: classification_feedback classification_feedback_final_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classification_feedback
    ADD CONSTRAINT classification_feedback_final_category_id_fkey FOREIGN KEY (final_category_id) REFERENCES public.cashflow_categories(id);


--
-- Name: classification_feedback classification_feedback_suggested_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classification_feedback
    ADD CONSTRAINT classification_feedback_suggested_category_id_fkey FOREIGN KEY (suggested_category_id) REFERENCES public.cashflow_categories(id);


--
-- Name: classification_rules classification_rules_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classification_rules
    ADD CONSTRAINT classification_rules_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;


--
-- Name: classification_rules classification_rules_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classification_rules
    ADD CONSTRAINT classification_rules_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.cashflow_categories(id);


--
-- Name: classification_rules classification_rules_counterparty_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classification_rules
    ADD CONSTRAINT classification_rules_counterparty_id_fkey FOREIGN KEY (counterparty_id) REFERENCES public.counterparties(id);


--
-- Name: compliance_events compliance_events_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_events
    ADD CONSTRAINT compliance_events_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;


--
-- Name: compliance_events compliance_events_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_events
    ADD CONSTRAINT compliance_events_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.tax_rules(id);


--
-- Name: counterparties counterparties_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.counterparties
    ADD CONSTRAINT counterparties_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id);


--
-- Name: counterparty_bank_accounts counterparty_bank_accounts_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.counterparty_bank_accounts
    ADD CONSTRAINT counterparty_bank_accounts_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;


--
-- Name: counterparty_bank_accounts counterparty_bank_accounts_counterparty_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.counterparty_bank_accounts
    ADD CONSTRAINT counterparty_bank_accounts_counterparty_id_fkey FOREIGN KEY (counterparty_id) REFERENCES public.counterparties(id) ON DELETE CASCADE;


--
-- Name: debt_payment_idempotency debt_payment_idempotency_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.debt_payment_idempotency
    ADD CONSTRAINT debt_payment_idempotency_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;


--
-- Name: debt_payment_idempotency debt_payment_idempotency_debt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.debt_payment_idempotency
    ADD CONSTRAINT debt_payment_idempotency_debt_id_fkey FOREIGN KEY (debt_id) REFERENCES public.debts(id) ON DELETE CASCADE;


--
-- Name: debt_payment_idempotency debt_payment_idempotency_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.debt_payment_idempotency
    ADD CONSTRAINT debt_payment_idempotency_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE SET NULL;


--
-- Name: debt_settlement_allocations debt_settlement_allocations_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.debt_settlement_allocations
    ADD CONSTRAINT debt_settlement_allocations_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;


--
-- Name: debt_settlement_allocations debt_settlement_allocations_credit_note_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.debt_settlement_allocations
    ADD CONSTRAINT debt_settlement_allocations_credit_note_document_id_fkey FOREIGN KEY (credit_note_document_id) REFERENCES public.financial_documents(id) ON DELETE RESTRICT;


--
-- Name: debt_settlement_allocations debt_settlement_allocations_debt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.debt_settlement_allocations
    ADD CONSTRAINT debt_settlement_allocations_debt_id_fkey FOREIGN KEY (debt_id) REFERENCES public.debts(id) ON DELETE RESTRICT;


--
-- Name: debt_settlement_allocations debt_settlement_allocations_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.debt_settlement_allocations
    ADD CONSTRAINT debt_settlement_allocations_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE RESTRICT;


--
-- Name: debt_settlement_allocations debt_settlement_allocations_withholding_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.debt_settlement_allocations
    ADD CONSTRAINT debt_settlement_allocations_withholding_record_id_fkey FOREIGN KEY (withholding_record_id) REFERENCES public.withholding_records(id) ON DELETE RESTRICT;


--
-- Name: debts debts_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.debts
    ADD CONSTRAINT debts_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id);


--
-- Name: debts debts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.debts
    ADD CONSTRAINT debts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: document_audit document_audit_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_audit
    ADD CONSTRAINT document_audit_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;


--
-- Name: document_audit document_audit_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_audit
    ADD CONSTRAINT document_audit_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.financial_documents(id) ON DELETE SET NULL;


--
-- Name: document_compliance_links document_compliance_links_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_compliance_links
    ADD CONSTRAINT document_compliance_links_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;


--
-- Name: document_compliance_links document_compliance_links_compliance_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_compliance_links
    ADD CONSTRAINT document_compliance_links_compliance_event_id_fkey FOREIGN KEY (compliance_event_id) REFERENCES public.compliance_events(id) ON DELETE RESTRICT;


--
-- Name: document_compliance_links document_compliance_links_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_compliance_links
    ADD CONSTRAINT document_compliance_links_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.financial_documents(id) ON DELETE CASCADE;


--
-- Name: document_debt_links document_debt_links_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_debt_links
    ADD CONSTRAINT document_debt_links_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;


--
-- Name: document_debt_links document_debt_links_debt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_debt_links
    ADD CONSTRAINT document_debt_links_debt_id_fkey FOREIGN KEY (debt_id) REFERENCES public.debts(id) ON DELETE RESTRICT;


--
-- Name: document_debt_links document_debt_links_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_debt_links
    ADD CONSTRAINT document_debt_links_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.financial_documents(id) ON DELETE CASCADE;


--
-- Name: document_files document_files_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_files
    ADD CONSTRAINT document_files_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;


--
-- Name: document_links document_links_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_links
    ADD CONSTRAINT document_links_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;


--
-- Name: document_links document_links_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_links
    ADD CONSTRAINT document_links_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.financial_documents(id) ON DELETE CASCADE;


--
-- Name: document_links document_links_target_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_links
    ADD CONSTRAINT document_links_target_document_id_fkey FOREIGN KEY (target_document_id) REFERENCES public.financial_documents(id) ON DELETE CASCADE;


--
-- Name: document_transaction_links document_transaction_links_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_transaction_links
    ADD CONSTRAINT document_transaction_links_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;


--
-- Name: document_transaction_links document_transaction_links_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_transaction_links
    ADD CONSTRAINT document_transaction_links_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.financial_documents(id) ON DELETE CASCADE;


--
-- Name: document_transaction_links document_transaction_links_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_transaction_links
    ADD CONSTRAINT document_transaction_links_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE RESTRICT;


--
-- Name: email_login_codes email_login_codes_consumed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_login_codes
    ADD CONSTRAINT email_login_codes_consumed_by_user_id_fkey FOREIGN KEY (consumed_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: financial_documents financial_documents_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_documents
    ADD CONSTRAINT financial_documents_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;


--
-- Name: financial_documents financial_documents_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_documents
    ADD CONSTRAINT financial_documents_file_id_fkey FOREIGN KEY (file_id) REFERENCES public.document_files(id) ON DELETE RESTRICT;


--
-- Name: financial_documents financial_documents_issuer_counterparty_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_documents
    ADD CONSTRAINT financial_documents_issuer_counterparty_id_fkey FOREIGN KEY (issuer_counterparty_id) REFERENCES public.counterparties(id) ON DELETE RESTRICT;


--
-- Name: financial_documents financial_documents_recipient_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_documents
    ADD CONSTRAINT financial_documents_recipient_business_id_fkey FOREIGN KEY (recipient_business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;


--
-- Name: incoming_payment_match_candidates incoming_payment_match_candidates_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incoming_payment_match_candidates
    ADD CONSTRAINT incoming_payment_match_candidates_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;


--
-- Name: incoming_payment_match_candidates incoming_payment_match_candidates_incoming_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incoming_payment_match_candidates
    ADD CONSTRAINT incoming_payment_match_candidates_incoming_payment_id_fkey FOREIGN KEY (incoming_payment_id) REFERENCES public.incoming_payments(id) ON DELETE CASCADE;


--
-- Name: incoming_payment_match_candidates incoming_payment_match_candidates_target_debt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incoming_payment_match_candidates
    ADD CONSTRAINT incoming_payment_match_candidates_target_debt_id_fkey FOREIGN KEY (target_debt_id) REFERENCES public.debts(id) ON DELETE CASCADE;


--
-- Name: incoming_payment_match_candidates incoming_payment_match_candidates_target_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incoming_payment_match_candidates
    ADD CONSTRAINT incoming_payment_match_candidates_target_transaction_id_fkey FOREIGN KEY (target_transaction_id) REFERENCES public.transactions(id) ON DELETE CASCADE;


--
-- Name: incoming_payments incoming_payments_bank_import_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incoming_payments
    ADD CONSTRAINT incoming_payments_bank_import_batch_id_fkey FOREIGN KEY (bank_import_batch_id) REFERENCES public.bank_import_batches(id) ON DELETE SET NULL;


--
-- Name: incoming_payments incoming_payments_bank_import_row_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incoming_payments
    ADD CONSTRAINT incoming_payments_bank_import_row_id_fkey FOREIGN KEY (bank_import_row_id) REFERENCES public.bank_import_rows(id) ON DELETE SET NULL;


--
-- Name: incoming_payments incoming_payments_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incoming_payments
    ADD CONSTRAINT incoming_payments_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;


--
-- Name: incoming_payments incoming_payments_linked_debt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incoming_payments
    ADD CONSTRAINT incoming_payments_linked_debt_id_fkey FOREIGN KEY (linked_debt_id) REFERENCES public.debts(id) ON DELETE SET NULL;


--
-- Name: incoming_payments incoming_payments_linked_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incoming_payments
    ADD CONSTRAINT incoming_payments_linked_transaction_id_fkey FOREIGN KEY (linked_transaction_id) REFERENCES public.transactions(id) ON DELETE SET NULL;


--
-- Name: incoming_payments incoming_payments_wallet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incoming_payments
    ADD CONSTRAINT incoming_payments_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES public.wallets(id) ON DELETE SET NULL;


--
-- Name: intercompany_funding_records intercompany_funding_records_cash_payer_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intercompany_funding_records
    ADD CONSTRAINT intercompany_funding_records_cash_payer_business_id_fkey FOREIGN KEY (cash_payer_business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;


--
-- Name: intercompany_funding_records intercompany_funding_records_economic_owner_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intercompany_funding_records
    ADD CONSTRAINT intercompany_funding_records_economic_owner_business_id_fkey FOREIGN KEY (economic_owner_business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;


--
-- Name: intercompany_funding_records intercompany_funding_records_funded_compliance_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intercompany_funding_records
    ADD CONSTRAINT intercompany_funding_records_funded_compliance_event_id_fkey FOREIGN KEY (funded_compliance_event_id) REFERENCES public.compliance_events(id) ON DELETE RESTRICT;


--
-- Name: intercompany_funding_records intercompany_funding_records_funded_debt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intercompany_funding_records
    ADD CONSTRAINT intercompany_funding_records_funded_debt_id_fkey FOREIGN KEY (funded_debt_id) REFERENCES public.debts(id) ON DELETE RESTRICT;


--
-- Name: intercompany_funding_records intercompany_funding_records_funded_tax_treatment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intercompany_funding_records
    ADD CONSTRAINT intercompany_funding_records_funded_tax_treatment_id_fkey FOREIGN KEY (funded_tax_treatment_id) REFERENCES public.tax_treatments(id) ON DELETE RESTRICT;


--
-- Name: intercompany_funding_records intercompany_funding_records_funded_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intercompany_funding_records
    ADD CONSTRAINT intercompany_funding_records_funded_transaction_id_fkey FOREIGN KEY (funded_transaction_id) REFERENCES public.transactions(id) ON DELETE RESTRICT;


--
-- Name: intercompany_funding_records intercompany_funding_records_relationship_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intercompany_funding_records
    ADD CONSTRAINT intercompany_funding_records_relationship_id_fkey FOREIGN KEY (relationship_id) REFERENCES public.business_relationships(id) ON DELETE RESTRICT;


--
-- Name: intercompany_settlement_allocations intercompany_settlement_allocatio_business_relationship_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intercompany_settlement_allocations
    ADD CONSTRAINT intercompany_settlement_allocatio_business_relationship_id_fkey FOREIGN KEY (business_relationship_id) REFERENCES public.business_relationships(id) ON DELETE RESTRICT;


--
-- Name: intercompany_settlement_allocations intercompany_settlement_allocatio_repayment_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intercompany_settlement_allocations
    ADD CONSTRAINT intercompany_settlement_allocatio_repayment_transaction_id_fkey FOREIGN KEY (repayment_transaction_id) REFERENCES public.transactions(id) ON DELETE RESTRICT;


--
-- Name: intercompany_settlement_allocations intercompany_settlement_allocations_funding_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intercompany_settlement_allocations
    ADD CONSTRAINT intercompany_settlement_allocations_funding_record_id_fkey FOREIGN KEY (funding_record_id) REFERENCES public.intercompany_funding_records(id) ON DELETE RESTRICT;


--
-- Name: mcp_oauth_codes mcp_oauth_codes_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_oauth_codes
    ADD CONSTRAINT mcp_oauth_codes_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.mcp_oauth_clients(client_id) ON DELETE CASCADE;


--
-- Name: mcp_oauth_codes mcp_oauth_codes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_oauth_codes
    ADD CONSTRAINT mcp_oauth_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: mcp_oauth_requests mcp_oauth_requests_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_oauth_requests
    ADD CONSTRAINT mcp_oauth_requests_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.mcp_oauth_clients(client_id) ON DELETE CASCADE;


--
-- Name: mcp_oauth_requests mcp_oauth_requests_decided_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_oauth_requests
    ADD CONSTRAINT mcp_oauth_requests_decided_by_user_id_fkey FOREIGN KEY (decided_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: mcp_oauth_tokens mcp_oauth_tokens_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_oauth_tokens
    ADD CONSTRAINT mcp_oauth_tokens_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.mcp_oauth_clients(client_id) ON DELETE CASCADE;


--
-- Name: mcp_oauth_tokens mcp_oauth_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_oauth_tokens
    ADD CONSTRAINT mcp_oauth_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: onboarding_context_snapshots onboarding_context_snapshots_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_context_snapshots
    ADD CONSTRAINT onboarding_context_snapshots_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;


--
-- Name: onboarding_context_snapshots onboarding_context_snapshots_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_context_snapshots
    ADD CONSTRAINT onboarding_context_snapshots_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: onboarding_events onboarding_events_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_events
    ADD CONSTRAINT onboarding_events_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;


--
-- Name: onboarding_events onboarding_events_flow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_events
    ADD CONSTRAINT onboarding_events_flow_id_fkey FOREIGN KEY (flow_id) REFERENCES public.onboarding_flows(id) ON DELETE CASCADE;


--
-- Name: onboarding_events onboarding_events_step_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_events
    ADD CONSTRAINT onboarding_events_step_id_fkey FOREIGN KEY (step_id) REFERENCES public.onboarding_steps(id) ON DELETE CASCADE;


--
-- Name: onboarding_events onboarding_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_events
    ADD CONSTRAINT onboarding_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: onboarding_progress onboarding_progress_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_progress
    ADD CONSTRAINT onboarding_progress_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;


--
-- Name: onboarding_progress onboarding_progress_current_step_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_progress
    ADD CONSTRAINT onboarding_progress_current_step_id_fkey FOREIGN KEY (current_step_id) REFERENCES public.onboarding_steps(id) ON DELETE SET NULL;


--
-- Name: onboarding_progress onboarding_progress_flow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_progress
    ADD CONSTRAINT onboarding_progress_flow_id_fkey FOREIGN KEY (flow_id) REFERENCES public.onboarding_flows(id) ON DELETE CASCADE;


--
-- Name: onboarding_progress onboarding_progress_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_progress
    ADD CONSTRAINT onboarding_progress_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: onboarding_step_progress onboarding_step_progress_progress_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_step_progress
    ADD CONSTRAINT onboarding_step_progress_progress_id_fkey FOREIGN KEY (progress_id) REFERENCES public.onboarding_progress(id) ON DELETE CASCADE;


--
-- Name: onboarding_step_progress onboarding_step_progress_step_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_step_progress
    ADD CONSTRAINT onboarding_step_progress_step_id_fkey FOREIGN KEY (step_id) REFERENCES public.onboarding_steps(id) ON DELETE CASCADE;


--
-- Name: onboarding_steps onboarding_steps_flow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_steps
    ADD CONSTRAINT onboarding_steps_flow_id_fkey FOREIGN KEY (flow_id) REFERENCES public.onboarding_flows(id) ON DELETE CASCADE;


--
-- Name: payment_provider_connections payment_provider_connections_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_provider_connections
    ADD CONSTRAINT payment_provider_connections_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;


--
-- Name: payment_provider_connections payment_provider_connections_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_provider_connections
    ADD CONSTRAINT payment_provider_connections_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: payment_provider_connections payment_provider_connections_linked_wallet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_provider_connections
    ADD CONSTRAINT payment_provider_connections_linked_wallet_id_fkey FOREIGN KEY (linked_wallet_id) REFERENCES public.wallets(id) ON DELETE SET NULL;


--
-- Name: payment_provider_credentials payment_provider_credentials_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_provider_credentials
    ADD CONSTRAINT payment_provider_credentials_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;


--
-- Name: payment_provider_credentials payment_provider_credentials_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_provider_credentials
    ADD CONSTRAINT payment_provider_credentials_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.payment_provider_connections(id) ON DELETE CASCADE;


--
-- Name: payment_provider_credentials payment_provider_credentials_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_provider_credentials
    ADD CONSTRAINT payment_provider_credentials_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: payment_provider_credentials payment_provider_credentials_revoked_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_provider_credentials
    ADD CONSTRAINT payment_provider_credentials_revoked_by_user_id_fkey FOREIGN KEY (revoked_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: payroll_employees payroll_employees_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_employees
    ADD CONSTRAINT payroll_employees_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id);


--
-- Name: payroll_employees payroll_employees_default_wallet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_employees
    ADD CONSTRAINT payroll_employees_default_wallet_id_fkey FOREIGN KEY (default_wallet_id) REFERENCES public.wallets(id);


--
-- Name: payroll_employees payroll_employees_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_employees
    ADD CONSTRAINT payroll_employees_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: payroll_payment_items payroll_payment_items_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_payment_items
    ADD CONSTRAINT payroll_payment_items_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id);


--
-- Name: payroll_payment_items payroll_payment_items_payroll_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_payment_items
    ADD CONSTRAINT payroll_payment_items_payroll_payment_id_fkey FOREIGN KEY (payroll_payment_id) REFERENCES public.payroll_payments(id) ON DELETE CASCADE;


--
-- Name: payroll_payment_items payroll_payment_items_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_payment_items
    ADD CONSTRAINT payroll_payment_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: payroll_payments payroll_payments_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_payments
    ADD CONSTRAINT payroll_payments_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id);


--
-- Name: payroll_payments payroll_payments_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_payments
    ADD CONSTRAINT payroll_payments_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.payroll_employees(id);


--
-- Name: payroll_payments payroll_payments_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_payments
    ADD CONSTRAINT payroll_payments_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id);


--
-- Name: payroll_payments payroll_payments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_payments
    ADD CONSTRAINT payroll_payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: payroll_payments payroll_payments_wallet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_payments
    ADD CONSTRAINT payroll_payments_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES public.wallets(id);


--
-- Name: reminders reminders_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminders
    ADD CONSTRAINT reminders_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id);


--
-- Name: reminders reminders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminders
    ADD CONSTRAINT reminders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: support_conversations support_conversations_assigned_to_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_conversations
    ADD CONSTRAINT support_conversations_assigned_to_user_id_fkey FOREIGN KEY (assigned_to_user_id) REFERENCES public.users(id);


--
-- Name: support_conversations support_conversations_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_conversations
    ADD CONSTRAINT support_conversations_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;


--
-- Name: support_conversations support_conversations_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_conversations
    ADD CONSTRAINT support_conversations_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);


--
-- Name: support_escalations support_escalations_assigned_to_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_escalations
    ADD CONSTRAINT support_escalations_assigned_to_user_id_fkey FOREIGN KEY (assigned_to_user_id) REFERENCES public.users(id);


--
-- Name: support_escalations support_escalations_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_escalations
    ADD CONSTRAINT support_escalations_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;


--
-- Name: support_escalations support_escalations_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_escalations
    ADD CONSTRAINT support_escalations_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.support_conversations(id) ON DELETE CASCADE;


--
-- Name: support_escalations support_escalations_resolved_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_escalations
    ADD CONSTRAINT support_escalations_resolved_by_user_id_fkey FOREIGN KEY (resolved_by_user_id) REFERENCES public.users(id);


--
-- Name: support_events support_events_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_events
    ADD CONSTRAINT support_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: support_events support_events_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_events
    ADD CONSTRAINT support_events_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;


--
-- Name: support_events support_events_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_events
    ADD CONSTRAINT support_events_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.support_conversations(id) ON DELETE CASCADE;


--
-- Name: support_messages support_messages_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;


--
-- Name: support_messages support_messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.support_conversations(id) ON DELETE CASCADE;


--
-- Name: support_messages support_messages_sender_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_sender_user_id_fkey FOREIGN KEY (sender_user_id) REFERENCES public.users(id);


--
-- Name: tax_billing_allocations tax_billing_allocations_billing_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_billing_allocations
    ADD CONSTRAINT tax_billing_allocations_billing_document_id_fkey FOREIGN KEY (billing_document_id) REFERENCES public.financial_documents(id) ON DELETE RESTRICT;


--
-- Name: tax_billing_allocations tax_billing_allocations_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_billing_allocations
    ADD CONSTRAINT tax_billing_allocations_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;


--
-- Name: tax_billing_allocations tax_billing_allocations_compliance_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_billing_allocations
    ADD CONSTRAINT tax_billing_allocations_compliance_event_id_fkey FOREIGN KEY (compliance_event_id) REFERENCES public.compliance_events(id) ON DELETE RESTRICT;


--
-- Name: tax_billing_allocations tax_billing_allocations_tax_treatment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_billing_allocations
    ADD CONSTRAINT tax_billing_allocations_tax_treatment_id_fkey FOREIGN KEY (tax_treatment_id) REFERENCES public.tax_treatments(id) ON DELETE RESTRICT;


--
-- Name: tax_billing_allocations tax_billing_allocations_withholding_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_billing_allocations
    ADD CONSTRAINT tax_billing_allocations_withholding_record_id_fkey FOREIGN KEY (withholding_record_id) REFERENCES public.withholding_records(id) ON DELETE RESTRICT;


--
-- Name: tax_deposit_accounts tax_deposit_accounts_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_deposit_accounts
    ADD CONSTRAINT tax_deposit_accounts_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;


--
-- Name: tax_deposit_allocations tax_deposit_allocations_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_deposit_allocations
    ADD CONSTRAINT tax_deposit_allocations_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;


--
-- Name: tax_deposit_allocations tax_deposit_allocations_compliance_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_deposit_allocations
    ADD CONSTRAINT tax_deposit_allocations_compliance_event_id_fkey FOREIGN KEY (compliance_event_id) REFERENCES public.compliance_events(id) ON DELETE RESTRICT;


--
-- Name: tax_deposit_allocations tax_deposit_allocations_deposit_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_deposit_allocations
    ADD CONSTRAINT tax_deposit_allocations_deposit_account_id_fkey FOREIGN KEY (deposit_account_id) REFERENCES public.tax_deposit_accounts(id) ON DELETE RESTRICT;


--
-- Name: tax_deposit_allocations tax_deposit_allocations_deposit_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_deposit_allocations
    ADD CONSTRAINT tax_deposit_allocations_deposit_entry_id_fkey FOREIGN KEY (deposit_entry_id) REFERENCES public.tax_deposit_entries(id) ON DELETE RESTRICT;


--
-- Name: tax_deposit_allocations tax_deposit_allocations_tax_treatment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_deposit_allocations
    ADD CONSTRAINT tax_deposit_allocations_tax_treatment_id_fkey FOREIGN KEY (tax_treatment_id) REFERENCES public.tax_treatments(id) ON DELETE RESTRICT;


--
-- Name: tax_deposit_allocations tax_deposit_allocations_withholding_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_deposit_allocations
    ADD CONSTRAINT tax_deposit_allocations_withholding_record_id_fkey FOREIGN KEY (withholding_record_id) REFERENCES public.withholding_records(id) ON DELETE RESTRICT;


--
-- Name: tax_deposit_entries tax_deposit_entries_billing_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_deposit_entries
    ADD CONSTRAINT tax_deposit_entries_billing_document_id_fkey FOREIGN KEY (billing_document_id) REFERENCES public.financial_documents(id) ON DELETE RESTRICT;


--
-- Name: tax_deposit_entries tax_deposit_entries_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_deposit_entries
    ADD CONSTRAINT tax_deposit_entries_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;


--
-- Name: tax_deposit_entries tax_deposit_entries_deposit_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_deposit_entries
    ADD CONSTRAINT tax_deposit_entries_deposit_account_id_fkey FOREIGN KEY (deposit_account_id) REFERENCES public.tax_deposit_accounts(id) ON DELETE RESTRICT;


--
-- Name: tax_deposit_entries tax_deposit_entries_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_deposit_entries
    ADD CONSTRAINT tax_deposit_entries_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE RESTRICT;


--
-- Name: tax_profiles tax_profiles_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_profiles
    ADD CONSTRAINT tax_profiles_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;


--
-- Name: tax_rule_reviews tax_rule_reviews_tax_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_rule_reviews
    ADD CONSTRAINT tax_rule_reviews_tax_rule_id_fkey FOREIGN KEY (tax_rule_id) REFERENCES public.tax_rules(id) ON DELETE CASCADE;


--
-- Name: tax_rules tax_rules_official_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_rules
    ADD CONSTRAINT tax_rules_official_source_id_fkey FOREIGN KEY (official_source_id) REFERENCES public.official_sources(id);


--
-- Name: tax_rules tax_rules_supersedes_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_rules
    ADD CONSTRAINT tax_rules_supersedes_rule_id_fkey FOREIGN KEY (supersedes_rule_id) REFERENCES public.tax_rules(id);


--
-- Name: tax_treatments tax_treatments_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_treatments
    ADD CONSTRAINT tax_treatments_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;


--
-- Name: tax_treatments tax_treatments_compliance_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_treatments
    ADD CONSTRAINT tax_treatments_compliance_event_id_fkey FOREIGN KEY (compliance_event_id) REFERENCES public.compliance_events(id) ON DELETE RESTRICT;


--
-- Name: tax_treatments tax_treatments_debt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_treatments
    ADD CONSTRAINT tax_treatments_debt_id_fkey FOREIGN KEY (debt_id) REFERENCES public.debts(id) ON DELETE RESTRICT;


--
-- Name: tax_treatments tax_treatments_invoice_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_treatments
    ADD CONSTRAINT tax_treatments_invoice_document_id_fkey FOREIGN KEY (invoice_document_id) REFERENCES public.financial_documents(id) ON DELETE RESTRICT;


--
-- Name: tax_treatments tax_treatments_payroll_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_treatments
    ADD CONSTRAINT tax_treatments_payroll_payment_id_fkey FOREIGN KEY (payroll_payment_id) REFERENCES public.payroll_payments(id) ON DELETE RESTRICT;


--
-- Name: tax_treatments tax_treatments_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_treatments
    ADD CONSTRAINT tax_treatments_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.tax_rules(id) ON DELETE SET NULL;


--
-- Name: tax_treatments tax_treatments_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_treatments
    ADD CONSTRAINT tax_treatments_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.official_sources(id) ON DELETE SET NULL;


--
-- Name: telegram_user_state telegram_user_state_active_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_user_state
    ADD CONSTRAINT telegram_user_state_active_business_id_fkey FOREIGN KEY (active_business_id) REFERENCES public.businesses(id) ON DELETE SET NULL;


--
-- Name: telegram_user_state telegram_user_state_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_user_state
    ADD CONSTRAINT telegram_user_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: transactions transactions_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: transactions transactions_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id);


--
-- Name: transactions transactions_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id);


--
-- Name: transactions transactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_channel_links user_channel_links_revoked_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_channel_links
    ADD CONSTRAINT user_channel_links_revoked_by_user_id_fkey FOREIGN KEY (revoked_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_channel_links user_channel_links_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_channel_links
    ADD CONSTRAINT user_channel_links_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_channel_state user_channel_state_active_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_channel_state
    ADD CONSTRAINT user_channel_state_active_business_id_fkey FOREIGN KEY (active_business_id) REFERENCES public.businesses(id) ON DELETE SET NULL;


--
-- Name: user_channel_state user_channel_state_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_channel_state
    ADD CONSTRAINT user_channel_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_email_identities user_email_identities_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_email_identities
    ADD CONSTRAINT user_email_identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_profiles user_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: wallets wallets_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id);


--
-- Name: withholding_payment_allocations withholding_payment_allocations_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.withholding_payment_allocations
    ADD CONSTRAINT withholding_payment_allocations_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;


--
-- Name: withholding_payment_allocations withholding_payment_allocations_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.withholding_payment_allocations
    ADD CONSTRAINT withholding_payment_allocations_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE RESTRICT;


--
-- Name: withholding_payment_allocations withholding_payment_allocations_withholding_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.withholding_payment_allocations
    ADD CONSTRAINT withholding_payment_allocations_withholding_record_id_fkey FOREIGN KEY (withholding_record_id) REFERENCES public.withholding_records(id) ON DELETE RESTRICT;


--
-- Name: withholding_records withholding_records_bukti_potong_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.withholding_records
    ADD CONSTRAINT withholding_records_bukti_potong_document_id_fkey FOREIGN KEY (bukti_potong_document_id) REFERENCES public.financial_documents(id) ON DELETE RESTRICT;


--
-- Name: withholding_records withholding_records_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.withholding_records
    ADD CONSTRAINT withholding_records_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;


--
-- Name: withholding_records withholding_records_compliance_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.withholding_records
    ADD CONSTRAINT withholding_records_compliance_event_id_fkey FOREIGN KEY (compliance_event_id) REFERENCES public.compliance_events(id) ON DELETE RESTRICT;


--
-- Name: withholding_records withholding_records_debt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.withholding_records
    ADD CONSTRAINT withholding_records_debt_id_fkey FOREIGN KEY (debt_id) REFERENCES public.debts(id) ON DELETE RESTRICT;


--
-- Name: withholding_records withholding_records_invoice_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.withholding_records
    ADD CONSTRAINT withholding_records_invoice_document_id_fkey FOREIGN KEY (invoice_document_id) REFERENCES public.financial_documents(id) ON DELETE RESTRICT;


--
-- Name: withholding_records withholding_records_tax_treatment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.withholding_records
    ADD CONSTRAINT withholding_records_tax_treatment_id_fkey FOREIGN KEY (tax_treatment_id) REFERENCES public.tax_treatments(id) ON DELETE RESTRICT;


--
-- Name: access_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.access_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: activity_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activity_types ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_usage_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;

--
-- Name: assets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

--
-- Name: bank_import_batches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bank_import_batches ENABLE ROW LEVEL SECURITY;

--
-- Name: bank_import_matches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bank_import_matches ENABLE ROW LEVEL SECURITY;

--
-- Name: bank_import_rows; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bank_import_rows ENABLE ROW LEVEL SECURITY;

--
-- Name: bank_reconciliations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bank_reconciliations ENABLE ROW LEVEL SECURITY;

--
-- Name: business_addons; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.business_addons ENABLE ROW LEVEL SECURITY;

--
-- Name: business_directions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.business_directions ENABLE ROW LEVEL SECURITY;

--
-- Name: business_funding_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.business_funding_records ENABLE ROW LEVEL SECURITY;

--
-- Name: business_funding_repayments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.business_funding_repayments ENABLE ROW LEVEL SECURITY;

--
-- Name: business_invites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.business_invites ENABLE ROW LEVEL SECURITY;

--
-- Name: business_member_notification_grants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.business_member_notification_grants ENABLE ROW LEVEL SECURITY;

--
-- Name: business_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.business_members ENABLE ROW LEVEL SECURITY;

--
-- Name: business_relationships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.business_relationships ENABLE ROW LEVEL SECURITY;

--
-- Name: businesses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;

--
-- Name: cashflow_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cashflow_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

--
-- Name: channel_link_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.channel_link_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: classification_feedback; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.classification_feedback ENABLE ROW LEVEL SECURITY;

--
-- Name: classification_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.classification_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: compliance_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.compliance_events ENABLE ROW LEVEL SECURITY;

--
-- Name: counterparties; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.counterparties ENABLE ROW LEVEL SECURITY;

--
-- Name: counterparty_bank_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.counterparty_bank_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: debt_payment_idempotency; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.debt_payment_idempotency ENABLE ROW LEVEL SECURITY;

--
-- Name: debt_settlement_allocations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.debt_settlement_allocations ENABLE ROW LEVEL SECURITY;

--
-- Name: debts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.debts ENABLE ROW LEVEL SECURITY;

--
-- Name: document_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: document_compliance_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_compliance_links ENABLE ROW LEVEL SECURITY;

--
-- Name: document_debt_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_debt_links ENABLE ROW LEVEL SECURITY;

--
-- Name: document_files; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_files ENABLE ROW LEVEL SECURITY;

--
-- Name: document_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_links ENABLE ROW LEVEL SECURITY;

--
-- Name: document_transaction_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_transaction_links ENABLE ROW LEVEL SECURITY;

--
-- Name: email_login_codes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_login_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: financial_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.financial_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: incoming_payment_match_candidates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.incoming_payment_match_candidates ENABLE ROW LEVEL SECURITY;

--
-- Name: incoming_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.incoming_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: industry_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.industry_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: intercompany_funding_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.intercompany_funding_records ENABLE ROW LEVEL SECURITY;

--
-- Name: intercompany_settlement_allocations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.intercompany_settlement_allocations ENABLE ROW LEVEL SECURITY;

--
-- Name: mcp_oauth_clients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mcp_oauth_clients ENABLE ROW LEVEL SECURITY;

--
-- Name: mcp_oauth_codes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mcp_oauth_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: mcp_oauth_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mcp_oauth_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: mcp_oauth_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mcp_oauth_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: official_sources; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.official_sources ENABLE ROW LEVEL SECURITY;

--
-- Name: onboarding_context_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.onboarding_context_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: onboarding_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.onboarding_events ENABLE ROW LEVEL SECURITY;

--
-- Name: onboarding_flows; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.onboarding_flows ENABLE ROW LEVEL SECURITY;

--
-- Name: onboarding_progress; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.onboarding_progress ENABLE ROW LEVEL SECURITY;

--
-- Name: onboarding_step_progress; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.onboarding_step_progress ENABLE ROW LEVEL SECURITY;

--
-- Name: onboarding_steps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.onboarding_steps ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_provider_connections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_provider_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_provider_credentials; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_provider_credentials ENABLE ROW LEVEL SECURITY;

--
-- Name: payroll_employees; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payroll_employees ENABLE ROW LEVEL SECURITY;

--
-- Name: payroll_payment_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payroll_payment_items ENABLE ROW LEVEL SECURITY;

--
-- Name: payroll_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payroll_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: plan_limits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.plan_limits ENABLE ROW LEVEL SECURITY;

--
-- Name: reminders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;

--
-- Name: support_conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.support_conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: support_escalations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.support_escalations ENABLE ROW LEVEL SECURITY;

--
-- Name: support_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.support_events ENABLE ROW LEVEL SECURITY;

--
-- Name: support_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: tax_billing_allocations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tax_billing_allocations ENABLE ROW LEVEL SECURITY;

--
-- Name: tax_deposit_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tax_deposit_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: tax_deposit_allocations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tax_deposit_allocations ENABLE ROW LEVEL SECURITY;

--
-- Name: tax_deposit_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tax_deposit_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: tax_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tax_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: tax_rule_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tax_rule_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: tax_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tax_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: tax_treatments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tax_treatments ENABLE ROW LEVEL SECURITY;

--
-- Name: telegram_user_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.telegram_user_state ENABLE ROW LEVEL SECURITY;

--
-- Name: transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: user_channel_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_channel_links ENABLE ROW LEVEL SECURITY;

--
-- Name: user_channel_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_channel_state ENABLE ROW LEVEL SECURITY;

--
-- Name: user_email_identities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_email_identities ENABLE ROW LEVEL SECURITY;

--
-- Name: user_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: wallets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

--
-- Name: withholding_payment_allocations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.withholding_payment_allocations ENABLE ROW LEVEL SECURITY;

--
-- Name: withholding_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.withholding_records ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--


