-- Migration 039 — FX + funding atomic RPCs
-- Date: 2026-06-19. ADDITIVE + IDEMPOTENT + TRANSACTIONAL. NO seed. PROPOSED — NOT APPLIED.
-- Needs 037 + 038. Backend/deterministic is the source of truth; AI never supplies rates.
-- Confirm/repay create both cash legs (+ optional fee leg) + record + audit atomically.
-- SECURITY INVOKER, fixed search_path, REVOKE PUBLIC / GRANT service_role, row-locking,
-- idempotency, asset/ownership/relationship/quote validation, over-repayment rejected.

BEGIN;

DO $$ BEGIN IF to_regclass('public.funding_transfers') IS NULL OR to_regclass('public.exchange_rate_quotes') IS NULL
  THEN RAISE EXCEPTION '039 needs 037 + 038'; END IF; END $$;

-- wallet must belong to workspace and hold the given asset
CREATE OR REPLACE FUNCTION fn_wallet_asset_check(p_wallet uuid, p_business uuid, p_asset text)
RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_biz uuid; v_asset text;
BEGIN
  SELECT business_id, asset_code INTO v_biz, v_asset FROM public.wallets WHERE id = p_wallet;
  IF v_biz IS NULL THEN RAISE EXCEPTION 'wallet % not found', p_wallet; END IF;
  IF v_biz IS DISTINCT FROM p_business THEN RAISE EXCEPTION 'wallet not in workspace'; END IF;
  IF v_asset IS DISTINCT FROM p_asset THEN RAISE EXCEPTION 'wallet asset mismatch (% vs %)', v_asset, p_asset; END IF;
END $$;

-- one cash leg into transactions (native asset + reporting value)
CREATE OR REPLACE FUNCTION fn_fund_leg(p_business uuid, p_user bigint, p_actor bigint, p_type text,
  p_amount numeric, p_asset text, p_wallet uuid, p_scope text, p_desc text,
  p_reporting numeric, p_rep_ccy text, p_quote uuid)
RETURNS bigint LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO public.transactions
    (business_id,user_id,type,amount_original,amount_idr,currency_original,asset_code,amount_reporting,reporting_currency,scope,wallet_id,description,transaction_date,created_by_user_id,fx_quote_id)
  VALUES (p_business,p_user,p_type,p_amount,COALESCE(p_reporting,p_amount),p_asset,p_asset,p_reporting,p_rep_ccy,p_scope,p_wallet,p_desc,current_date,p_actor,p_quote)
  RETURNING id INTO v_id; RETURN v_id;
END $$;

