-- Operation evidence reuses the existing document links and append-only audit.
-- No new registry, cash mutation, financial trigger or authorization bridge.
BEGIN;
CREATE FUNCTION public.fn_operation_documents_version(p_business uuid,p_type text,p_id bigint)
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT md5(jsonb_build_object(
 'parent',CASE WHEN p_type='debt' THEN (SELECT to_jsonb(d) FROM public.debts d WHERE d.id=p_id AND d.business_id=p_business) ELSE (SELECT to_jsonb(t) FROM public.transactions t WHERE t.id=p_id AND t.business_id=p_business) END,
 'payments',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM public.transactions t WHERE t.business_id=p_business AND (p_type='debt' AND (t.debt_payment_id=p_id OR t.id IN(SELECT a.transaction_id FROM public.debt_settlement_allocations a WHERE a.business_id=p_business AND a.debt_id=p_id)) OR p_type='transaction' AND t.transfer_id IS NOT NULL AND t.transfer_id=(SELECT x.transfer_id FROM public.transactions x WHERE x.id=p_id AND x.business_id=p_business))),
 'withholding',(SELECT coalesce(jsonb_agg(to_jsonb(w) ORDER BY w.id),'[]') FROM public.withholding_records w WHERE p_type='debt' AND w.business_id=p_business AND w.debt_id=p_id)
 )::text)
$$;

CREATE FUNCTION public.rpc_operation_documents_snapshot(p_business uuid,p_actor bigint,p_month text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE v_role text; v_start date; v_end date;
BEGIN
 SELECT m.role INTO v_role FROM public.business_members m JOIN public.businesses b ON b.id=m.business_id WHERE m.business_id=p_business AND m.user_id=p_actor AND m.status='active' AND b.type='business' AND coalesce(b.status,'active')='active';
 IF v_role IS NULL THEN RAISE EXCEPTION 'operation_documents_forbidden' USING ERRCODE='42501'; END IF;
 IF p_month !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'invalid_month'; END IF;
 v_start=(p_month||'-01')::date;v_end=(v_start+interval '1 month')::date;
 -- A single native SQL snapshot, unrestricted by PostgREST's row-page cap.
 RETURN jsonb_build_object(
 'transactions',(SELECT coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('document_review_version',public.fn_operation_documents_version(p_business,'transaction',t.id)) ORDER BY t.id),'[]') FROM public.transactions t WHERE t.business_id=p_business AND t.scope='business' AND t.is_training IS DISTINCT FROM true AND (v_role IN('owner','ceo','admin','cfo','accountant','auditor') OR t.created_by_user_id=p_actor)),
 'debts',(SELECT coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('document_review_version',public.fn_operation_documents_version(p_business,'debt',d.id)) ORDER BY d.id),'[]') FROM public.debts d WHERE d.business_id=p_business AND d.scope='business' AND d.is_training IS DISTINCT FROM true AND d.status<>'cancelled' AND (v_role IN('owner','ceo','admin','cfo','accountant','auditor') OR d.created_by_user_id=p_actor)),
 'documents',(SELECT coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('document_review_version',d.updated_at::text) ORDER BY d.id),'[]') FROM public.financial_documents d WHERE d.business_id=p_business),
 'files',(SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.id),'[]') FROM public.document_files f WHERE f.business_id=p_business),
 'debt_links',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id),'[]') FROM public.document_debt_links l WHERE l.business_id=p_business),
 'transaction_links',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id),'[]') FROM public.document_transaction_links l WHERE l.business_id=p_business),
 'bank_rows',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.bank_import_rows r WHERE r.business_id=p_business AND (r.linked_transaction_id IS NOT NULL OR r.matched_transaction_id IS NOT NULL)),
 'batches',(SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.id),'[]') FROM public.bank_import_batches b WHERE b.business_id=p_business),
 'allocations',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') FROM public.debt_settlement_allocations a WHERE a.business_id=p_business),
 'withholding',(SELECT coalesce(jsonb_agg(to_jsonb(w) ORDER BY w.id),'[]') FROM public.withholding_records w WHERE w.business_id=p_business),
 'withholding_payments',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') FROM public.withholding_payment_allocations a WHERE a.business_id=p_business),
 'categories',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]') FROM public.cashflow_categories c WHERE c.business_id=p_business),
 'audit',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.created_at,a.id),'[]') FROM public.document_audit a WHERE a.business_id=p_business AND a.action IN('operation_reviewed','operation_evidence_confirmed','linked','unlinked','metadata_changed','archived')),
 'profile',(SELECT to_jsonb(p) FROM public.tax_profiles p WHERE p.business_id=p_business LIMIT 1),
 'scope',CASE WHEN v_role IN('owner','ceo','admin','cfo','accountant','auditor') THEN 'company' ELSE 'own_records' END);
END $$;

