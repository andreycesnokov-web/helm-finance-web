-- Prepared only. Never apply to production automatically.
-- Uses the retained writer gate, existing payment/items and financial receipts.
BEGIN;
SET LOCAL lock_timeout='5s';
-- Applicability is explicit: never silently replace an evolved receipt contract.
DO $$ DECLARE definition text; names text[]; BEGIN
 IF to_regprocedure('public.fn_ledger_writer_lock()') IS NULL OR to_regprocedure('public.fn_ledger_writer_statement()') IS NULL
  OR to_regclass('public.audit_events') IS NULL OR to_regclass('public.payroll_runs') IS NOT NULL
  THEN RAISE EXCEPTION 'payroll_applicability_review_required'; END IF;
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
  WHERE conrelid='public.financial_write_requests'::regclass AND conname='financial_write_requests_operation_check';
 SELECT array_agg(m[1] ORDER BY m[1]) INTO names FROM regexp_matches(definition,'''([a-z_]+)''','g') m;
 IF names IS DISTINCT FROM ARRAY['transaction_batch','wallet_adjust','wallet_create','wallet_transfer']::text[]
  THEN RAISE EXCEPTION 'payroll_receipt_contract_review_required'; END IF;
END $$;
CREATE TABLE public.payroll_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
 period_month text NOT NULL CHECK(period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 payment_date date NOT NULL, wallet_id uuid NOT NULL REFERENCES public.wallets(id),
 currency text NOT NULL DEFAULT 'IDR' CHECK(currency='IDR'),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','scheduled','paid','cancelled')),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 created_by_user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
 approved_by_user_id bigint REFERENCES public.users(id) ON DELETE RESTRICT,
 approved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,business_id)
);
ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payroll_runs FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.payroll_runs TO service_role;
CREATE INDEX payroll_runs_company_period ON public.payroll_runs(business_id,period_month DESC,created_at DESC);
ALTER TABLE public.payroll_payments ADD COLUMN run_id uuid,
 ADD COLUMN employer_bpjs numeric NOT NULL DEFAULT 0 CHECK(employer_bpjs>=0),
 ADD COLUMN tax_source text,
 ADD CONSTRAINT payroll_payment_run_company_fk FOREIGN KEY(run_id,business_id) REFERENCES public.payroll_runs(id,business_id) ON DELETE RESTRICT,
 ADD CONSTRAINT payroll_payment_run_company_required CHECK(run_id IS NULL OR business_id IS NOT NULL);
CREATE UNIQUE INDEX payroll_run_employee_period ON public.payroll_payments(business_id,employee_id,period_month)
 WHERE run_id IS NOT NULL AND status<>'cancelled';
CREATE UNIQUE INDEX payroll_run_bank_transaction ON public.payroll_payments(transaction_id)
 WHERE run_id IS NOT NULL AND transaction_id IS NOT NULL;
CREATE TRIGGER ledger_writer_gate BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_runs
 FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ledger_writer_statement();
ALTER TABLE public.financial_write_requests DROP CONSTRAINT financial_write_requests_operation_check;
ALTER TABLE public.financial_write_requests ADD CONSTRAINT financial_write_requests_operation_check
 CHECK(operation IN('wallet_create','transaction_batch','wallet_adjust','wallet_transfer','payroll_run'));

CREATE FUNCTION public.fn_payroll_actor(p_business uuid,p_actor bigint) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE b public.businesses; m public.business_members; r text;
BEGIN
 SELECT * INTO b FROM public.businesses WHERE id=p_business AND type='business' AND coalesce(status,'active')<>'archived' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'payroll_forbidden'; END IF;
 SELECT * INTO m FROM public.business_members WHERE business_id=b.id AND user_id=p_actor AND status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'payroll_forbidden'; END IF;
 r:=CASE WHEN b.owner_user_id=p_actor THEN 'owner' ELSE m.role END;
 IF r IS NULL OR r NOT IN('owner','ceo','admin','cfo') OR r='owner' AND b.owner_user_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'payroll_forbidden'; END IF;
 RETURN r;
END $$;

