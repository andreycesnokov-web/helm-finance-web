-- AC-0 / I-6 (24 Oct 2026): recording equity or a loan is one atomic, idempotent database operation.
--
-- Before: POST /api/business-funding inserted the record, then the repayment schedule, as two separate writes; a
-- failure between them (or of the compensating delete) left a loan without its schedule, a retry created a second
-- record, the audit row was best-effort, and two records could claim the same received payment (double recognition).
-- After: rpc_create_business_funding writes record + schedule + audit + receipt in one transaction under the ledger
-- writer lock. The same request key with the same content returns the stored result (no second record); the same key
-- with different content is refused. A received payment can back at most one funding record (unique index, and the
-- same check in the function). Semantics unchanged: principal is never revenue; the schedule's principal cannot
-- exceed the loan; equity has no schedule, interest or due date. Nothing here moves cash.
-- Rollback: 20261025092000_atomic_funding_creation_down.sql. No existing row changes.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$ BEGIN
  IF to_regclass('public.business_funding_records') IS NULL OR to_regclass('public.business_funding_repayments') IS NULL
     OR to_regclass('public.audit_events') IS NULL
  THEN RAISE EXCEPTION 'atomic_funding_creation_applicability_review_required'; END IF;
  IF to_regclass('public.funding_creation_requests') IS NOT NULL THEN RAISE EXCEPTION 'atomic_funding_creation_already_installed'; END IF;
  -- The uniqueness below needs clean data; stop for review instead of guessing which record is right.
  IF EXISTS (SELECT 1 FROM public.business_funding_records WHERE received_transaction_id IS NOT NULL
             GROUP BY business_id, received_transaction_id HAVING count(*) > 1)
  THEN RAISE EXCEPTION 'funding_received_transaction_duplicates_review_required'; END IF;
END $$;

CREATE UNIQUE INDEX bfr_received_tx_uniq ON public.business_funding_records (business_id, received_transaction_id)
  WHERE received_transaction_id IS NOT NULL;

CREATE TABLE public.funding_creation_requests (
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  actor_user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  request_key text NOT NULL CHECK (length(request_key) BETWEEN 1 AND 128),
  intent_sha256 text NOT NULL,
  funding_record_id uuid NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, actor_user_id, request_key));
ALTER TABLE public.funding_creation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.funding_creation_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.funding_creation_requests TO service_role;

CREATE FUNCTION public.fn_funding_creation_requests_append_only()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'funding_creation_requests_append_only: receipts cannot be changed'; END IF;
  IF EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = OLD.business_id) THEN
    RAISE EXCEPTION 'funding_creation_requests_append_only: receipts cannot be deleted';
  END IF;
  RETURN OLD;
END; $function$;
REVOKE ALL ON FUNCTION public.fn_funding_creation_requests_append_only() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER funding_creation_requests_append_only BEFORE UPDATE OR DELETE ON public.funding_creation_requests
  FOR EACH ROW EXECUTE FUNCTION public.fn_funding_creation_requests_append_only();

CREATE FUNCTION public.rpc_create_business_funding(p_business uuid, p_actor bigint, p_request_key text,
  p_record jsonb, p_schedule jsonb DEFAULT '[]'::jsonb, p_channel text DEFAULT 'web')
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_type text; v_role text; v_hash text; v_prev public.funding_creation_requests;
  v_rec public.business_funding_records; v_reps jsonb; v_result jsonb;
  v_amount numeric; v_principal numeric; v_rx bigint; v_cp uuid; v_schedule jsonb := COALESCE(p_schedule, '[]'::jsonb);