-- ── Connection lifecycle (request/confirm/reject/revoke) ────────────────────
CREATE OR REPLACE FUNCTION rpc_request_personal_business_connection(p_personal uuid, p_business uuid, p_actor bigint, p_channel text DEFAULT 'web')
RETURNS personal_business_relationships LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE r personal_business_relationships;
BEGIN
  INSERT INTO public.personal_business_relationships(personal_workspace_id,business_id,status,requested_by_user_id)
    VALUES (p_personal,p_business,'pending',p_actor)
  ON CONFLICT (personal_workspace_id,business_id) DO UPDATE SET updated_at=now() RETURNING * INTO r;
  INSERT INTO public.funding_audit(actor_user_id,source_workspace_id,target_business_id,relationship_id,action,channel)
    VALUES (p_actor,p_personal,p_business,r.id,'connection_requested',p_channel);
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION rpc_confirm_personal_business_connection(p_rel uuid, p_actor bigint, p_channel text DEFAULT 'web')
RETURNS personal_business_relationships LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE r personal_business_relationships;
BEGIN
  SELECT * INTO r FROM public.personal_business_relationships WHERE id=p_rel FOR UPDATE;
  IF r.id IS NULL OR r.status<>'pending' THEN RAISE EXCEPTION 'relationship not pending'; END IF;
  UPDATE public.personal_business_relationships SET status='active',confirmed_by_user_id=p_actor,confirmed_at=now() WHERE id=p_rel RETURNING * INTO r;
  INSERT INTO public.funding_audit(actor_user_id,source_workspace_id,target_business_id,relationship_id,action,channel)
    VALUES (p_actor,r.personal_workspace_id,r.business_id,r.id,'connection_confirmed',p_channel);
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION rpc_reject_personal_business_connection(p_rel uuid, p_actor bigint, p_channel text DEFAULT 'web')
RETURNS personal_business_relationships LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE r personal_business_relationships;
BEGIN
  SELECT * INTO r FROM public.personal_business_relationships WHERE id=p_rel FOR UPDATE;
  IF r.id IS NULL OR r.status<>'pending' THEN RAISE EXCEPTION 'relationship not pending'; END IF;
  UPDATE public.personal_business_relationships SET status='rejected',rejected_at=now() WHERE id=p_rel RETURNING * INTO r;
  INSERT INTO public.funding_audit(actor_user_id,source_workspace_id,target_business_id,relationship_id,action,channel)
    VALUES (p_actor,r.personal_workspace_id,r.business_id,r.id,'connection_rejected',p_channel);
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION rpc_revoke_personal_business_connection(p_rel uuid, p_actor bigint, p_channel text DEFAULT 'web')
RETURNS personal_business_relationships LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE r personal_business_relationships;
BEGIN
  SELECT * INTO r FROM public.personal_business_relationships WHERE id=p_rel FOR UPDATE;
  IF r.id IS NULL OR r.status<>'active' THEN RAISE EXCEPTION 'only active relationship can be revoked'; END IF;
  UPDATE public.personal_business_relationships SET status='revoked',revoked_at=now() WHERE id=p_rel RETURNING * INTO r;
  INSERT INTO public.funding_audit(actor_user_id,source_workspace_id,target_business_id,relationship_id,action,channel)
    VALUES (p_actor,r.personal_workspace_id,r.business_id,r.id,'relationship_revoked',p_channel);
  RETURN r;
END $$;

-- ── Record a provider/manual quote (backend only; AI is never the source) ───
CREATE OR REPLACE FUNCTION rpc_create_fx_quote_record(p jsonb, p_actor bigint, p_channel text DEFAULT 'web')
RETURNS exchange_rate_quotes LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE q exchange_rate_quotes;
BEGIN
  IF (p->>'idempotency_key') IS NOT NULL THEN
    SELECT * INTO q FROM public.exchange_rate_quotes WHERE idempotency_key = p->>'idempotency_key';
    IF q.id IS NOT NULL THEN RETURN q; END IF;
  END IF;
  INSERT INTO public.exchange_rate_quotes(provider,provider_quote_id,base_asset,quote_asset,rate,inverse_rate,bid,ask,
    market_timestamp,valid_until,rate_effective_date,source_type,status,manual_reason,raw_metadata,created_by_user_id,idempotency_key)
  VALUES (p->>'provider',p->>'provider_quote_id',p->>'base_asset',p->>'quote_asset',(p->>'rate')::numeric,
    (p->>'inverse_rate')::numeric,(p->>'bid')::numeric,(p->>'ask')::numeric,(p->>'market_timestamp')::timestamptz,
    (p->>'valid_until')::timestamptz,(p->>'rate_effective_date')::date,COALESCE(p->>'source_type','market_api'),
    COALESCE(p->>'status','available'),p->>'manual_reason',p->'raw_metadata',p_actor,p->>'idempotency_key')
  RETURNING * INTO q;
  INSERT INTO public.funding_audit(actor_user_id,fx_quote_id,action,source_asset,target_asset,booked_rate,channel)
    VALUES (p_actor,q.id, CASE WHEN q.source_type='manual' THEN 'manual_rate_entered' ELSE 'fx_quote_received' END, q.base_asset,q.quote_asset,q.rate,p_channel);
  RETURN q;
END $$;

