-- Migration 038 — Personal funding atomic RPCs
-- Date: 2026-06-19. ADDITIVE + IDEMPOTENT + TRANSACTIONAL. No DROP, NO seed.
-- PROPOSED — NOT APPLIED TO PRODUCTION. Needs 037.
--
-- Each critical mutation creates its records AND the funding_audit row in ONE
-- transaction. Confirmed funding/repayment create BOTH cash legs atomically;
-- draft/pending/rejected/cancelled never touch cash. Hardening: SECURITY INVOKER,
-- fixed search_path, in-function type/ownership/currency validation, row locking,
-- idempotency keys, over-repayment + capital-repayment rejection, EXECUTE revoked
-- from PUBLIC (granted to service_role only). Outstanding is derived, never stored.

BEGIN;

DO $$ BEGIN
  IF to_regclass('public.funding_transfers') IS NULL THEN
    RAISE EXCEPTION '038 requires migration 037 (funding tables)'; END IF;
END $$;

-- Internal: insert one cash leg into transactions and return its id.
CREATE OR REPLACE FUNCTION fn_funding_leg(p_business uuid, p_user bigint, p_actor bigint,
  p_type text, p_amount numeric, p_currency text, p_wallet uuid, p_scope text, p_desc text)
RETURNS bigint LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO public.transactions
    (business_id, user_id, type, amount_original, amount_idr, currency_original, scope, wallet_id, description, transaction_date, created_by_user_id)
  VALUES
    (p_business, p_user, p_type, p_amount, p_amount, p_currency, p_scope, p_wallet, p_desc, current_date, p_actor)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Internal: validate a wallet belongs to a workspace and matches a currency.
CREATE OR REPLACE FUNCTION fn_wallet_check(p_wallet uuid, p_business uuid, p_currency text)
RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_biz uuid; v_cur text;
BEGIN
  SELECT business_id, currency INTO v_biz, v_cur FROM public.wallets WHERE id = p_wallet;
  IF v_biz IS NULL THEN RAISE EXCEPTION 'wallet % not found', p_wallet; END IF;
  IF v_biz IS DISTINCT FROM p_business THEN RAISE EXCEPTION 'wallet does not belong to workspace'; END IF;
  IF v_cur IS DISTINCT FROM p_currency THEN RAISE EXCEPTION 'cross_currency_not_supported'; END IF;
END $$;

-- ── Connection lifecycle ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION rpc_request_personal_business_connection(
  p_personal uuid, p_business uuid, p_actor bigint, p_channel text DEFAULT 'web')
RETURNS personal_business_relationships LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE r personal_business_relationships;
BEGIN
  INSERT INTO public.personal_business_relationships(personal_workspace_id, business_id, status, requested_by_user_id)
    VALUES (p_personal, p_business, 'pending', p_actor)
  ON CONFLICT (personal_workspace_id, business_id) DO UPDATE SET updated_at = now()
  RETURNING * INTO r;
  INSERT INTO public.funding_audit(actor_user_id, source_workspace_id, target_business_id, relationship_id, action, channel)
    VALUES (p_actor, p_personal, p_business, r.id, 'connection_requested', p_channel);
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION rpc_confirm_personal_business_connection(p_rel uuid, p_actor bigint, p_channel text DEFAULT 'web')
RETURNS personal_business_relationships LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE r personal_business_relationships;
BEGIN
  SELECT * INTO r FROM public.personal_business_relationships WHERE id = p_rel FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'relationship not found'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'relationship not pending (%).', r.status; END IF;
  UPDATE public.personal_business_relationships SET status='active', confirmed_by_user_id=p_actor, confirmed_at=now()
    WHERE id = p_rel RETURNING * INTO r;
  INSERT INTO public.funding_audit(actor_user_id, source_workspace_id, target_business_id, relationship_id, action, channel)
    VALUES (p_actor, r.personal_workspace_id, r.business_id, r.id, 'connection_confirmed', p_channel);
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION rpc_reject_personal_business_connection(p_rel uuid, p_actor bigint, p_channel text DEFAULT 'web')
RETURNS personal_business_relationships LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE r personal_business_relationships;
BEGIN
  SELECT * INTO r FROM public.personal_business_relationships WHERE id = p_rel FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'relationship not found'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'relationship not pending (%).', r.status; END IF;
  UPDATE public.personal_business_relationships SET status='rejected', rejected_at=now() WHERE id = p_rel RETURNING * INTO r;
  INSERT INTO public.funding_audit(actor_user_id, source_workspace_id, target_business_id, relationship_id, action, channel)
    VALUES (p_actor, r.personal_workspace_id, r.business_id, r.id, 'connection_rejected', p_channel);
  RETURN r;
END $$;

-- ── Create funding (NO cash legs — draft/pending only) ──────────────────────
CREATE OR REPLACE FUNCTION rpc_create_funding_transfer(p jsonb, p_actor bigint, p_channel text DEFAULT 'web')
RETURNS funding_transfers LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE r funding_transfers; v_rel personal_business_relationships; v_type text; v_repayable bool;
        v_amount numeric; v_currency text; v_idem text;