CREATE FUNCTION public.rpc_payroll_employee_action(p_business uuid,p_actor bigint,p_action text,p_id uuid,p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE e public.payroll_employees; old_e jsonb; role_name text; owner_id bigint; aid uuid;
BEGIN
 PERFORM public.fn_ledger_writer_lock();role_name:=public.fn_payroll_actor(p_business,p_actor);
 SELECT owner_user_id INTO owner_id FROM public.businesses WHERE id=p_business;
 IF p_action IS NULL OR p_action NOT IN('create','update','archive') OR jsonb_typeof(p_patch) IS DISTINCT FROM 'object'
  OR p_patch-ARRAY['name','role','default_salary','currency','pay_day','default_wallet_id','status','notes','expected_updated_at']<>'{}'::jsonb
  THEN RAISE EXCEPTION 'payroll_invalid_request'; END IF;
 IF p_action='create' THEN
  e.id:=gen_random_uuid();e.business_id:=p_business;e.user_id:=owner_id;e.created_by_user_id:=p_actor;e.currency:='IDR';e.status:='active';
 ELSE
  SELECT * INTO e FROM public.payroll_employees WHERE id=p_id AND business_id=p_business FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payroll_employee_required'; END IF;
  IF p_patch ? 'expected_updated_at' AND (p_patch->>'expected_updated_at')::timestamptz IS DISTINCT FROM e.updated_at
   THEN RAISE EXCEPTION 'payroll_stale_review'; END IF;
  old_e:=to_jsonb(e);
 END IF;
 IF p_action='archive' THEN e.status:='archived'; ELSE
  IF p_patch ? 'name' THEN e.name:=trim(p_patch->>'name'); END IF;
  IF e.name IS NULL OR length(e.name) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'payroll_invalid_employee'; END IF;
  IF p_patch ? 'role' THEN e.role:=nullif(trim(p_patch->>'role'),''); END IF;
  IF p_patch ? 'notes' THEN e.notes:=nullif(trim(p_patch->>'notes'),''); END IF;
  IF length(coalesce(e.notes,''))>2000 OR length(coalesce(e.role,''))>200 THEN RAISE EXCEPTION 'payroll_invalid_employee'; END IF;
  IF p_patch ? 'default_salary' THEN
   IF p_patch->>'default_salary' IS NOT NULL AND (p_patch->>'default_salary' !~ '^[0-9]+$' OR (p_patch->>'default_salary')::numeric>1000000000000)
    THEN RAISE EXCEPTION 'payroll_invalid_amount'; END IF;
   e.default_salary:=(p_patch->>'default_salary')::numeric;
  END IF;
  IF p_patch ? 'currency' THEN e.currency:=p_patch->>'currency'; END IF;
  IF e.currency IS NULL OR e.currency !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'payroll_invalid_employee'; END IF;
  IF p_patch ? 'pay_day' THEN e.pay_day:=(p_patch->>'pay_day')::integer; END IF;
  IF e.pay_day IS NOT NULL AND e.pay_day NOT BETWEEN 1 AND 31 THEN RAISE EXCEPTION 'payroll_invalid_employee'; END IF;
  IF p_patch ? 'status' THEN e.status:=p_patch->>'status'; END IF;
  IF e.status IS NULL OR e.status NOT IN('active','inactive','archived') THEN RAISE EXCEPTION 'payroll_invalid_employee'; END IF;
  IF p_patch ? 'default_wallet_id' THEN e.default_wallet_id:=(p_patch->>'default_wallet_id')::uuid; END IF;
  IF e.default_wallet_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.wallets WHERE id=e.default_wallet_id
   AND business_id=p_business AND scope='business' AND is_active AND currency=e.currency) THEN RAISE EXCEPTION 'payroll_wallet_required'; END IF;
 END IF;
 IF p_action='create' THEN
  INSERT INTO public.payroll_employees(id,business_id,user_id,created_by_user_id,name,role,default_salary,currency,pay_day,default_wallet_id,status,notes)
  VALUES(e.id,p_business,owner_id,p_actor,e.name,e.role,e.default_salary,e.currency,e.pay_day,e.default_wallet_id,e.status,e.notes) RETURNING * INTO e;
 ELSE
  UPDATE public.payroll_employees SET name=e.name,role=e.role,default_salary=e.default_salary,currency=e.currency,pay_day=e.pay_day,
   default_wallet_id=e.default_wallet_id,status=e.status,notes=e.notes,updated_at=clock_timestamp() WHERE id=e.id RETURNING * INTO e;
 END IF;
 INSERT INTO public.audit_events(business_id,actor_user_id,actor_role,channel,entity_type,entity_id,action,before_json,after_json)
 VALUES(p_business,p_actor,role_name,'web','payroll_employee',e.id::text,'payroll_employee_'||p_action,old_e,to_jsonb(e)) RETURNING id INTO aid;
 RETURN jsonb_build_object('employee',to_jsonb(e),'audit_id',aid);