-- ── Create funding (pending; NO cash legs) ──────────────────────────────────
CREATE OR REPLACE FUNCTION rpc_create_funding_transfer(p jsonb, p_actor bigint, p_channel text DEFAULT 'web')
RETURNS funding_transfers LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE r funding_transfers; v_rel personal_business_relationships; v_type text; v_q exchange_rate_quotes;
BEGIN
  SELECT * INTO r FROM public.funding_transfers WHERE idempotency_key = p->>'idempotency_key';
  IF r.id IS NOT NULL THEN RETURN r; END IF;
  SELECT * INTO v_rel FROM public.personal_business_relationships WHERE id=(p->>'relationship_id')::uuid;
  IF v_rel.id IS NULL OR v_rel.status<>'active' THEN RAISE EXCEPTION 'relationship not active'; END IF;
  v_type := p->>'funding_type';
  -- intended wallets must hold the declared assets and belong to the workspaces
  PERFORM fn_wallet_asset_check((p->>'source_wallet_id')::uuid,(p->>'source_workspace_id')::uuid,p->>'source_asset');
  PERFORM fn_wallet_asset_check((p->>'target_wallet_id')::uuid,(p->>'target_business_id')::uuid,p->>'target_asset');
  -- if cross-asset, a non-expired quote for the pair is required
  IF (p->>'source_asset') <> (p->>'target_asset') THEN
    IF (p->>'fx_quote_id') IS NULL THEN RAISE EXCEPTION 'cross-currency funding requires a quote'; END IF;
    SELECT * INTO v_q FROM public.exchange_rate_quotes WHERE id=(p->>'fx_quote_id')::uuid;
    IF v_q.id IS NULL THEN RAISE EXCEPTION 'quote not found'; END IF;
    IF v_q.status='expired' OR (v_q.valid_until IS NOT NULL AND v_q.valid_until < now()) THEN RAISE EXCEPTION 'refresh_quote_required'; END IF;
    IF NOT ((v_q.base_asset=(p->>'source_asset') AND v_q.quote_asset=(p->>'target_asset'))
         OR (v_q.base_asset=(p->>'target_asset') AND v_q.quote_asset=(p->>'source_asset'))) THEN RAISE EXCEPTION 'quote pair mismatch'; END IF;
  END IF;
  INSERT INTO public.funding_transfers(relationship_id,source_workspace_id,target_business_id,contributor_user_id,funding_type,repayable,
    source_asset,source_principal_amount,source_total_debit,target_asset,target_amount,fee_amount,fee_asset,network_fee_amount,network_fee_asset,spread_bps,
    booked_rate,rate_source,rate_market_timestamp,rate_effective_date,fx_quote_id,reporting_currency,reporting_amount,status,
    source_wallet_id,target_wallet_id,agreement_document_id,payment_proof_document_id,effective_date,maturity_date,interest_rate,notes,created_by_user_id,idempotency_key)
  VALUES (v_rel.id,(p->>'source_workspace_id')::uuid,(p->>'target_business_id')::uuid,(p->>'contributor_user_id')::bigint,v_type,(v_type<>'capital_contribution'),
    p->>'source_asset',(p->>'source_principal_amount')::numeric,COALESCE((p->>'source_total_debit')::numeric,(p->>'source_principal_amount')::numeric),
    p->>'target_asset',(p->>'target_amount')::numeric,(p->>'fee_amount')::numeric,p->>'fee_asset',(p->>'network_fee_amount')::numeric,p->>'network_fee_asset',(p->>'spread_bps')::numeric,
    (p->>'booked_rate')::numeric,p->>'rate_source',(p->>'rate_market_timestamp')::timestamptz,(p->>'rate_effective_date')::date,(p->>'fx_quote_id')::uuid,
    p->>'reporting_currency',(p->>'reporting_amount')::numeric,'pending_confirmation',
    (p->>'source_wallet_id')::uuid,(p->>'target_wallet_id')::uuid,(p->>'agreement_document_id')::uuid,(p->>'payment_proof_document_id')::uuid,
    (p->>'effective_date')::date,(p->>'maturity_date')::date,(p->>'interest_rate')::numeric,p->>'notes',p_actor,p->>'idempotency_key')
  RETURNING * INTO r;
  INSERT INTO public.funding_audit(actor_user_id,source_workspace_id,target_business_id,funding_transfer_id,relationship_id,action,source_asset,source_amount,target_asset,target_amount,booked_rate,funding_type,channel)
    VALUES (p_actor,r.source_workspace_id,r.target_business_id,r.id,r.relationship_id,'funding_submitted',r.source_asset,r.source_principal_amount,r.target_asset,r.target_amount,r.booked_rate,r.funding_type,p_channel);
  RETURN r;
END $$;