BEGIN
  v_idem := p->>'idempotency_key';
  IF v_idem IS NULL THEN RAISE EXCEPTION 'idempotency_key required'; END IF;
  SELECT * INTO r FROM public.funding_transfers WHERE idempotency_key = v_idem;  -- idempotent
  IF r.id IS NOT NULL THEN RETURN r; END IF;

  SELECT * INTO v_rel FROM public.personal_business_relationships WHERE id = (p->>'relationship_id')::uuid;
  IF v_rel.id IS NULL OR v_rel.status <> 'active' THEN RAISE EXCEPTION 'relationship not active'; END IF;
  IF v_rel.personal_workspace_id <> (p->>'source_workspace_id')::uuid OR v_rel.business_id <> (p->>'target_business_id')::uuid THEN
    RAISE EXCEPTION 'relationship does not match source/target'; END IF;

  v_type := p->>'funding_type';
  v_repayable := (v_type <> 'capital_contribution');
  v_amount := (p->>'amount')::numeric;
  v_currency := COALESCE(p->>'currency','IDR');
  -- intended wallets must belong to the right workspaces and share the currency
  PERFORM fn_wallet_check((p->>'source_wallet_id')::uuid, (p->>'source_workspace_id')::uuid, v_currency);
  PERFORM fn_wallet_check((p->>'target_wallet_id')::uuid, (p->>'target_business_id')::uuid, v_currency);

  INSERT INTO public.funding_transfers(
    relationship_id, source_workspace_id, target_business_id, contributor_user_id, funding_type, repayable,
    currency, amount, status, source_wallet_id, target_wallet_id, agreement_document_id, payment_proof_document_id,
    effective_date, maturity_date, interest_rate, notes, created_by_user_id, idempotency_key)
  VALUES (
    v_rel.id, (p->>'source_workspace_id')::uuid, (p->>'target_business_id')::uuid, (p->>'contributor_user_id')::bigint,
    v_type, v_repayable, v_currency, v_amount, 'pending_confirmation',
    (p->>'source_wallet_id')::uuid, (p->>'target_wallet_id')::uuid,
    (p->>'agreement_document_id')::uuid, (p->>'payment_proof_document_id')::uuid,
    (p->>'effective_date')::date, (p->>'maturity_date')::date, (p->>'interest_rate')::numeric,
    p->>'notes', p_actor, v_idem)
  RETURNING * INTO r;
  INSERT INTO public.funding_audit(actor_user_id, source_workspace_id, target_business_id, funding_transfer_id, relationship_id, action, amount, currency, funding_type, channel)
    VALUES (p_actor, r.source_workspace_id, r.target_business_id, r.id, r.relationship_id, 'funding_submitted', r.amount, r.currency, r.funding_type, p_channel);
  RETURN r;
END $$;

-- ── Confirm funding (creates BOTH cash legs atomically) ─────────────────────
CREATE OR REPLACE FUNCTION rpc_confirm_funding_transfer(p_funding uuid, p_actor bigint, p_channel text DEFAULT 'web')
RETURNS funding_transfers LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE r funding_transfers; v_rel_status text; v_src_tx bigint; v_tgt_tx bigint;
BEGIN
  SELECT * INTO r FROM public.funding_transfers WHERE id = p_funding FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'funding not found'; END IF;
  IF r.status <> 'pending_confirmation' THEN RAISE EXCEPTION 'funding not pending_confirmation (%).', r.status; END IF;
  SELECT status INTO v_rel_status FROM public.personal_business_relationships WHERE id = r.relationship_id;
  IF v_rel_status <> 'active' THEN RAISE EXCEPTION 'relationship not active'; END IF;
  PERFORM fn_wallet_check(r.source_wallet_id, r.source_workspace_id, r.currency);
  PERFORM fn_wallet_check(r.target_wallet_id, r.target_business_id, r.currency);

  -- personal leg = cash OUT of personal workspace; business leg = cash IN.
  v_src_tx := fn_funding_leg(r.source_workspace_id, r.contributor_user_id, p_actor, 'funding_out',  r.amount, r.currency, r.source_wallet_id, 'personal', 'Funding to business');
  v_tgt_tx := fn_funding_leg(r.target_business_id,  r.contributor_user_id, p_actor, 'funding_in',   r.amount, r.currency, r.target_wallet_id, 'business', 'Founder/investor funding');

  UPDATE public.funding_transfers SET status='confirmed', source_transaction_id=v_src_tx, target_transaction_id=v_tgt_tx,
    approved_by_user_id=p_actor, approved_at=now() WHERE id = p_funding RETURNING * INTO r;
  INSERT INTO public.funding_audit(actor_user_id, source_workspace_id, target_business_id, funding_transfer_id, relationship_id, action, amount, currency, funding_type, channel)
    VALUES (p_actor, r.source_workspace_id, r.target_business_id, r.id, r.relationship_id, 'funding_confirmed', r.amount, r.currency, r.funding_type, p_channel);
  RETURN r;
END $$;