END $$;
REVOKE ALL ON FUNCTION public.rpc_payroll_employee_action(uuid,bigint,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_payroll_employee_action(uuid,bigint,text,uuid,jsonb) TO service_role;

CREATE FUNCTION public.rpc_payroll_run_action(p_business uuid,p_actor bigint,p_request_key text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE role_name text; owner_id bigint; r public.payroll_runs; old_run jsonb;
 prior public.financial_write_requests; answer jsonb; aid uuid; a text; line jsonb; k text; n numeric;
 emp public.payroll_employees; w public.wallets; payment public.payroll_payments; tx public.transactions;
 gross numeric; deductions numeric; net numeric; employer numeric; payment_id uuid; seen uuid[]:='{}';
 day date; month text; v bigint; previous_row public.payroll_payments;
BEGIN
 PERFORM public.fn_ledger_writer_lock();
 role_name:=public.fn_payroll_actor(p_business,p_actor);
 SELECT owner_user_id INTO owner_id FROM public.businesses WHERE id=p_business;
 IF p_request_key IS NULL OR length(p_request_key) NOT BETWEEN 1 AND 128 OR trim(p_request_key)<>p_request_key
  OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'payroll_invalid_request'; END IF;
 a:=p_payload->>'action';
 IF a IS NULL OR a NOT IN('create','edit','approve','cancel','link') THEN RAISE EXCEPTION 'payroll_invalid_request'; END IF;
 SELECT * INTO prior FROM public.financial_write_requests WHERE business_id=p_business AND actor_user_id=p_actor
  AND operation='payroll_run' AND request_key=p_request_key;
 IF FOUND THEN
  IF prior.intent IS DISTINCT FROM jsonb_build_object('version',1,'operation','payroll_run','scope','business','payload',p_payload)
   THEN RAISE EXCEPTION 'idempotency_key_mismatch'; END IF;
  RETURN prior.result||jsonb_build_object('is_replay',true,'result_is_historical',true);
 END IF;
 IF a<>'create' THEN
  SELECT * INTO r FROM public.payroll_runs WHERE id=(p_payload->>'run_id')::uuid AND business_id=p_business FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payroll_not_found'; END IF;
  IF r.version IS DISTINCT FROM (p_payload->>'version')::bigint THEN RAISE EXCEPTION 'payroll_stale_review'; END IF;
  old_run:=jsonb_build_object('run',to_jsonb(r),'payments',(SELECT coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('items',
   (SELECT coalesce(jsonb_agg(to_jsonb(i)),'[]') FROM public.payroll_payment_items i WHERE i.payroll_payment_id=p.id))),'[]')
   FROM public.payroll_payments p WHERE p.run_id=r.id AND p.business_id=p_business));
 END IF;
 IF a IN('create','edit') THEN
  IF a='edit' AND r.status<>'draft' THEN RAISE EXCEPTION 'payroll_draft_required'; END IF;
  IF p_payload->>'tax_confirmed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'payroll_tax_confirmation_required'; END IF;
  month:=p_payload->>'period_month';
  IF month IS NULL OR month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' OR p_payload->>'payment_date' IS NULL
   OR p_payload->>'payment_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'payroll_invalid_period'; END IF;
  day:=(p_payload->>'payment_date')::date;
  SELECT * INTO w FROM public.wallets WHERE id=(p_payload->>'wallet_id')::uuid AND business_id=p_business
   AND scope='business' AND currency='IDR' AND is_active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payroll_wallet_required'; END IF;
  IF jsonb_typeof(p_payload->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'lines') NOT BETWEEN 1 AND 500
   THEN RAISE EXCEPTION 'payroll_lines_required'; END IF;
  IF a='create' THEN
   INSERT INTO public.payroll_runs(business_id,period_month,payment_date,wallet_id,created_by_user_id)
    VALUES(p_business,month,day,w.id,p_actor) RETURNING * INTO r;
  ELSE
   DELETE FROM public.payroll_payment_items WHERE payroll_payment_id IN(SELECT id FROM public.payroll_payments WHERE run_id=r.id AND business_id=p_business);
   DELETE FROM public.payroll_payments WHERE run_id=r.id AND business_id=p_business AND transaction_id IS NULL AND status='draft';
   IF EXISTS(SELECT 1 FROM public.payroll_payments WHERE run_id=r.id) THEN RAISE EXCEPTION 'payroll_draft_required'; END IF;
   UPDATE public.payroll_runs SET period_month=month,payment_date=day,wallet_id=w.id WHERE id=r.id;
  END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(p_payload->'lines') LOOP
   IF jsonb_typeof(line) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'payroll_invalid_line'; END IF;
   SELECT * INTO emp FROM public.payroll_employees WHERE id=(line->>'employee_id')::uuid AND business_id=p_business
    AND status='active' AND currency='IDR' FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'payroll_employee_required'; END IF;
   IF emp.id=ANY(seen) THEN RAISE EXCEPTION 'payroll_duplicate_employee'; END IF;
   seen:=array_append(seen,emp.id);
   IF EXISTS(SELECT 1 FROM public.payroll_payments WHERE business_id=p_business AND employee_id=emp.id
    AND period_month=month AND status<>'cancelled') THEN RAISE EXCEPTION 'payroll_employee_period_exists'; END IF;
   FOREACH k IN ARRAY ARRAY['salary','bonus','earnings','pph21','bpjs','other','employer_bpjs'] LOOP
    IF line->>k IS NULL OR line->>k !~ '^[0-9]+$' OR length(line->>k)>13 THEN RAISE EXCEPTION 'payroll_invalid_amount'; END IF;
    n:=(line->>k)::numeric;
    IF n>1000000000000 THEN RAISE EXCEPTION 'payroll_invalid_amount'; END IF;
   END LOOP;
   gross:=(line->>'salary')::numeric+(line->>'bonus')::numeric+(line->>'earnings')::numeric;
   deductions:=(line->>'pph21')::numeric+(line->>'bpjs')::numeric+(line->>'other')::numeric;
   net:=gross-deductions; employer:=(line->>'employer_bpjs')::numeric;
   IF net<=0 THEN RAISE EXCEPTION 'payroll_invalid_net'; END IF;
   INSERT INTO public.payroll_payments(business_id,user_id,created_by_user_id,employee_id,employee_name,amount,currency,
    period_month,payment_date,wallet_id,status,gross_amount,deduction_amount,net_amount,run_id,employer_bpjs,tax_source)
   VALUES(p_business,owner_id,p_actor,emp.id,emp.name,net,'IDR',month,day,w.id,'draft',gross,deductions,net,r.id,employer,'accountant_entered') RETURNING id INTO payment_id;
   FOREACH k IN ARRAY ARRAY['salary','bonus','earnings','pph21','bpjs','other'] LOOP
    n:=(line->>k)::numeric;
    -- Preserve an explicit zero PPh21 so tax-not-entered cannot be confused with zero.
    IF n>0 OR k='pph21' THEN
     INSERT INTO public.payroll_payment_items(business_id,user_id,payroll_payment_id,item_type,label,amount,direction)
      VALUES(p_business,owner_id,payment_id,k,k,n,CASE WHEN k IN('salary','bonus','earnings') THEN 'addition' ELSE 'deduction' END);
    END IF;
   END LOOP;
  END LOOP;
 ELSIF a='approve' THEN
  IF r.status<>'draft' THEN RAISE EXCEPTION 'payroll_draft_required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.wallets WHERE id=r.wallet_id AND business_id=p_business AND scope='business' AND is_active AND currency=r.currency)
   THEN RAISE EXCEPTION 'payroll_wallet_required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.payroll_payments WHERE run_id=r.id AND business_id=p_business AND status='draft')
   OR EXISTS(SELECT 1 FROM public.payroll_payments p JOIN public.payroll_employees e ON e.id=p.employee_id
    WHERE p.run_id=r.id AND (e.status<>'active' OR e.business_id IS DISTINCT FROM p_business)) THEN RAISE EXCEPTION 'payroll_employee_required'; END IF;
  UPDATE public.payroll_runs SET status='scheduled',approved_at=now(),approved_by_user_id=p_actor WHERE id=r.id;
  UPDATE public.payroll_payments SET status='scheduled',updated_at=now() WHERE run_id=r.id AND business_id=p_business;
 ELSIF a='cancel' THEN
  IF r.status NOT IN('draft','scheduled') OR EXISTS(SELECT 1 FROM public.payroll_payments WHERE run_id=r.id AND (status='paid' OR transaction_id IS NOT NULL))
   THEN RAISE EXCEPTION 'payroll_paid_history_locked'; END IF;
  UPDATE public.payroll_runs SET status='cancelled' WHERE id=r.id;
  UPDATE public.payroll_payments SET status='cancelled',updated_at=now() WHERE run_id=r.id AND business_id=p_business;
 ELSIF a='link' THEN
  IF r.status<>'scheduled' OR r.approved_at IS NULL THEN RAISE EXCEPTION 'payroll_approval_required'; END IF;
  SELECT * INTO payment FROM public.payroll_payments WHERE id=(p_payload->>'payment_id')::uuid AND run_id=r.id AND business_id=p_business FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payroll_not_found'; END IF;
  IF payment.status<>'scheduled' OR payment.transaction_id IS NOT NULL THEN RAISE EXCEPTION 'payroll_already_linked'; END IF;
  SELECT * INTO tx FROM public.transactions WHERE id=(p_payload->>'transaction_id')::bigint AND business_id=p_business FOR SHARE;
  IF NOT FOUND OR tx.type NOT IN('expense','payroll') OR tx.scope IS DISTINCT FROM 'business'
   OR tx.wallet_id IS DISTINCT FROM payment.wallet_id OR tx.currency_original IS DISTINCT FROM payment.currency
   OR tx.amount_original IS DISTINCT FROM payment.net_amount OR tx.transfer_id IS NOT NULL
   OR tx.is_debt_payment OR tx.debt_payment_id IS NOT NULL THEN RAISE EXCEPTION 'payroll_transaction_mismatch'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.bank_import_rows br WHERE br.business_id=p_business
   AND br.review_status IN('imported','matched_existing') AND (br.linked_transaction_id=tx.id OR br.matched_transaction_id=tx.id))
   THEN RAISE EXCEPTION 'payroll_bank_evidence_required'; END IF;
  IF EXISTS(SELECT 1 FROM public.payroll_payments WHERE transaction_id=tx.id)
   OR EXISTS(SELECT 1 FROM public.debt_settlement_allocations WHERE transaction_id=tx.id)
   THEN RAISE EXCEPTION 'payroll_transaction_already_allocated'; END IF;
  UPDATE public.payroll_payments SET transaction_id=tx.id,status='paid',payment_date=tx.transaction_date,updated_at=now() WHERE id=payment.id;
  IF NOT EXISTS(SELECT 1 FROM public.payroll_payments WHERE run_id=r.id AND status<>'paid') THEN
   UPDATE public.payroll_runs SET status='paid' WHERE id=r.id;
  END IF;
 END IF;
 IF a<>'create' THEN UPDATE public.payroll_runs SET version=version+1,updated_at=now() WHERE id=r.id; END IF;
 SELECT * INTO r FROM public.payroll_runs WHERE id=r.id;
 INSERT INTO public.audit_events(business_id,actor_user_id,actor_role,channel,entity_type,entity_id,action,before_json,after_json,request_id)
 VALUES(p_business,p_actor,role_name,'web','payroll_run',r.id::text,'payroll_'||a,old_run,
  jsonb_build_object('run',to_jsonb(r),'payment_id',payment.id,'transaction_id',CASE WHEN a='link' THEN tx.id END,
   'payments',(SELECT coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('items',
    (SELECT coalesce(jsonb_agg(to_jsonb(i)),'[]') FROM public.payroll_payment_items i WHERE i.payroll_payment_id=p.id))),'[]')
    FROM public.payroll_payments p WHERE p.run_id=r.id AND p.business_id=p_business)),p_request_key) RETURNING id INTO aid;
 answer:=jsonb_build_object('ok',true,'run',to_jsonb(r),'audit_id',aid,'cash_changed',false);
 INSERT INTO public.financial_write_requests(business_id,actor_user_id,operation,request_key,intent,result)
 VALUES(p_business,p_actor,'payroll_run',p_request_key,jsonb_build_object('version',1,'operation','payroll_run','scope','business','payload',p_payload),answer);
 RETURN answer;