-- ── Confirm funding (legs: source principal OUT, optional fee OUT, target IN) ─
CREATE OR REPLACE FUNCTION rpc_confirm_funding_transfer(p_funding uuid, p_actor bigint, p_channel text DEFAULT 'web')
RETURNS funding_transfers LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE r funding_transfers; v_rel text; v_src bigint; v_tgt bigint; v_fee bigint;
BEGIN
  SELECT * INTO r FROM public.funding_transfers WHERE id=p_funding FOR UPDATE;
  IF r.id IS NULL OR r.status<>'pending_confirmation' THEN RAISE EXCEPTION 'funding not pending_confirmation'; END IF;
  SELECT status INTO v_rel FROM public.personal_business_relationships WHERE id=r.relationship_id;
  IF v_rel<>'active' THEN RAISE EXCEPTION 'relationship not active'; END IF;
  PERFORM fn_wallet_asset_check(r.source_wallet_id,r.source_workspace_id,r.source_asset);
  PERFORM fn_wallet_asset_check(r.target_wallet_id,r.target_business_id,r.target_asset);
  v_src := fn_fund_leg(r.source_workspace_id,r.contributor_user_id,p_actor,'funding_out',r.source_principal_amount,r.source_asset,r.source_wallet_id,'personal','Funding to business',r.reporting_amount,r.reporting_currency,r.fx_quote_id);
  IF COALESCE(r.fee_amount,0) > 0 THEN
    v_fee := fn_fund_leg(r.source_workspace_id,r.contributor_user_id,p_actor,'fx_fee',r.fee_amount,COALESCE(r.fee_asset,r.source_asset),r.source_wallet_id,'personal','FX/transfer fee',NULL,r.reporting_currency,r.fx_quote_id);
  END IF;
  v_tgt := fn_fund_leg(r.target_business_id,r.contributor_user_id,p_actor,'funding_in',r.target_amount,r.target_asset,r.target_wallet_id,'business','Founder/investor funding',r.reporting_amount,r.reporting_currency,r.fx_quote_id);
  UPDATE public.funding_transfers SET status='confirmed',source_transaction_id=v_src,target_transaction_id=v_tgt,fee_transaction_id=v_fee,approved_by_user_id=p_actor,approved_at=now() WHERE id=p_funding RETURNING * INTO r;
  IF r.fx_quote_id IS NOT NULL THEN UPDATE public.exchange_rate_quotes SET status='used' WHERE id=r.fx_quote_id AND status<>'used'; END IF;
  INSERT INTO public.funding_audit(actor_user_id,source_workspace_id,target_business_id,funding_transfer_id,relationship_id,action,source_asset,source_amount,target_asset,target_amount,booked_rate,funding_type,channel)
    VALUES (p_actor,r.source_workspace_id,r.target_business_id,r.id,r.relationship_id,'funding_confirmed',r.source_asset,r.source_principal_amount,r.target_asset,r.target_amount,r.booked_rate,r.funding_type,p_channel);
  RETURN r;
END $$;

-- ── Repay (principal reduction in principal asset; over-repay rejected) ─────
CREATE OR REPLACE FUNCTION rpc_repay_funding_transfer(p jsonb, p_actor bigint, p_channel text DEFAULT 'web')
RETURNS funding_repayments LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE r funding_transfers; rep funding_repayments; v_reduced numeric; v_outstanding numeric; v_btx bigint; v_ptx bigint;
        v_pr numeric; v_repay numeric;