-- ── Repay (two new legs; over-repayment & capital rejected) ─────────────────
CREATE OR REPLACE FUNCTION rpc_repay_funding_transfer(
  p_funding uuid, p_amount numeric, p_business_wallet uuid, p_personal_wallet uuid, p_idem text, p_actor bigint, p_channel text DEFAULT 'web')
RETURNS funding_repayments LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE r funding_transfers; rep funding_repayments; v_outstanding numeric; v_repaid numeric; v_btx bigint; v_ptx bigint;
BEGIN
  SELECT * INTO rep FROM public.funding_repayments WHERE idempotency_key = p_idem;  -- idempotent
  IF rep.id IS NOT NULL THEN RETURN rep; END IF;
  SELECT * INTO r FROM public.funding_transfers WHERE id = p_funding FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'funding not found'; END IF;
  IF NOT r.repayable THEN RAISE EXCEPTION 'capital_contribution cannot be repaid as a loan'; END IF;
  IF r.status NOT IN ('confirmed','partially_repaid') THEN RAISE EXCEPTION 'funding not repayable in status %', r.status; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'amount must be positive'; END IF;

  SELECT COALESCE(SUM(amount),0) INTO v_repaid FROM public.funding_repayments WHERE funding_transfer_id = p_funding AND status='confirmed';
  v_outstanding := r.amount - v_repaid;
  IF p_amount > v_outstanding + 0.005 THEN RAISE EXCEPTION 'over-repayment: % > outstanding %', p_amount, v_outstanding; END IF;

  PERFORM fn_wallet_check(p_business_wallet, r.target_business_id, r.currency);
  PERFORM fn_wallet_check(p_personal_wallet, r.source_workspace_id, r.currency);

  -- business leg = cash OUT of business; personal leg = cash IN to personal.
  v_btx := fn_funding_leg(r.target_business_id,  r.contributor_user_id, p_actor, 'funding_repayment_out', p_amount, r.currency, p_business_wallet, 'business', 'Loan repayment to investor');
  v_ptx := fn_funding_leg(r.source_workspace_id, r.contributor_user_id, p_actor, 'funding_repayment_in',  p_amount, r.currency, p_personal_wallet, 'personal', 'Loan repayment received');

  INSERT INTO public.funding_repayments(funding_transfer_id, amount, currency, business_wallet_id, personal_wallet_id, business_transaction_id, personal_transaction_id, idempotency_key, created_by_user_id)
    VALUES (p_funding, p_amount, r.currency, p_business_wallet, p_personal_wallet, v_btx, v_ptx, p_idem, p_actor) RETURNING * INTO rep;

  IF v_repaid + p_amount >= r.amount - 0.005 THEN
    UPDATE public.funding_transfers SET status='fully_repaid' WHERE id = p_funding;
    INSERT INTO public.funding_audit(actor_user_id, source_workspace_id, target_business_id, funding_transfer_id, relationship_id, action, amount, currency, funding_type, channel)
      VALUES (p_actor, r.source_workspace_id, r.target_business_id, r.id, r.relationship_id, 'funding_fully_repaid', p_amount, r.currency, r.funding_type, p_channel);
  ELSE
    UPDATE public.funding_transfers SET status='partially_repaid' WHERE id = p_funding;
  END IF;
  INSERT INTO public.funding_audit(actor_user_id, source_workspace_id, target_business_id, funding_transfer_id, relationship_id, action, amount, currency, funding_type, channel)
    VALUES (p_actor, r.source_workspace_id, r.target_business_id, r.id, r.relationship_id, 'funding_repayment_created', p_amount, r.currency, r.funding_type, p_channel);
  RETURN rep;
END $$;

-- ── Cancel (only before confirmation) ───────────────────────────────────────
CREATE OR REPLACE FUNCTION rpc_cancel_funding_transfer(p_funding uuid, p_actor bigint, p_channel text DEFAULT 'web')
RETURNS funding_transfers LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE r funding_transfers;
BEGIN
  SELECT * INTO r FROM public.funding_transfers WHERE id = p_funding FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'funding not found'; END IF;
  IF r.status NOT IN ('draft','pending_confirmation') THEN RAISE EXCEPTION 'only draft/pending can be cancelled (%).', r.status; END IF;
  UPDATE public.funding_transfers SET status='cancelled', cancelled_at=now() WHERE id = p_funding RETURNING * INTO r;
  INSERT INTO public.funding_audit(actor_user_id, source_workspace_id, target_business_id, funding_transfer_id, relationship_id, action, channel)
    VALUES (p_actor, r.source_workspace_id, r.target_business_id, r.id, r.relationship_id, 'funding_cancelled', p_channel);
  RETURN r;
END $$;

-- ── Permissions: backend/service-role only; never PUBLIC ────────────────────
DO $$
DECLARE fn text;
BEGIN
  FOR fn IN SELECT 'public.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
            FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND (p.proname LIKE 'rpc_%funding%' OR p.proname LIKE 'rpc_%connection%'
                                          OR p.proname IN ('fn_funding_leg','fn_wallet_check'))
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
 WHERE routine_schema='public' AND routine_name LIKE 'rpc_%funding%' ORDER BY 1;