BEGIN
  PERFORM public.fn_ledger_writer_lock();
  IF p_request_key IS NULL OR length(p_request_key) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'idempotency_key_required: Keep a stable request key for this funding record';
  END IF;
  SELECT b.type INTO v_type FROM public.businesses b WHERE b.id = p_business;
  IF NOT FOUND THEN RAISE EXCEPTION 'business_not_found'; END IF;
  IF v_type = 'personal' THEN RAISE EXCEPTION 'business_workspace_required'; END IF;
  SELECT m.role INTO v_role FROM public.business_members m
   WHERE m.business_id = p_business AND m.user_id = p_actor AND m.status = 'active';
  IF v_role IS NULL OR v_role NOT IN ('owner','ceo','admin','cfo') THEN RAISE EXCEPTION 'funding_forbidden: Only owner, CEO, admin or CFO can record funding'; END IF;
  IF jsonb_typeof(p_record) <> 'object' OR jsonb_typeof(v_schedule) <> 'array' THEN RAISE EXCEPTION 'invalid_funding_payload'; END IF;

  -- Idempotency: the same key and content returns the stored result; other content under the key is refused.
  v_hash := encode(sha256(convert_to(jsonb_build_object('record', p_record, 'schedule', v_schedule)::text, 'UTF8')), 'hex');
  SELECT * INTO v_prev FROM public.funding_creation_requests
   WHERE business_id = p_business AND actor_user_id = p_actor AND request_key = p_request_key;
  IF FOUND THEN
    IF v_prev.intent_sha256 <> v_hash THEN RAISE EXCEPTION 'idempotency_key_reused: This request key was used for different funding details'; END IF;
    RETURN v_prev.result || jsonb_build_object('replayed', true);
  END IF;

  v_amount := (p_record->>'amount')::numeric;
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  v_rx := NULLIF(p_record->>'received_transaction_id', '')::bigint;
  IF v_rx IS NOT NULL THEN
    -- The money received must be an incoming operation of this company, backing no other funding record.
    IF NOT EXISTS (SELECT 1 FROM public.transactions t WHERE t.id = v_rx AND t.business_id = p_business AND t.type = 'income') THEN
      RAISE EXCEPTION 'transaction_not_found_in_this_business: The received payment must be an incoming operation of this company';
    END IF;
    IF EXISTS (SELECT 1 FROM public.business_funding_records r WHERE r.business_id = p_business AND r.received_transaction_id = v_rx)
       OR EXISTS (SELECT 1 FROM public.business_funding_repayments r WHERE r.business_id = p_business AND r.paid_transaction_id = v_rx) THEN
      RAISE EXCEPTION 'transaction_already_linked_to_funding: This payment already backs a funding record';
    END IF;
  END IF;
  v_cp := NULLIF(p_record->>'counterparty_id', '')::uuid;
  IF v_cp IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.counterparties c WHERE c.id = v_cp AND c.business_id = p_business) THEN
    RAISE EXCEPTION 'counterparty_not_found_in_this_business';
  END IF;
  IF jsonb_array_length(v_schedule) > 0 AND p_record->>'instrument' IS DISTINCT FROM 'loan' THEN RAISE EXCEPTION 'equity_has_no_repayments'; END IF;
  IF jsonb_array_length(v_schedule) > 360 THEN RAISE EXCEPTION 'invalid_schedule'; END IF;
  SELECT COALESCE(sum(COALESCE((s->>'principal')::numeric, 0)), 0) INTO v_principal FROM jsonb_array_elements(v_schedule) s;
  IF v_principal > v_amount THEN RAISE EXCEPTION 'schedule_exceeds_loan: Scheduled principal exceeds the loan'; END IF;

  INSERT INTO public.business_funding_records(business_id, source_kind, instrument, counterparty_id, lender_name, amount, currency,
    received_on, received_transaction_id, interest_rate_annual, terms_text, due_on, created_by_user_id)
  VALUES (p_business, p_record->>'source_kind', p_record->>'instrument', v_cp, NULLIF(btrim(COALESCE(p_record->>'lender_name', '')), ''),
    v_amount, COALESCE(NULLIF(p_record->>'currency', ''), 'IDR'), (p_record->>'received_on')::date, v_rx,
    NULLIF(p_record->>'interest_rate_annual', '')::numeric, NULLIF(p_record->>'terms_text', ''), NULLIF(p_record->>'due_on', '')::date, p_actor)
  RETURNING * INTO v_rec;
  INSERT INTO public.business_funding_repayments(business_id, funding_record_id, due_on, principal, interest, created_by_user_id)
  SELECT p_business, v_rec.id, (s->>'due_on')::date, COALESCE((s->>'principal')::numeric, 0), COALESCE((s->>'interest')::numeric, 0), p_actor
    FROM jsonb_array_elements(v_schedule) WITH ORDINALITY AS e(s, n) ORDER BY n;
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.due_on, r.id), '[]'::jsonb) INTO v_reps
    FROM public.business_funding_repayments r WHERE r.funding_record_id = v_rec.id;
  v_result := jsonb_build_object('record', to_jsonb(v_rec), 'repayments', v_reps);
  INSERT INTO public.audit_events(business_id, actor_user_id, actor_role, channel, entity_type, entity_id, action, before_json, after_json, request_id)
  VALUES (p_business, p_actor, v_role, COALESCE(p_channel, 'web'), 'business_funding', v_rec.id::text, 'funding_recorded', NULL,
    to_jsonb(v_rec) || jsonb_build_object('schedule_count', jsonb_array_length(v_reps)), p_request_key);
  INSERT INTO public.funding_creation_requests(business_id, actor_user_id, request_key, intent_sha256, funding_record_id, result)
  VALUES (p_business, p_actor, p_request_key, v_hash, v_rec.id, v_result);
  RETURN v_result || jsonb_build_object('replayed', false);
END; $function$;
REVOKE ALL ON FUNCTION public.rpc_create_business_funding(uuid,bigint,text,jsonb,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_business_funding(uuid,bigint,text,jsonb,jsonb,text) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