BEGIN
  SELECT * INTO rep FROM public.funding_repayments WHERE idempotency_key=p->>'idempotency_key';
  IF rep.id IS NOT NULL THEN RETURN rep; END IF;
  SELECT * INTO r FROM public.funding_transfers WHERE id=(p->>'funding_transfer_id')::uuid FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'funding not found'; END IF;
  IF NOT r.repayable THEN RAISE EXCEPTION 'capital_contribution cannot be repaid as a loan'; END IF;
  IF r.status NOT IN ('confirmed','partially_repaid') THEN RAISE EXCEPTION 'funding not repayable in status %', r.status; END IF;
  v_pr := (p->>'principal_reduction_amount')::numeric;       -- in principal (source) asset
  v_repay := (p->>'repayment_amount_native')::numeric;       -- in business wallet asset
  IF v_pr <= 0 OR v_repay <= 0 THEN RAISE EXCEPTION 'amounts must be positive'; END IF;
  IF (p->>'principal_asset') <> r.source_asset THEN RAISE EXCEPTION 'principal_asset must equal funding source asset'; END IF;

  SELECT COALESCE(SUM(principal_reduction_amount),0) INTO v_reduced FROM public.funding_repayments WHERE funding_transfer_id=r.id AND status='confirmed';
  v_outstanding := r.source_principal_amount - v_reduced;
  IF v_pr > v_outstanding + 1e-9 THEN RAISE EXCEPTION 'over-repayment: principal % > outstanding %', v_pr, v_outstanding; END IF;

  PERFORM fn_wallet_asset_check((p->>'business_wallet_id')::uuid, r.target_business_id, p->>'repayment_asset');
  PERFORM fn_wallet_asset_check((p->>'personal_wallet_id')::uuid, r.source_workspace_id, COALESCE(p->>'principal_asset', r.source_asset));

  v_btx := fn_fund_leg(r.target_business_id,r.contributor_user_id,p_actor,'funding_repayment_out',v_repay,p->>'repayment_asset',(p->>'business_wallet_id')::uuid,'business','Loan repayment to investor',(p->>'reporting_amount')::numeric,r.reporting_currency,(p->>'repayment_quote_id')::uuid);
  v_ptx := fn_fund_leg(r.source_workspace_id,r.contributor_user_id,p_actor,'funding_repayment_in',v_pr,r.source_asset,(p->>'personal_wallet_id')::uuid,'personal','Loan repayment received',(p->>'reporting_amount')::numeric,r.reporting_currency,(p->>'repayment_quote_id')::uuid);

  INSERT INTO public.funding_repayments(funding_transfer_id,repayment_amount_native,repayment_asset,principal_reduction_amount,principal_asset,repayment_quote_id,booked_rate,business_wallet_id,personal_wallet_id,business_transaction_id,personal_transaction_id,reporting_amount,idempotency_key,created_by_user_id)
    VALUES (r.id,v_repay,p->>'repayment_asset',v_pr,r.source_asset,(p->>'repayment_quote_id')::uuid,(p->>'booked_rate')::numeric,(p->>'business_wallet_id')::uuid,(p->>'personal_wallet_id')::uuid,v_btx,v_ptx,(p->>'reporting_amount')::numeric,p->>'idempotency_key',p_actor) RETURNING * INTO rep;
  IF v_reduced + v_pr >= r.source_principal_amount - 1e-9 THEN
    UPDATE public.funding_transfers SET status='fully_repaid' WHERE id=r.id;
    INSERT INTO public.funding_audit(actor_user_id,source_workspace_id,target_business_id,funding_transfer_id,relationship_id,action,source_amount,source_asset,funding_type,channel)
      VALUES (p_actor,r.source_workspace_id,r.target_business_id,r.id,r.relationship_id,'funding_fully_repaid',v_pr,r.source_asset,r.funding_type,p_channel);
  ELSE UPDATE public.funding_transfers SET status='partially_repaid' WHERE id=r.id; END IF;
  INSERT INTO public.funding_audit(actor_user_id,source_workspace_id,target_business_id,funding_transfer_id,relationship_id,action,source_amount,source_asset,funding_type,channel)
    VALUES (p_actor,r.source_workspace_id,r.target_business_id,r.id,r.relationship_id,'funding_repayment_confirmed',v_pr,r.source_asset,r.funding_type,p_channel);
  RETURN rep;
END $$;

CREATE OR REPLACE FUNCTION rpc_cancel_funding_transfer(p_funding uuid, p_actor bigint, p_channel text DEFAULT 'web')
RETURNS funding_transfers LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE r funding_transfers;
BEGIN
  SELECT * INTO r FROM public.funding_transfers WHERE id=p_funding FOR UPDATE;
  IF r.id IS NULL OR r.status NOT IN ('draft','pending_confirmation') THEN RAISE EXCEPTION 'only draft/pending can be cancelled'; END IF;
  UPDATE public.funding_transfers SET status='cancelled',cancelled_at=now() WHERE id=p_funding RETURNING * INTO r;
  INSERT INTO public.funding_audit(actor_user_id,source_workspace_id,target_business_id,funding_transfer_id,relationship_id,action,channel)
    VALUES (p_actor,r.source_workspace_id,r.target_business_id,r.id,r.relationship_id,'funding_cancelled',p_channel);
  RETURN r;