END $$;
REVOKE ALL ON FUNCTION public.fn_payroll_actor(uuid,bigint),public.rpc_payroll_run_action(uuid,bigint,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_payroll_actor(uuid,bigint),public.rpc_payroll_run_action(uuid,bigint,text,jsonb) TO service_role;
-- Paid source evidence cannot be silently changed by a retained transaction editor.
CREATE FUNCTION public.fn_payroll_bank_evidence_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.payroll_payments WHERE transaction_id=OLD.id AND run_id IS NOT NULL) THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'payroll_paid_history_locked'; END IF;
  IF (NEW.business_id,NEW.wallet_id,NEW.scope,NEW.type,NEW.amount_original,NEW.currency_original,NEW.transaction_date)
   IS DISTINCT FROM (OLD.business_id,OLD.wallet_id,OLD.scope,OLD.type,OLD.amount_original,OLD.currency_original,OLD.transaction_date)
   THEN RAISE EXCEPTION 'payroll_paid_history_locked'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payroll_bank_evidence_guard BEFORE UPDATE OR DELETE ON public.transactions
 FOR EACH ROW EXECUTE FUNCTION public.fn_payroll_bank_evidence_guard();
REVOKE ALL ON FUNCTION public.fn_payroll_bank_evidence_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_payroll_bank_evidence_guard() TO service_role;
-- Receipt reader reused from the atomic bill migration.
CREATE OR REPLACE FUNCTION public.rpc_list_own_financial_receipts(
 p_business_id uuid,p_user_id bigint,p_operation text DEFAULT NULL,p_before timestamptz DEFAULT NULL,
 p_after_operation text DEFAULT NULL,p_after_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE role_name text; answer jsonb;
BEGIN
 SELECT CASE WHEN b.owner_user_id=p_user_id THEN 'owner' ELSE m.role END INTO role_name
 FROM public.businesses b LEFT JOIN public.business_members m ON m.business_id=b.id AND m.user_id=p_user_id AND m.status='active'
 WHERE b.id=p_business_id AND COALESCE(b.type,'business')<>'personal' AND COALESCE(b.status,'active')<>'archived'
   AND (b.owner_user_id=p_user_id OR m.user_id IS NOT NULL);
 IF role_name IS NULL OR role_name NOT IN ('owner','ceo','admin','cfo','accountant','manager','employee') THEN RAISE EXCEPTION 'business_write_forbidden: Current financial membership required'; END IF;
 IF p_operation IS NOT NULL AND p_operation NOT IN ('wallet_create','transaction_batch','wallet_adjust','debt_payment','wallet_transfer','bill_create','payroll_run')
 THEN RAISE EXCEPTION 'invalid_financial_intent: Unsupported receipt operation'; END IF;
 IF p_operation IN ('wallet_create','wallet_adjust','payroll_run') AND role_name='accountant'
 THEN RAISE EXCEPTION 'business_write_forbidden: Current wallet role required'; END IF;
 IF role_name IN('manager','employee') AND p_operation IS NOT NULL AND p_operation<>'bill_create' THEN RAISE EXCEPTION 'business_write_forbidden: Current financial role required'; END IF;
 WITH receipts AS (
   SELECT operation,request_key,intent,result,created_at FROM public.financial_write_requests
   WHERE role_name NOT IN('manager','employee') AND business_id=p_business_id AND actor_user_id=p_user_id AND created_at>=now()-interval '7 days'
     AND (p_operation IS NULL OR operation=p_operation)
     AND (role_name<>'accountant' OR operation NOT IN ('wallet_create','wallet_adjust','payroll_run'))
   UNION ALL
   SELECT 'debt_payment'::text,key,intent,response_body,created_at FROM public.debt_payment_idempotency
   WHERE role_name NOT IN('manager','employee') AND business_id=p_business_id AND user_id=p_user_id AND created_at>=now()-interval '7 days'
     AND (p_operation IS NULL OR p_operation='debt_payment')
   UNION ALL
   SELECT 'bill_create'::text,request_key::text,jsonb_build_object('version',1,'operation','bill_create','scope','business','payload',payload),result,created_at FROM public.bill_creation_requests
   WHERE business_id=p_business_id AND actor_user_id=p_user_id AND created_at>=now()-interval '7 days' AND (p_operation IS NULL OR p_operation='bill_create')
     AND EXISTS(SELECT 1 FROM public.business_members WHERE business_id=p_business_id AND user_id=p_user_id AND status='active')
 ), selected AS (
   SELECT * FROM receipts WHERE p_before IS NULL OR created_at<p_before OR
     (created_at=p_before AND (operation COLLATE "C",request_key COLLATE "C")>(p_after_operation COLLATE "C",p_after_key COLLATE "C"))
   ORDER BY created_at DESC,operation COLLATE "C",request_key COLLATE "C" LIMIT 26
 ), page AS (
   SELECT * FROM selected ORDER BY created_at DESC,operation COLLATE "C",request_key COLLATE "C" LIMIT 25
 )
 SELECT jsonb_build_object('rows',COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY created_at DESC,operation COLLATE "C",request_key COLLATE "C") FROM page),'[]'::jsonb),
   'has_more',(SELECT count(*)>25 FROM selected)) INTO answer;
 RETURN answer;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