CREATE FUNCTION public.rpc_operation_document_action(p_business uuid,p_actor bigint,p_type text,p_id bigint,p_action text,p_version text,p_document uuid DEFAULT NULL,p_body jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE v_role text;v_doc public.financial_documents;v_link uuid;v_old public.document_audit;v_version text;v_metadata jsonb;v_found boolean;v_kind text;v_existing text;
BEGIN
 -- Membership before parent locks, as in the existing business writers. No cash gate.
 PERFORM 1 FROM public.businesses b WHERE b.id=p_business AND b.type='business' AND coalesce(b.status,'active')='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'operation_documents_forbidden' USING ERRCODE='42501'; END IF;
 SELECT m.role INTO v_role FROM public.business_members m WHERE m.business_id=p_business AND m.user_id=p_actor AND m.status='active' FOR SHARE;
 IF v_role IS NULL OR v_role NOT IN('owner','ceo','admin','cfo','accountant') THEN RAISE EXCEPTION 'operation_documents_forbidden' USING ERRCODE='42501'; END IF;
 IF p_type='debt' THEN PERFORM 1 FROM public.debts d WHERE d.id=p_id AND d.business_id=p_business AND d.scope='business' FOR SHARE;
 ELSIF p_type='transaction' THEN PERFORM 1 FROM public.transactions t WHERE t.id=p_id AND t.business_id=p_business AND t.scope='business' FOR SHARE;
 ELSE RAISE EXCEPTION 'invalid_target_type';END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'operation_not_found';END IF;
 v_version=public.fn_operation_documents_version(p_business,p_type,p_id);
 IF p_version IS DISTINCT FROM v_version THEN RAISE EXCEPTION 'operation_documents_stale' USING ERRCODE='40001';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('operation-documents:'||p_business::text||':'||p_type||':'||p_id::text,0));
 IF p_action='review' THEN
   IF coalesce(p_body->>'kind','') NOT IN('supplier','income','internal_transfer','funding','loan','fee','unknown') OR length(trim(coalesce(p_body->>'reason','')))<5 OR length(p_body->>'reason')>1000 OR jsonb_typeof(p_body->'contract_required') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'invalid_operation_review';END IF;
   -- Contract-only N/A, explained; withholding / tax payment / transfer pair cannot be waived.
   IF coalesce(p_body->>'contract_waiver','')<>'' AND (length(trim(p_body->>'contract_waiver'))<5 OR v_role NOT IN('owner','ceo','admin','cfo','accountant')) THEN RAISE EXCEPTION 'invalid_contract_waiver';END IF;
   v_metadata=jsonb_build_object('version',v_version,'kind',p_body->>'kind','reason',trim(p_body->>'reason'),'contract_required',(p_body->>'contract_required')::boolean,'contract_waiver',coalesce(p_body->>'contract_waiver',''));
   SELECT * INTO v_old FROM public.document_audit WHERE business_id=p_business AND target_type=p_type AND target_id=p_id::text AND action='operation_reviewed' ORDER BY created_at DESC,id DESC LIMIT 1;
   IF v_old.metadata=v_metadata THEN RETURN jsonb_build_object('ok',true,'replayed',true,'audit_id',v_old.id);END IF;
   INSERT INTO public.document_audit(business_id,actor_user_id,channel,action,target_type,target_id,metadata) VALUES(p_business,p_actor,'web','operation_reviewed',p_type,p_id::text,v_metadata) RETURNING id INTO v_link;
   RETURN jsonb_build_object('ok',true,'audit_id',v_link);
 END IF;
 SELECT * INTO v_doc FROM public.financial_documents WHERE id=p_document AND business_id=p_business FOR UPDATE;
 IF v_doc.id IS NULL THEN RAISE EXCEPTION 'document_not_found';END IF;
 IF p_type='debt' THEN SELECT id INTO v_link FROM public.document_debt_links WHERE business_id=p_business AND document_id=p_document AND debt_id=p_id;
 ELSE SELECT id INTO v_link FROM public.document_transaction_links WHERE business_id=p_business AND document_id=p_document AND transaction_id=p_id;END IF;
 IF p_action='unlink' THEN
   IF v_link IS NULL THEN RETURN jsonb_build_object('ok',true,'replayed',true);END IF;
   PERFORM public.rpc_document_unlink(v_link,p_document,p_business,p_actor,'web');
   RETURN jsonb_build_object('ok',true);
 END IF;
 IF p_action<>'link' OR v_doc.archived_at IS NOT NULL THEN RAISE EXCEPTION 'invalid_document_action';END IF;
 IF length(trim(coalesce(p_body->>'reason','')))<5 OR length(p_body->>'reason')>1000 OR coalesce(p_body->>'coverage','')<>'full_case' OR coalesce(p_body->>'role','') NOT IN('basis','payment','contract','withholding','tax_payment','funding') THEN RAISE EXCEPTION 'invalid_document_coverage';END IF;
 IF (p_body->>'document_version') IS DISTINCT FROM v_doc.updated_at::text THEN RAISE EXCEPTION 'document_review_stale' USING ERRCODE='40001';END IF;
 IF v_link IS NULL THEN v_link=public.rpc_document_link(p_document,p_business,p_type,p_id::text,p_actor,'web');END IF;
 v_metadata=jsonb_build_object('link_id',v_link,'role',p_body->>'role','coverage','full_case','reason',trim(p_body->>'reason'),'version',v_version,'document_version',v_doc.updated_at::text);
 SELECT * INTO v_old FROM public.document_audit WHERE business_id=p_business AND document_id=p_document AND target_type=p_type AND target_id=p_id::text AND action='operation_evidence_confirmed' AND metadata->>'role'=p_body->>'role' ORDER BY created_at DESC,id DESC LIMIT 1;
 IF v_old.metadata=v_metadata THEN RETURN jsonb_build_object('ok',true,'link_id',v_link,'replayed',true);END IF;
 INSERT INTO public.document_audit(business_id,document_id,actor_user_id,channel,action,target_type,target_id,metadata) VALUES(p_business,p_document,p_actor,'web','operation_evidence_confirmed',p_type,p_id::text,v_metadata);
 RETURN jsonb_build_object('ok',true,'link_id',v_link);
END $$;

REVOKE ALL ON FUNCTION public.fn_operation_documents_version(uuid,text,bigint),public.rpc_operation_documents_snapshot(uuid,bigint,text),public.rpc_operation_document_action(uuid,bigint,text,bigint,text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_operation_documents_version(uuid,text,bigint),public.rpc_operation_documents_snapshot(uuid,bigint,text),public.rpc_operation_document_action(uuid,bigint,text,bigint,text,text,uuid,jsonb) TO service_role;
COMMIT;