END $$;

-- ── General wallet-to-wallet transfer (same or cross currency) ──────────────
CREATE OR REPLACE FUNCTION rpc_create_wallet_transfer(p jsonb, p_actor bigint, p_channel text DEFAULT 'web')
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_src bigint; v_tgt bigint; v_conv uuid; v_q exchange_rate_quotes;
BEGIN
  PERFORM fn_wallet_asset_check((p->>'source_wallet_id')::uuid,(p->>'source_workspace_id')::uuid,p->>'source_asset');
  PERFORM fn_wallet_asset_check((p->>'target_wallet_id')::uuid,(p->>'target_workspace_id')::uuid,p->>'target_asset');
  IF (p->>'source_asset')=(p->>'target_asset') THEN
    IF (p->>'source_amount')::numeric <> (p->>'target_amount')::numeric THEN RAISE EXCEPTION 'same-asset transfer amounts must match'; END IF;
  ELSE
    SELECT * INTO v_q FROM public.exchange_rate_quotes WHERE id=(p->>'fx_quote_id')::uuid;
    IF v_q.id IS NULL THEN RAISE EXCEPTION 'cross-currency transfer requires a quote'; END IF;
    IF v_q.status='expired' OR (v_q.valid_until IS NOT NULL AND v_q.valid_until < now()) THEN RAISE EXCEPTION 'refresh_quote_required'; END IF;
    INSERT INTO public.fx_conversions(quote_id,source_asset,source_amount,target_asset,target_amount,booked_rate,fee_amount,fee_asset,network_fee_amount,network_fee_asset,spread_bps,created_by_user_id)
      VALUES (v_q.id,p->>'source_asset',(p->>'source_amount')::numeric,p->>'target_asset',(p->>'target_amount')::numeric,v_q.rate,(p->>'fee_amount')::numeric,p->>'fee_asset',(p->>'network_fee_amount')::numeric,p->>'network_fee_asset',(p->>'spread_bps')::numeric,p_actor) RETURNING id INTO v_conv;
  END IF;
  v_src := fn_fund_leg((p->>'source_workspace_id')::uuid,(p->>'actor_user_id')::bigint,p_actor,'fx_transfer_out',(p->>'source_amount')::numeric,p->>'source_asset',(p->>'source_wallet_id')::uuid,(p->>'source_scope'),'Wallet transfer out',NULL,NULL,(p->>'fx_quote_id')::uuid);
  v_tgt := fn_fund_leg((p->>'target_workspace_id')::uuid,(p->>'actor_user_id')::bigint,p_actor,'fx_transfer_in',(p->>'target_amount')::numeric,p->>'target_asset',(p->>'target_wallet_id')::uuid,(p->>'target_scope'),'Wallet transfer in',NULL,NULL,(p->>'fx_quote_id')::uuid);
  INSERT INTO public.funding_audit(actor_user_id,action,source_asset,source_amount,target_asset,target_amount,channel)
    VALUES (p_actor,'wallet_transfer_confirmed',p->>'source_asset',(p->>'source_amount')::numeric,p->>'target_asset',(p->>'target_amount')::numeric,p_channel);
  RETURN jsonb_build_object('source_transaction_id',v_src,'target_transaction_id',v_tgt,'fx_conversion_id',v_conv);
END $$;

-- ── Permissions: backend/service-role only ──────────────────────────────────
DO $$ DECLARE fn text; BEGIN
  FOR fn IN SELECT 'public.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')'
            FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND (p.proname LIKE 'rpc_%' AND (p.proname LIKE '%funding%' OR p.proname LIKE '%connection%' OR p.proname LIKE '%fx%' OR p.proname LIKE '%wallet_transfer%') OR p.proname IN ('fn_fund_leg','fn_wallet_asset_check'))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn); END IF;
  END LOOP;
END $$;

COMMIT;

SELECT routine_name FROM information_schema.routines WHERE routine_schema='public'
 AND routine_name LIKE 'rpc_%' AND (routine_name LIKE '%funding%' OR routine_name LIKE '%connection%' OR routine_name LIKE '%fx%' OR routine_name LIKE '%wallet_transfer%') ORDER BY 1;
