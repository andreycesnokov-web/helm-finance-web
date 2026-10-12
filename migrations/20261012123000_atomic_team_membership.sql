-- Business membership only: fix confirmed role escalation and single-use invite
-- race. No JWT/auth bridge, money writer, data repair or old migration changes.
-- Project into a fresh native PG17 restore before applying to own staging.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE FUNCTION public.cfo_team_role_rank(p_role text) RETURNS integer
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog,public
AS $$ SELECT CASE p_role WHEN 'employee' THEN 1 WHEN 'auditor' THEN 1 WHEN 'manager' THEN 2 WHEN 'accountant' THEN 3 WHEN 'cfo' THEN 3 WHEN 'admin' THEN 4 WHEN 'ceo' THEN 5 WHEN 'owner' THEN 6 ELSE 0 END $$;

CREATE FUNCTION public.rpc_accept_business_invite(p_actor bigint,p_code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE i public.business_invites; b public.businesses; m public.business_members; previous jsonb; display text;
BEGIN
 -- Existing global gate BEFORE every parent/invite/member row lock. Do not
 -- acquire a metadata lock and then call the membership trigger's gate.
 PERFORM public.fn_ledger_writer_lock();
 IF p_actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_actor) THEN RAISE EXCEPTION 'team_actor_required'; END IF;
 SELECT * INTO i FROM public.business_invites WHERE code=upper(trim(p_code));
 IF NOT FOUND THEN RAISE EXCEPTION 'team_invite_not_found'; END IF;
 SELECT * INTO b FROM public.businesses WHERE id=i.business_id FOR KEY SHARE;
 IF NOT FOUND OR b.type IS DISTINCT FROM 'business' THEN RAISE EXCEPTION 'team_business_required'; END IF;
 SELECT * INTO i FROM public.business_invites WHERE id=i.id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'team_invite_not_found'; END IF;
 SELECT * INTO m FROM public.business_members WHERE business_id=b.id AND user_id=p_actor FOR UPDATE;
 -- Current active membership is authority for replay, including a response lost
 -- after the invite was exhausted. Never alter its role or consume another use.
 IF b.owner_user_id=p_actor THEN RETURN jsonb_build_object('ok',true,'already_member',true,'role','owner','business_id',b.id); END IF;
 IF FOUND AND m.status='active' THEN RETURN jsonb_build_object('ok',true,'already_member',true,'role',m.role,'business_id',b.id); END IF;
 IF i.status IS DISTINCT FROM 'active' OR i.expires_at IS NULL OR i.expires_at<=clock_timestamp()
    OR i.max_uses IS NULL OR i.max_uses<1 OR coalesce(i.uses_count,0)>=i.max_uses
    OR i.role NOT IN ('employee','auditor','manager','accountant','cfo','admin','ceo') THEN RAISE EXCEPTION 'team_invite_unavailable'; END IF;
 previous:=CASE WHEN m.id IS NULL THEN NULL ELSE jsonb_build_object('role',m.role,'status',m.status) END;
 IF m.id IS NULL THEN
  SELECT coalesce(first_name,username) INTO display FROM public.users WHERE id=p_actor;
  INSERT INTO public.business_members(business_id,user_id,role,status,display_name,joined_at,invited_by,invite_code)
   VALUES(b.id,p_actor,i.role,'active',display,clock_timestamp(),i.invited_by,i.code) RETURNING * INTO m;
 ELSE
  UPDATE public.business_members SET status='active',role=i.role,invite_code=i.code,updated_at=clock_timestamp() WHERE id=m.id RETURNING * INTO m;
 END IF;
 UPDATE public.business_invites SET uses_count=coalesce(uses_count,0)+1,
  status=CASE WHEN coalesce(uses_count,0)+1>=max_uses THEN 'exhausted' ELSE 'active' END WHERE id=i.id;
 INSERT INTO public.audit_events(business_id,actor_user_id,actor_role,channel,entity_type,entity_id,action,before_json,after_json)
  VALUES(b.id,p_actor,m.role,'web','business_member',m.id::text,'invite_accepted',previous,jsonb_build_object('role',m.role,'status',m.status,'invite_id',i.id));
 RETURN jsonb_build_object('ok',true,'already_member',false,'role',m.role,'business_id',b.id);
END $$;

CREATE FUNCTION public.rpc_change_business_member(p_actor bigint,p_business uuid,p_member uuid,p_patch jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE b public.businesses; actor public.business_members; target public.business_members; actor_role text; new_role text; new_status text; previous jsonb;
BEGIN
 PERFORM public.fn_ledger_writer_lock();
 IF p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' OR p_patch='{}'::jsonb OR (p_patch-ARRAY['role','status'])<>'{}'::jsonb
    OR p_patch ? 'role' AND coalesce(p_patch->>'role','') NOT IN ('employee','auditor','manager','accountant','cfo','admin','ceo')
    OR p_patch ? 'status' AND coalesce(p_patch->>'status','') NOT IN ('active','removed','revoked') THEN RAISE EXCEPTION 'invalid_team_change'; END IF;
 SELECT * INTO b FROM public.businesses WHERE id=p_business FOR KEY SHARE;
 IF NOT FOUND OR b.type IS DISTINCT FROM 'business' THEN RAISE EXCEPTION 'team_business_required'; END IF;
 SELECT * INTO actor FROM public.business_members WHERE business_id=b.id AND user_id=p_actor AND status='active' FOR UPDATE;
 actor_role:=CASE WHEN b.owner_user_id=p_actor THEN 'owner' ELSE actor.role END;
 IF actor_role IS NULL OR actor_role NOT IN ('owner','admin') OR actor_role='owner' AND b.owner_user_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'team_forbidden'; END IF;
 SELECT * INTO target FROM public.business_members WHERE id=p_member AND business_id=b.id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'team_member_not_found'; END IF;
 IF target.user_id=b.owner_user_id THEN RAISE EXCEPTION 'team_owner_protected'; END IF;
 IF target.user_id=p_actor THEN RAISE EXCEPTION 'team_self_protected'; END IF;
 new_role:=coalesce(p_patch->>'role',target.role);new_status:=coalesce(p_patch->>'status',target.status);
 IF actor_role<>'owner' AND (public.cfo_team_role_rank(target.role)>=public.cfo_team_role_rank(actor_role)
    OR public.cfo_team_role_rank(new_role)>=public.cfo_team_role_rank(actor_role)) THEN RAISE EXCEPTION 'team_forbidden'; END IF;
 previous:=jsonb_build_object('role',target.role,'status',target.status);
 IF target.role IS NOT DISTINCT FROM new_role AND target.status IS NOT DISTINCT FROM new_status THEN RETURN to_jsonb(target); END IF;
 UPDATE public.business_members SET role=new_role,status=new_status,updated_at=clock_timestamp() WHERE id=target.id RETURNING * INTO target;
 -- Existing grant-cleanup trigger, if present, participates in this transaction.
 INSERT INTO public.audit_events(business_id,actor_user_id,actor_role,channel,entity_type,entity_id,action,before_json,after_json)
  VALUES(b.id,p_actor,actor_role,'web','business_member',target.id::text,'membership_changed',previous,jsonb_build_object('role',target.role,'status',target.status));
 RETURN to_jsonb(target);
END $$;

REVOKE ALL ON FUNCTION public.cfo_team_role_rank(text),public.rpc_accept_business_invite(bigint,text),public.rpc_change_business_member(bigint,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cfo_team_role_rank(text),public.rpc_accept_business_invite(bigint,text),public.rpc_change_business_member(bigint,uuid,uuid,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
