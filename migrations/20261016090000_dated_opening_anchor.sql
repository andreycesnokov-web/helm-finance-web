-- D4-A: dated opening anchors, historical statement import and bank reconciliation.
-- Workspace: Business only (Personal and archived companies are refused everywhere).
-- Additive: no table or column is added, and NO existing financial row is updated, inserted
-- or deleted by this migration. Every balance stays byte-identical until a user explicitly
-- confirms a re-anchor (two appended correction rows + audit). One CHECK constraint widens.
-- Requires 069, 070, 071 and the timestamp chain through 20261014040810 (fail closed).
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $$ DECLARE d text; BEGIN
  IF to_regprocedure('public.fn_ledger_writer_lock()') IS NULL OR to_regprocedure('public.fn_ledger_signed(text,numeric,numeric)') IS NULL THEN
    RAISE EXCEPTION 'd4_requires_070';
  END IF;
  d:=pg_get_functiondef('public.rpc_confirm_bank_import_reviewed(uuid,uuid,bigint,uuid,text,jsonb,jsonb,jsonb,text)'::regprocedure);
  IF d NOT LIKE '%fn_ledger_writer_lock%' OR d NOT LIKE '%bank_import_opening%' OR d NOT LIKE '%bank_import_confirm_requests%' THEN
    RAISE EXCEPTION 'd4_requires_canonical_reviewed_confirm';
  END IF;
  d:=pg_get_functiondef('public.cfo_import_review_state(uuid,uuid,bigint)'::regprocedure);
  IF d NOT LIKE '%dated_opening_anchor%' OR d NOT LIKE '%review_hash%' THEN RAISE EXCEPTION 'd4_requires_canonical_review_state'; END IF;
  d:=pg_get_functiondef('public.rpc_create_business_wallet(uuid,bigint,text,jsonb,jsonb,jsonb)'::regprocedure);
  IF d NOT LIKE '%wallet_opening_balance%' OR d NOT LIKE '%financial_write_requests%' THEN RAISE EXCEPTION 'd4_requires_canonical_wallet_writer'; END IF;
END $$;

-- Standalone re-anchor of an existing wallet keeps its durable receipt with the other writers.
ALTER TABLE public.financial_write_requests DROP CONSTRAINT financial_write_requests_operation_check;
ALTER TABLE public.financial_write_requests ADD CONSTRAINT financial_write_requests_operation_check
  CHECK(operation IN ('wallet_create','transaction_batch','wallet_adjust','wallet_transfer','wallet_reanchor'));

-- ── Company time zone: strict IANA Area/Location allowlist (identical rule in JS) ──────────
-- POSIX-style names ('GMT+7', '+07:00') are refused: PostgreSQL reads them with the opposite sign.
CREATE FUNCTION public.cfo_business_tz(p_business uuid) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
  SELECT CASE
    WHEN b.timezone ~ '^[A-Z][A-Za-z]+/[A-Za-z_]+(/[A-Za-z_]+)?$' AND EXISTS(SELECT 1 FROM pg_timezone_names n WHERE n.name=b.timezone) THEN b.timezone
    WHEN b.country IN ('Singapore','SG') THEN 'Asia/Singapore'
    WHEN b.country IN ('Malaysia','MY') THEN 'Asia/Kuala_Lumpur'
    WHEN b.country IN ('Thailand','TH') THEN 'Asia/Bangkok'
    ELSE 'Asia/Jakarta' END
  FROM public.businesses b WHERE b.id=p_business
$$;

-- Anchor class of a ledger row. Pre-070 openings carry only source='wallet_opening_balance'.
CREATE FUNCTION public.cfo_ledger_anchor_class(p_source text,p_is_opening boolean) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
  SELECT CASE WHEN coalesce(p_is_opening,false) OR p_source='wallet_opening_balance' THEN 'opening'
    WHEN p_source='opening_reanchor' THEN 'reanchor'
    WHEN p_source='opening_reanchor_reversal' THEN 'reversal'
    WHEN p_source='bank_import_opening' THEN 'align' END
$$;

-- One wallet's ledger with effective dates. A legacy (undated) opening is dated by its creation
-- day in the company time zone -- at read time only, nothing is written.
CREATE FUNCTION public.cfo_wallet_ledger(p_business uuid,p_wallet uuid)
RETURNS TABLE(id bigint,eff date,signed numeric,cls text,undated boolean,invalid_native boolean,amount_idr numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
  SELECT t.id::bigint,
    CASE WHEN t.transaction_date IS NOT NULL THEN t.transaction_date
      WHEN public.cfo_ledger_anchor_class(t.source,t.is_opening_balance)='opening'
        THEN (t.created_at AT TIME ZONE public.cfo_business_tz(p_business))::date END,
    public.fn_ledger_signed(t.type,t.amount_original,t.amount_idr),
    public.cfo_ledger_anchor_class(t.source,t.is_opening_balance),
    t.transaction_date IS NULL,
    (t.currency_original IS NOT NULL AND upper(t.currency_original)<>upper(w.currency)) OR (t.amount_original IS NULL AND upper(w.currency)<>'IDR'),
    t.amount_idr
  FROM public.wallets w JOIN public.transactions t ON t.business_id=w.business_id
    AND (t.wallet_id=w.id OR (t.wallet_id IS NULL AND t.source=w.name))
  WHERE w.id=p_wallet AND w.business_id=p_business AND w.scope='business'
$$;

-- Active anchor (earliest-dated opening/re-anchor), the asserted balance α at its date, and the
-- rows that make history unknowable or ambiguous.
CREATE FUNCTION public.cfo_wallet_anchor_state(p_business uuid,p_wallet uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE a record; n_at_min integer; alpha numeric; legacy boolean; tz text; raw_tz text; r jsonb;
BEGIN
  tz:=public.cfo_business_tz(p_business);
  SELECT b.timezone INTO raw_tz FROM public.businesses b WHERE b.id=p_business;
  SELECT l.* INTO a FROM public.cfo_wallet_ledger(p_business,p_wallet) l
    WHERE l.cls IN ('opening','reanchor') AND l.eff IS NOT NULL ORDER BY l.eff, l.id LIMIT 1;
  r:=jsonb_build_object('tz',tz,'tz_fallback',raw_tz IS DISTINCT FROM tz,
    'today',(SELECT coalesce(sum(l.signed),0) FROM public.cfo_wallet_ledger(p_business,p_wallet) l)::text,
    'undated_other',(SELECT count(*) FROM public.cfo_wallet_ledger(p_business,p_wallet) l WHERE l.signed<>0 AND (l.eff IS NULL OR l.invalid_native)));
  IF a.id IS NULL THEN RETURN r||jsonb_build_object('anchor',NULL); END IF;
  SELECT count(*) INTO n_at_min FROM public.cfo_wallet_ledger(p_business,p_wallet) l WHERE l.cls IN ('opening','reanchor') AND l.eff=a.eff;
  legacy:=a.cls='opening' AND a.undated;
  SELECT a.signed+coalesce(sum(l.signed),0) INTO alpha FROM public.cfo_wallet_ledger(p_business,p_wallet) l
    WHERE l.id<>a.id AND l.eff IS NOT NULL AND l.eff<=a.eff AND coalesce(l.cls,'')<>'opening' AND coalesce(l.cls,'')<>'reanchor'
      AND (l.id<a.id OR (l.cls='align' AND l.eff=a.eff));
  RETURN r||jsonb_build_object('anchor',jsonb_build_object(
    'transaction_id',a.id,'date',a.eff,'amount',a.signed::text,'alpha',alpha::text,
    'date_source',CASE WHEN legacy THEN 'created_at' WHEN a.cls='reanchor' THEN 'reanchor' ELSE 'dated' END,
    'ambiguous',n_at_min>1,
    'backdated_rows',(SELECT count(*) FROM public.cfo_wallet_ledger(p_business,p_wallet) l WHERE l.cls IS NULL AND l.signed<>0 AND l.eff<=a.eff AND l.id>a.id),
    'backdated_sum',(SELECT coalesce(sum(l.signed),0) FROM public.cfo_wallet_ledger(p_business,p_wallet) l WHERE l.cls IS NULL AND l.eff<=a.eff AND l.id>a.id)::text,
    'same_day_rows',CASE WHEN legacy THEN (SELECT count(*) FROM public.cfo_wallet_ledger(p_business,p_wallet) l WHERE l.cls IS NULL AND l.signed<>0 AND l.eff=a.eff AND l.id>a.id) ELSE 0 END));
END $$;

-- The ONE re-anchor formula, used by preview, the reviewed import and the standalone repair.
-- p_extra: hypothetical rows not yet in the ledger, [{"date":"YYYY-MM-DD","signed":"123.45"}].
-- p_same_day ('covered' | 'after' | NULL) only matters for a legacy anchor.
--   y = α − Σ(rows with eff ≤ A, except the active anchor and same-day rows declared 'after')
-- After the reversal (−X at A) and y at S−1: balance(A) = α; every date after A is unchanged
-- except by α − balance_before(A); dates in [S−1, A] become α − Σ(movements after them).
CREATE FUNCTION public.cfo_reanchor_math(p_business uuid,p_wallet uuid,p_start date,p_extra jsonb,p_same_day text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE st jsonb; an jsonb; a_date date; a_id bigint; x numeric; alpha numeric; legacy boolean; m numeric; extra_le numeric; extra_all numeric;
  today numeric; y numeric; bal_s1 numeric; extra_s1 numeric; same_after boolean;
BEGIN
  st:=public.cfo_wallet_anchor_state(p_business,p_wallet); an:=st->'anchor';
  IF an IS NULL OR an='null'::jsonb THEN RAISE EXCEPTION 'import_opening_history_unknown: no opening anchor'; END IF;
  IF (an->>'ambiguous')::boolean THEN RAISE EXCEPTION 'import_opening_history_unknown: several anchors share one date'; END IF;
  IF (st->>'undated_other')::int>0 THEN RAISE EXCEPTION 'import_opening_history_unknown: undated rows in the ledger'; END IF;
  a_date:=(an->>'date')::date; a_id:=(an->>'transaction_id')::bigint; x:=(an->>'amount')::numeric; alpha:=(an->>'alpha')::numeric;
  legacy:=an->>'date_source'='created_at';
  IF p_same_day IS NOT NULL AND p_same_day NOT IN ('covered','after') THEN RAISE EXCEPTION 'import_reanchor_invalid: same_day'; END IF;
  same_after:=legacy AND p_same_day='after';
  IF p_start IS NULL OR p_start>a_date OR p_start-1<DATE '2000-01-01' THEN RAISE EXCEPTION 'import_reanchor_invalid: statement must start on or before the anchor date'; END IF;
  IF p_extra IS NULL OR jsonb_typeof(p_extra)<>'array' THEN RAISE EXCEPTION 'import_reanchor_invalid: extra'; END IF;
  IF legacy AND p_same_day IS NULL AND ((an->>'same_day_rows')::int>0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_extra) e WHERE (e->>'date')::date=a_date)) THEN
    RAISE EXCEPTION 'legacy_same_day_ambiguous: rows on the opening day need an explicit decision';
  END IF;
  SELECT coalesce(sum(l.signed),0) INTO m FROM public.cfo_wallet_ledger(p_business,p_wallet) l
    WHERE l.id<>a_id AND l.eff IS NOT NULL AND l.eff<=a_date AND NOT (same_after AND l.cls IS NULL AND l.eff=a_date AND l.id>a_id);
  SELECT coalesce(sum((e->>'signed')::numeric) FILTER(WHERE (e->>'date')::date<a_date OR ((e->>'date')::date=a_date AND NOT same_after)),0),
         coalesce(sum((e->>'signed')::numeric),0),
         coalesce(sum((e->>'signed')::numeric) FILTER(WHERE (e->>'date')::date<=p_start-1),0)
    INTO extra_le,extra_all,extra_s1 FROM jsonb_array_elements(p_extra) e;
  today:=(st->>'today')::numeric+extra_all;
  y:=alpha-(m+extra_le);
  SELECT coalesce(sum(l.signed),0) INTO bal_s1 FROM public.cfo_wallet_ledger(p_business,p_wallet) l WHERE l.eff IS NOT NULL AND l.eff<=p_start-1 AND l.id<>a_id;
  RETURN jsonb_build_object('anchor',an,'tz',st->'tz','tz_fallback',st->'tz_fallback',
    'new_anchor_date',p_start-1,'new_anchor_amount',y::text,'reversal_amount',(-x)::text,
    'today_before',today::text,'today_after',(today-x+y)::text,
    -- What the re-anchor itself changes in today's balance (pre-existing rows already inside the opening).
    'today_effect',(alpha-x-m)::text,'today_changes',(alpha-x-m)<>0,
    'balance_at_start_minus_1',(y+bal_s1+extra_s1)::text);
END $$;

-- Balance on any date (effective dates). Undated rows are excluded and counted, never guessed.
CREATE FUNCTION public.fn_wallet_balance_at(p_business uuid,p_wallet uuid,p_date date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
  SELECT jsonb_build_object('date',p_date,
    'balance',coalesce(sum(l.signed) FILTER(WHERE l.eff<=p_date),0)::text,
    'undated_rows',count(*) FILTER(WHERE l.eff IS NULL AND l.signed<>0),
    'anchor_date',min(l.eff) FILTER(WHERE l.cls IN ('opening','reanchor')),
    'defined',coalesce(min(l.eff) FILTER(WHERE l.cls IN ('opening','reanchor'))<=p_date,false))
  FROM public.cfo_wallet_ledger(p_business,p_wallet) l
$$;

-- Statement facts used by the guards: internal consistency and uncovered days up to the anchor.
CREATE FUNCTION public.cfo_statement_facts(p_business uuid,p_batch uuid,p_anchor date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
  SELECT jsonb_build_object(
    'consistent',CASE WHEN b.opening_balance IS NULL OR b.closing_balance IS NULL THEN NULL
      ELSE abs(b.opening_balance+coalesce((SELECT sum(CASE WHEN r.direction='out' THEN -r.amount ELSE r.amount END) FROM public.bank_import_rows r WHERE r.batch_id=b.id AND r.business_id=p_business),0)-b.closing_balance)
        < CASE WHEN upper(b.currency)='IDR' THEN 1 ELSE 0.01 END END,
    'gap_uncovered',p_anchor IS NOT NULL AND b.statement_end<p_anchor AND EXISTS(
      SELECT 1 FROM generate_series(b.statement_end+1,p_anchor,interval '1 day') d
      WHERE NOT EXISTS(SELECT 1 FROM public.bank_import_batches o WHERE o.business_id=p_business AND o.wallet_id=b.wallet_id AND o.id<>b.id
        AND o.status IN ('imported','partially_imported') AND d::date BETWEEN o.statement_start AND o.statement_end)))
  FROM public.bank_import_batches b WHERE b.id=p_batch AND b.business_id=p_business
$$;

-- ── Review state v3 (same signature; v2 keys preserved) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.cfo_import_review_state(p_business uuid,p_batch uuid,p_actor bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE b public.bank_import_batches; w public.wallets; role_name text; snapshot jsonb; ledger jsonb; rows jsonb; categories jsonb; counterparties jsonb;
  opening numeric; current_balance numeric; unknown_dates integer; anchored boolean; anc jsonb; a_date date; legacy boolean; covered jsonb; facts jsonb;
  preview jsonb; overlap integer; opening_state text; pending jsonb;
BEGIN
 SELECT CASE WHEN x.owner_user_id=p_actor THEN 'owner' ELSE m.role END INTO role_name
 FROM public.businesses x JOIN public.business_members m ON m.business_id=x.id AND m.user_id=p_actor AND m.status='active'
 WHERE x.id=p_business AND coalesce(x.type,'business')<>'personal' AND coalesce(x.status,'active')<>'archived';
 IF role_name IS NULL OR role_name NOT IN('owner','ceo','admin','cfo','accountant','auditor') OR role_name='owner' AND NOT EXISTS(SELECT 1 FROM public.businesses WHERE id=p_business AND owner_user_id=p_actor) THEN RAISE EXCEPTION 'import_review_forbidden'; END IF;
 SELECT * INTO b FROM public.bank_import_batches WHERE id=p_batch AND business_id=p_business;
 IF NOT FOUND THEN RAISE EXCEPTION 'batch_not_found'; END IF;
 SELECT * INTO w FROM public.wallets WHERE id=b.wallet_id AND business_id=p_business AND scope='business';
 IF NOT FOUND THEN RAISE EXCEPTION 'wallet_not_found'; END IF;
 IF upper(b.currency) IS DISTINCT FROM upper(w.currency) THEN RAISE EXCEPTION 'currency_mismatch'; END IF;
 IF b.statement_start IS NULL OR b.statement_end IS NULL OR b.statement_end<b.statement_start THEN RAISE EXCEPTION 'corrupt_statement_period'; END IF;
 IF EXISTS(SELECT 1 FROM public.bank_import_rows WHERE batch_id=b.id AND business_id IS DISTINCT FROM p_business) THEN RAISE EXCEPTION 'import_business_scope_required'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]'::jsonb) INTO rows FROM public.bank_import_rows r WHERE batch_id=b.id AND business_id=p_business;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) INTO ledger FROM public.transactions t WHERE t.business_id=p_business AND (t.wallet_id=w.id OR t.wallet_id IS NULL AND t.source=w.name);
 SELECT coalesce(sum(l.signed) FILTER(WHERE l.eff<b.statement_start),0),coalesce(sum(l.signed),0),
   count(*) FILTER(WHERE l.signed<>0 AND (l.eff IS NULL OR l.invalid_native))
 INTO opening,current_balance,unknown_dates FROM public.cfo_wallet_ledger(p_business,w.id) l;
 anc:=public.cfo_wallet_anchor_state(p_business,w.id);
 a_date:=(anc->'anchor'->>'date')::date; legacy:=anc->'anchor'->>'date_source'='created_at';
 anchored:=a_date IS NOT NULL AND a_date<b.statement_start AND NOT coalesce((anc->'anchor'->>'ambiguous')::boolean,false);
 -- Pending statement rows (not yet booked, linked, excluded or flagged as duplicates).
 SELECT coalesce(jsonb_agg(jsonb_build_object('date',r.tx_date,'signed',(CASE WHEN r.direction='out' THEN -r.amount ELSE r.amount END)::text)),'[]'::jsonb)
   INTO pending FROM public.bank_import_rows r WHERE r.batch_id=b.id AND r.business_id=p_business AND r.linked_transaction_id IS NULL
   AND coalesce(r.review_status,'') NOT IN ('excluded','imported','matched_existing') AND coalesce(r.match_status,'')<>'duplicate' AND r.tx_date IS NOT NULL;
 SELECT jsonb_build_object('rows',count(*) FILTER(WHERE (e->>'date')::date<=a_date),
   'signed_sum',coalesce(sum((e->>'signed')::numeric) FILTER(WHERE (e->>'date')::date<=a_date),0)::text,
   'same_day_rows',CASE WHEN legacy THEN count(*) FILTER(WHERE (e->>'date')::date=a_date) ELSE 0 END)
   INTO covered FROM jsonb_array_elements(pending) e;
 SELECT count(*) INTO overlap FROM jsonb_array_elements(pending) e WHERE EXISTS(SELECT 1 FROM public.bank_import_batches o
   WHERE o.business_id=p_business AND o.wallet_id=w.id AND o.id<>b.id AND o.status IN ('imported','partially_imported') AND (e->>'date')::date BETWEEN o.statement_start AND o.statement_end);
 facts:=public.cfo_statement_facts(p_business,b.id,a_date);
 opening_state:=CASE WHEN unknown_dates=0 AND anchored THEN 'known'
   WHEN unknown_dates=0 AND a_date IS NOT NULL AND NOT coalesce((anc->'anchor'->>'ambiguous')::boolean,false) AND (covered->>'rows')::int>0 THEN 'needs_anchor_choice'
   ELSE 'unknown' END;
 IF opening_state='needs_anchor_choice' THEN
   BEGIN preview:=public.cfo_reanchor_math(p_business,w.id,b.statement_start,pending,CASE WHEN (covered->>'same_day_rows')::int>0 OR (anc->'anchor'->>'same_day_rows')::int>0 THEN NULL ELSE 'covered' END);
   EXCEPTION WHEN raise_exception THEN preview:=jsonb_build_object('refused',split_part(SQLERRM,':',1)); END;
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]'::jsonb) INTO categories FROM public.cashflow_categories c WHERE c.business_id=p_business;
 SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]'::jsonb) INTO counterparties FROM public.counterparties c WHERE c.business_id=p_business;
 snapshot:=jsonb_build_object('version',3,'business_id',p_business,'batch',to_jsonb(b),'wallet',to_jsonb(w),'rows',rows,'ledger',ledger,
   'categories',categories,'counterparties',counterparties,'tz',anc->'tz');
 RETURN jsonb_build_object('review_hash',encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'),
  'batch_id',b.id,'wallet_id',w.id,'currency',w.currency,'recorded_before',opening::text,'current_balance',current_balance::text,
  'opening_state',opening_state,
  'historical_opening',CASE WHEN opening_state='known' THEN to_jsonb(opening::text) ELSE 'null'::jsonb END,
  'undated_or_invalid_native_rows',unknown_dates,'dated_opening_anchor',anchored,'correction_date',b.statement_start-1,
  'can_correct_opening',role_name IN('owner','ceo','admin','cfo'),
  'anchor',anc->'anchor','tz',anc->'tz','tz_fallback',anc->'tz_fallback','covered',covered,'overlap_rows',overlap,
  'statement_consistent',facts->'consistent','gap_uncovered',facts->'gap_uncovered','reanchor_preview',preview);
END $$;

-- ── Append the re-anchor (shared by the reviewed import and the standalone repair) ─────────
-- Runs inside the caller's transaction under fn_ledger_writer_lock. Any RAISE rolls back the
-- whole request (import rows included). Writes: reversal −X at A, new anchor y at S−1,
-- optional bank alignment at S−1, and one audit event. Refuses instead of guessing.
CREATE FUNCTION public.cfo_apply_reanchor(p_business uuid,p_wallet uuid,p_actor bigint,p_role text,p_batch uuid,p_opening jsonb,p_effect numeric,p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE company public.businesses; w public.wallets; b public.bank_import_batches; mth jsonb; an jsonb; facts jsonb; y numeric; x numeric; a_date date;
  rate numeric; rsrc text; y_idr numeric; rev_idr numeric; rev_id bigint; new_id bigint; align_id bigint; delta numeric; bal_s1 numeric;
  today_after numeric; today_pre numeric; reason text;
BEGIN
  IF p_role NOT IN ('owner','ceo','admin','cfo') THEN RAISE EXCEPTION 'import_opening_forbidden'; END IF;
  SELECT * INTO company FROM public.businesses WHERE id=p_business AND coalesce(type,'business')<>'personal' AND coalesce(status,'active')<>'archived';
  IF NOT FOUND THEN RAISE EXCEPTION 'import_review_forbidden'; END IF;
  SELECT * INTO w FROM public.wallets WHERE id=p_wallet AND business_id=p_business AND scope='business';
  IF NOT FOUND OR w.is_active=false THEN RAISE EXCEPTION 'wallet_not_found'; END IF;
  SELECT * INTO b FROM public.bank_import_batches WHERE id=p_batch AND business_id=p_business AND wallet_id=p_wallet;
  IF NOT FOUND THEN RAISE EXCEPTION 'batch_not_found'; END IF;
  IF jsonb_typeof(p_opening)<>'object' THEN RAISE EXCEPTION 'import_reanchor_invalid'; END IF;
  reason:=nullif(btrim(p_opening->>'reason'),'');
  IF reason IS NULL OR length(reason)>500 THEN RAISE EXCEPTION 'import_reanchor_invalid: reason required'; END IF;
  today_pre:=((public.cfo_wallet_anchor_state(p_business,p_wallet))->>'today')::numeric;
  mth:=public.cfo_reanchor_math(p_business,p_wallet,b.statement_start,'[]'::jsonb,p_opening->>'same_day');
  an:=mth->'anchor'; a_date:=(an->>'date')::date; x:=(an->>'amount')::numeric; y:=(mth->>'new_anchor_amount')::numeric;
  IF (an->>'transaction_id')::bigint IS DISTINCT FROM (p_opening->>'expected_anchor_id')::bigint
     OR y IS DISTINCT FROM (p_opening->>'expected_new_anchor')::numeric THEN
    RAISE EXCEPTION 'import_reanchor_conflict: the ledger changed since the preview';
  END IF;
  IF upper(w.currency)='IDR' THEN rate:=1; rsrc:='native';
  ELSE
    rate:=(p_opening->>'anchor_rate')::numeric; rsrc:=nullif(btrim(p_opening->>'anchor_rate_source'),'');
    IF rate IS NULL OR rate<=0 OR rate::text IN ('NaN','Infinity','-Infinity') OR rsrc IS NULL THEN RAISE EXCEPTION 'import_invalid_opening_valuation'; END IF;
  END IF;
  y_idr:=round(y*rate,2);
  SELECT -coalesce(t.amount_idr,t.amount_original) INTO rev_idr FROM public.transactions t WHERE t.id=(an->>'transaction_id')::bigint;
  INSERT INTO public.transactions(business_id,user_id,created_by_user_id,type,amount_original,currency_original,amount_idr,booked_rate,rate_source,
      description,source,wallet_id,scope,transaction_date,category)
    VALUES(p_business,company.owner_user_id,p_actor,'correction',-x,upper(w.currency),rev_idr,
      CASE WHEN x<>0 THEN abs(rev_idr/x) ELSE 1 END,'opening_reanchor_reversal',reason,'opening_reanchor_reversal',w.id,'business',a_date,'Opening balance')
    RETURNING id INTO rev_id;
  INSERT INTO public.transactions(business_id,user_id,created_by_user_id,type,amount_original,currency_original,amount_idr,booked_rate,rate_source,
      description,source,wallet_id,scope,transaction_date,category)
    VALUES(p_business,company.owner_user_id,p_actor,'correction',y,upper(w.currency),y_idr,rate,rsrc,reason,'opening_reanchor',w.id,'business',b.statement_start-1,'Opening balance')
    RETURNING id INTO new_id;
  bal_s1:=((public.fn_wallet_balance_at(p_business,p_wallet,b.statement_start-1))->>'balance')::numeric;
  IF p_opening ? 'align_target' AND p_opening->'align_target'<>'null'::jsonb THEN
    facts:=public.cfo_statement_facts(p_business,b.id,a_date);
    IF b.opening_balance IS NULL OR (p_opening->>'align_target')::numeric IS DISTINCT FROM b.opening_balance THEN RAISE EXCEPTION 'import_opening_conflict: bank opening balance not confirmed'; END IF;
    IF coalesce((facts->>'consistent')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'statement_inconsistent: opening + rows <> closing'; END IF;
    IF (facts->>'gap_uncovered')::boolean THEN RAISE EXCEPTION 'reanchor_gap_uncovered: no statement covers the days up to the opening date'; END IF;
    delta:=b.opening_balance-bal_s1;
    IF delta<>0 THEN
      INSERT INTO public.transactions(business_id,user_id,created_by_user_id,type,amount_original,currency_original,amount_idr,booked_rate,rate_source,
          description,source,wallet_id,scope,transaction_date,category)
        VALUES(p_business,company.owner_user_id,p_actor,'correction',delta,upper(w.currency),round(delta*rate,2),rate,rsrc,reason,'bank_import_opening',w.id,'business',b.statement_start-1,'Opening balance')
        RETURNING id INTO align_id;
    END IF;
  END IF;
  today_after:=((public.cfo_wallet_anchor_state(p_business,p_wallet))->>'today')::numeric;
  IF today_after IS DISTINCT FROM (p_opening->>'expected_today_after')::numeric THEN
    RAISE EXCEPTION 'import_reanchor_conflict: resulting balance differs from the confirmed one';
  END IF;
  IF p_effect IS NULL THEN RAISE EXCEPTION 'import_reanchor_invalid: effect'; END IF;
  IF p_effect+coalesce(delta,0)<>0 AND coalesce((p_opening->>'confirm_today_change')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'reanchor_changes_today_unconfirmed: the re-anchor changes the current balance by %',p_effect+coalesce(delta,0);
  END IF;
  INSERT INTO public.audit_events(business_id,actor_user_id,actor_role,entity_type,entity_id,action,request_id,before_json,after_json)
    VALUES(p_business,p_actor,p_role,'wallet',p_wallet::text,'opening_reanchored',p_request,
      jsonb_build_object('anchor',an,'balance_today',today_pre::text,'today_effect',(p_effect+coalesce(delta,0))::text),
      jsonb_build_object('reversal_transaction_id',rev_id,'anchor_transaction_id',new_id,'align_transaction_id',align_id,
        'anchor_date',b.statement_start-1,'anchor_amount',y::text,'delta_vs_statement',coalesce(delta,0)::text,
        'statement_batch_id',b.id,'balance_at_start_minus_1',((public.fn_wallet_balance_at(p_business,p_wallet,b.statement_start-1))->>'balance'),
        'balance_today_after',today_after::text,'same_day',p_opening->>'same_day','reason',reason));
  RETURN jsonb_build_object('reversal_transaction_id',rev_id,'anchor_transaction_id',new_id,'align_transaction_id',align_id,
    'anchor_date',b.statement_start-1,'anchor_amount',y::text,'delta',coalesce(delta,0)::text,
    'balance_today_before',today_pre::text,'balance_today_after',today_after::text,'today_effect',(p_effect+coalesce(delta,0))::text);
END $$;

-- ── Reviewed confirm v3 (same signature). Mode 'align' is the unchanged Codex path. ─────────
CREATE OR REPLACE FUNCTION public.rpc_confirm_bank_import_reviewed(
 p_business uuid,p_batch uuid,p_actor bigint,p_request_key uuid,p_review_hash text,p_intent jsonb,p_plan jsonb,p_opening jsonb DEFAULT NULL,p_flow text DEFAULT 'review')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE company public.businesses; member public.business_members; batch public.bank_import_batches; wallet public.wallets; role_name text; prior public.bank_import_confirm_requests; state jsonb; answer jsonb; raw_opening jsonb; delta numeric; expected numeric; target numeric; rate numeric; idr numeric; correction_id bigint; has_pending boolean; final_status text;
  mode text; a_date date; legacy boolean; same_day text; item jsonb; d date; covered integer:=0; reanchor jsonb; pre jsonb; extra jsonb:='[]'::jsonb;
BEGIN
 PERFORM public.fn_ledger_writer_lock();
 SELECT * INTO company FROM public.businesses WHERE id=p_business AND coalesce(type,'business')<>'personal' AND coalesce(status,'active')<>'archived' FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'import_review_forbidden'; END IF;
 SELECT * INTO member FROM public.business_members WHERE business_id=p_business AND user_id=p_actor AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'import_review_forbidden'; END IF;
 role_name:=CASE WHEN company.owner_user_id=p_actor THEN 'owner' ELSE member.role END;
 IF role_name IS NULL OR role_name NOT IN('owner','ceo','admin','cfo','accountant') OR role_name='owner' AND company.owner_user_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'import_review_forbidden'; END IF;
 IF p_request_key IS NULL OR p_review_hash IS NULL OR p_review_hash!~'^[a-f0-9]{64}$' OR jsonb_typeof(p_intent) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'import_invalid_request'; END IF;
 IF p_intent->>'review_hash' IS DISTINCT FROM p_review_hash OR p_intent->>'batch_id' IS DISTINCT FROM p_batch::text OR p_intent->>'operation' IS DISTINCT FROM 'bank_import_confirm' OR p_intent->'version' IS DISTINCT FROM '1'::jsonb THEN RAISE EXCEPTION 'import_invalid_request'; END IF;
 IF p_opening IS NOT NULL AND p_opening<>'null'::jsonb AND jsonb_typeof(p_opening)<>'object' THEN RAISE EXCEPTION 'import_invalid_request'; END IF;
 raw_opening:=CASE WHEN jsonb_typeof(p_opening)='object' THEN p_opening-ARRAY['booked_rate','amount_idr','rate_source','anchor_rate','anchor_rate_source'] ELSE 'null'::jsonb END;
 IF coalesce(p_intent->'opening','null'::jsonb) IS DISTINCT FROM raw_opening THEN RAISE EXCEPTION 'import_invalid_request'; END IF;
 SELECT * INTO prior FROM public.bank_import_confirm_requests WHERE business_id=p_business AND actor_user_id=p_actor AND request_key=p_request_key;
 IF FOUND THEN
  IF prior.batch_id IS DISTINCT FROM p_batch OR prior.intent IS DISTINCT FROM p_intent THEN RAISE EXCEPTION 'import_request_conflict'; END IF;
  RETURN prior.result||jsonb_build_object('replayed',true,'result_is_historical',true);
 END IF;
 IF p_plan IS NULL OR jsonb_typeof(p_plan)<>'array' OR jsonb_array_length(p_plan) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'invalid_plan'; END IF;
 SELECT * INTO batch FROM public.bank_import_batches WHERE id=p_batch AND business_id=p_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'batch_not_found'; END IF;
 IF batch.status IN('imported','cancelled') THEN RAISE EXCEPTION 'batch_closed'; END IF;
 SELECT * INTO wallet FROM public.wallets WHERE id=batch.wallet_id AND business_id=p_business AND scope='business' FOR UPDATE;
 IF NOT FOUND OR wallet.is_active=false THEN RAISE EXCEPTION 'wallet_not_found'; END IF;
 state:=public.cfo_import_review_state(p_business,p_batch,p_actor);
 IF state->>'review_hash' IS DISTINCT FROM p_review_hash THEN RAISE EXCEPTION 'import_review_conflict'; END IF;
 mode:=CASE WHEN jsonb_typeof(p_opening)='object' THEN coalesce(p_opening->>'mode','align') END;
 IF mode IS NOT NULL AND mode NOT IN ('align','reanchor') THEN RAISE EXCEPTION 'import_invalid_opening'; END IF;
 -- D4 guards on rows that would CREATE money (link/exclude never create it).
 a_date:=(state->'anchor'->>'date')::date; legacy:=state->'anchor'->>'date_source'='created_at';
 same_day:=CASE WHEN mode='reanchor' THEN p_opening->>'same_day' END;
 FOR item IN SELECT * FROM jsonb_array_elements(p_plan) LOOP
   CONTINUE WHEN coalesce(item->>'action','create')<>'create' OR item->>'expected_date' IS NULL;
   d:=(item->>'expected_date')::date;
   -- A booked twin (same day, amount, direction) in an overlapping imported statement whose
   -- dedup_hash differs (re-worded line): link or exclude it instead of booking it twice.
   IF EXISTS(SELECT 1 FROM public.bank_import_rows me JOIN public.bank_import_rows o ON o.business_id=p_business AND o.batch_id<>p_batch
       AND o.tx_date=d AND o.amount=me.amount AND o.direction=me.direction AND o.linked_transaction_id IS NOT NULL
       JOIN public.bank_import_batches ob ON ob.id=o.batch_id AND ob.wallet_id=wallet.id AND ob.status IN ('imported','partially_imported') AND d BETWEEN ob.statement_start AND ob.statement_end
       WHERE me.id=(item->>'row_id')::uuid AND me.batch_id=p_batch AND me.business_id=p_business) THEN
     RAISE EXCEPTION 'statement_overlap_unmatched: row dated % matches a booked line of an overlapping statement; link or exclude it',d;
   END IF;
   extra:=extra||jsonb_build_array(jsonb_build_object('date',d,'signed',public.fn_ledger_signed(item->>'type',(item->>'expected_amount')::numeric,NULL)::text));
   IF a_date IS NOT NULL AND (d<a_date OR d=a_date AND NOT (legacy AND same_day='after')) THEN
     IF legacy AND d=a_date AND same_day IS NULL THEN RAISE EXCEPTION 'legacy_same_day_ambiguous: rows on the opening day need an explicit decision'; END IF;
     covered:=covered+1;
   END IF;
 END LOOP;
 IF covered>0 AND mode IS DISTINCT FROM 'reanchor' THEN
   RAISE EXCEPTION 'import_before_opening_anchor: % row(s) fall on or before the opening balance date %',covered,a_date;
 END IF;
 IF mode='reanchor' AND covered=0 THEN RAISE EXCEPTION 'import_reanchor_invalid: no row falls before the opening balance date'; END IF;
 IF mode='align' THEN
  IF role_name NOT IN('owner','ceo','admin','cfo') THEN RAISE EXCEPTION 'import_opening_forbidden'; END IF;
  IF state->>'opening_state'<>'known' THEN RAISE EXCEPTION 'import_opening_history_unknown'; END IF;
  IF jsonb_typeof(p_opening)<>'object' OR nullif(btrim(p_opening->>'reason'),'') IS NULL OR length(p_opening->>'reason')>500 OR batch.opening_balance IS NULL THEN RAISE EXCEPTION 'import_invalid_opening'; END IF;
  expected:=(p_opening->>'expected_historical_opening')::numeric;target:=(p_opening->>'target_opening')::numeric;
  IF expected IS NULL OR target IS NULL OR expected::text IN('NaN','Infinity','-Infinity') OR target::text IN('NaN','Infinity','-Infinity') OR expected IS DISTINCT FROM (state->>'historical_opening')::numeric OR target IS DISTINCT FROM batch.opening_balance THEN RAISE EXCEPTION 'import_opening_conflict'; END IF;
  delta:=target-expected;
  IF delta<>0 THEN
   rate:=(p_opening->>'booked_rate')::numeric;idr:=(p_opening->>'amount_idr')::numeric;
   IF rate IS NULL OR rate<=0 OR rate::text IN('NaN','Infinity','-Infinity') OR idr IS NULL OR idr::text IN('NaN','Infinity','-Infinity') OR round(delta*rate,2) IS DISTINCT FROM idr OR nullif(btrim(p_opening->>'rate_source'),'') IS NULL OR upper(wallet.currency)='IDR' AND (rate<>1 OR idr<>delta) THEN RAISE EXCEPTION 'import_invalid_opening_valuation'; END IF;
   INSERT INTO public.transactions(business_id,user_id,created_by_user_id,type,amount_original,currency_original,amount_idr,booked_rate,rate_source,description,source,wallet_id,scope,transaction_date,category)
    VALUES(p_business,company.owner_user_id,p_actor,'correction',delta,upper(wallet.currency),idr,rate,p_opening->>'rate_source',p_opening->>'reason','bank_import_opening',wallet.id,'business',batch.statement_start-1,'Balance adjustment') RETURNING id INTO correction_id;
  END IF;
 ELSIF mode='reanchor' THEN
  IF role_name NOT IN('owner','ceo','admin','cfo') THEN RAISE EXCEPTION 'import_opening_forbidden'; END IF;
  -- Before the import: the same formula on the plan's rows gives the confirmed preview and the effect.
  pre:=public.cfo_reanchor_math(p_business,wallet.id,batch.statement_start,extra,same_day);
  IF (pre->>'new_anchor_amount')::numeric IS DISTINCT FROM (p_opening->>'expected_new_anchor')::numeric THEN
    RAISE EXCEPTION 'import_reanchor_conflict: the ledger changed since the preview';
  END IF;
 END IF;
 -- Raw rows need the existing provenance-eligible review state before creating
 -- their ledger link. This does not confirm or book any unselected row.
 UPDATE public.bank_import_rows SET review_status='needs_review' WHERE batch_id=p_batch AND business_id=p_business AND linked_transaction_id IS NULL AND review_status IS NULL;
 -- Preserve canonical compat provenance, validation, feedback and cumulative math.
 answer:=public.rpc_confirm_bank_import(p_business,p_batch,company.owner_user_id,p_actor,p_plan,p_flow);
 -- The re-anchor is computed from the rows actually booked; a mismatch rolls back the import too.
 IF mode='reanchor' THEN
  reanchor:=public.cfo_apply_reanchor(p_business,wallet.id,p_actor,role_name,p_batch,p_opening,(pre->>'today_effect')::numeric,p_request_key::text);
 END IF;
 -- A suggestion or a saved decision is not a completed ledger operation.
 -- Raw, confirmed and matched-but-unlinked rows remain pending until explicitly
 -- imported/linked or excluded. Preserve their original hints/decisions.
 SELECT EXISTS(SELECT 1 FROM public.bank_import_rows WHERE batch_id=p_batch AND business_id=p_business AND linked_transaction_id IS NULL AND review_status IS DISTINCT FROM 'excluded') INTO has_pending;
 final_status:=CASE WHEN has_pending THEN 'partially_imported' ELSE 'imported' END;
 UPDATE public.bank_import_batches SET status=final_status WHERE id=p_batch AND business_id=p_business;
 answer:=answer||jsonb_build_object('status',final_status);
 answer:=answer||jsonb_build_object('request_id',p_request_key,'batch_id',p_batch,'review_hash',p_review_hash,'opening',jsonb_build_object('state',state->>'opening_state','historical_before',state->'historical_opening','correction_id',correction_id,'delta',coalesce(delta,0)::text,'date',batch.statement_start-1,'mode',mode,'reanchor',reanchor),'result_is_historical',true);
 INSERT INTO public.bank_import_confirm_requests(business_id,actor_user_id,request_key,batch_id,intent,result) VALUES(p_business,p_actor,p_request_key,p_batch,p_intent,answer);
 INSERT INTO public.audit_events(business_id,actor_user_id,actor_role,entity_type,entity_id,action,request_id,after_json)
  VALUES(p_business,p_actor,role_name,'bank_import',p_batch::text,'import_confirmed',p_request_key::text,jsonb_build_object('result',answer,'intent',p_intent));
 RETURN answer;
END $$;

-- ── Standalone repair of an existing wallet (history already imported) ─────────────────────
-- p_intent: {version:1, operation:'wallet_reanchor', wallet_id, batch_id, opening:{...same shape as reanchor...}}
CREATE FUNCTION public.rpc_reanchor_wallet_opening(p_business uuid,p_wallet uuid,p_actor bigint,p_request_key text,p_intent jsonb,p_valuation jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE company public.businesses; member public.business_members; role_name text; prior public.financial_write_requests; w public.wallets; b public.bank_import_batches;
  st jsonb; a_date date; pre jsonb; res jsonb; answer jsonb; opening jsonb;
BEGIN
  PERFORM public.fn_ledger_writer_lock();
  SELECT * INTO company FROM public.businesses WHERE id=p_business AND coalesce(type,'business')<>'personal' AND coalesce(status,'active')<>'archived' FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'import_review_forbidden'; END IF;
  SELECT * INTO member FROM public.business_members WHERE business_id=p_business AND user_id=p_actor AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'import_review_forbidden'; END IF;
  role_name:=CASE WHEN company.owner_user_id=p_actor THEN 'owner' ELSE member.role END;
  IF role_name NOT IN ('owner','ceo','admin','cfo') THEN RAISE EXCEPTION 'import_opening_forbidden'; END IF;
  IF p_request_key IS NULL OR length(p_request_key) NOT BETWEEN 1 AND 128 OR jsonb_typeof(p_intent) IS DISTINCT FROM 'object'
     OR p_intent->>'operation' IS DISTINCT FROM 'wallet_reanchor' OR p_intent->'version' IS DISTINCT FROM '1'::jsonb
     OR p_intent->>'wallet_id' IS DISTINCT FROM p_wallet::text OR jsonb_typeof(p_intent->'opening')<>'object' THEN RAISE EXCEPTION 'import_invalid_request'; END IF;
  SELECT * INTO prior FROM public.financial_write_requests WHERE business_id=p_business AND actor_user_id=p_actor AND operation='wallet_reanchor' AND request_key=p_request_key;
  IF FOUND THEN
    IF prior.intent IS DISTINCT FROM p_intent THEN RAISE EXCEPTION 'import_request_conflict'; END IF;
    RETURN prior.result||jsonb_build_object('replayed',true,'result_is_historical',true);
  END IF;
  SELECT * INTO w FROM public.wallets WHERE id=p_wallet AND business_id=p_business AND scope='business' FOR UPDATE;
  IF NOT FOUND OR w.is_active=false THEN RAISE EXCEPTION 'wallet_not_found'; END IF;
  SELECT * INTO b FROM public.bank_import_batches WHERE id=(p_intent->>'batch_id')::uuid AND business_id=p_business AND wallet_id=p_wallet
    AND status IN ('imported','partially_imported') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'batch_not_found'; END IF;
  st:=public.cfo_wallet_anchor_state(p_business,p_wallet); a_date:=(st->'anchor'->>'date')::date;
  IF a_date IS NULL OR b.statement_start>a_date THEN RAISE EXCEPTION 'import_reanchor_invalid: the statement does not start before the opening date'; END IF;
  IF EXISTS(SELECT 1 FROM public.bank_import_batches o WHERE o.business_id=p_business AND o.wallet_id=p_wallet AND o.id<>b.id
      AND o.status IN ('imported','partially_imported') AND o.statement_start<b.statement_start) THEN
    RAISE EXCEPTION 'import_reanchor_invalid: choose the earliest imported statement of this account';
  END IF;
  opening:=(p_intent->'opening')||coalesce(p_valuation,'{}'::jsonb);
  pre:=public.cfo_reanchor_math(p_business,p_wallet,b.statement_start,'[]'::jsonb,opening->>'same_day');
  res:=public.cfo_apply_reanchor(p_business,p_wallet,p_actor,role_name,b.id,opening,(pre->>'today_effect')::numeric,p_request_key);
  answer:=jsonb_build_object('ok',true,'wallet_id',p_wallet,'batch_id',b.id,'reanchor',res,'result_is_historical',true);
  INSERT INTO public.financial_write_requests(business_id,actor_user_id,operation,request_key,intent,result) VALUES(p_business,p_actor,'wallet_reanchor',p_request_key,p_intent,answer);
  RETURN answer;
END $$;

-- ── Read-only diagnostics (no writes; for existing accounts: detect, never repair) ─────────
CREATE FUNCTION public.rpc_wallet_reconciliation(p_business uuid,p_wallet uuid,p_actor bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE role_name text; st jsonb; a_date date; statements jsonb; n_overlaps integer;
BEGIN
  SELECT CASE WHEN x.owner_user_id=p_actor THEN 'owner' ELSE m.role END INTO role_name
  FROM public.businesses x JOIN public.business_members m ON m.business_id=x.id AND m.user_id=p_actor AND m.status='active'
  WHERE x.id=p_business AND coalesce(x.type,'business')<>'personal' AND coalesce(x.status,'active')<>'archived';
  IF role_name IS NULL OR role_name NOT IN ('owner','ceo','admin','cfo','accountant','auditor') THEN RAISE EXCEPTION 'import_review_forbidden'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.wallets WHERE id=p_wallet AND business_id=p_business AND scope='business') THEN RAISE EXCEPTION 'wallet_not_found'; END IF;
  st:=public.cfo_wallet_anchor_state(p_business,p_wallet); a_date:=(st->'anchor'->>'date')::date;
  SELECT coalesce(jsonb_agg(jsonb_build_object('batch_id',b.id,'start',b.statement_start,'end',b.statement_end,
      'bank_opening',b.opening_balance::text,'bank_closing',b.closing_balance::text,'before_anchor',a_date IS NOT NULL AND b.statement_start<=a_date,
      'consistent',(public.cfo_statement_facts(p_business,b.id,a_date))->'consistent',
      'ledger_at_start_minus_1',bs->>'balance','ledger_at_end',be->>'balance',
      'delta_start',CASE WHEN b.opening_balance IS NOT NULL AND (bs->>'defined')::boolean THEN (b.opening_balance-(bs->>'balance')::numeric)::text END,
      'delta_end',CASE WHEN b.closing_balance IS NOT NULL AND (be->>'defined')::boolean THEN (b.closing_balance-(be->>'balance')::numeric)::text END)
    ORDER BY b.statement_start),'[]'::jsonb) INTO statements
  FROM public.bank_import_batches b
  CROSS JOIN LATERAL (SELECT public.fn_wallet_balance_at(p_business,p_wallet,b.statement_start-1) AS bs) s1
  CROSS JOIN LATERAL (SELECT public.fn_wallet_balance_at(p_business,p_wallet,b.statement_end) AS be) s2
  WHERE b.business_id=p_business AND b.wallet_id=p_wallet AND b.status IN ('imported','partially_imported') AND b.statement_start IS NOT NULL AND b.statement_end IS NOT NULL;
  SELECT count(*) INTO n_overlaps FROM public.bank_import_batches b1 JOIN public.bank_import_batches b2 ON b1.wallet_id=b2.wallet_id AND b1.id<b2.id
    AND b1.status IN ('imported','partially_imported') AND b2.status IN ('imported','partially_imported')
    AND b1.statement_start<=b2.statement_end AND b2.statement_start<=b1.statement_end
  WHERE b1.business_id=p_business AND b2.business_id=p_business AND b1.wallet_id=p_wallet;
  RETURN jsonb_build_object('wallet_id',p_wallet,'today',st->'today','anchor',st->'anchor','tz',st->'tz','tz_fallback',st->'tz_fallback',
    'undated_rows',st->'undated_other','statements',statements,'overlapping_statements',n_overlaps,
    'risks',jsonb_build_object(
      'import_before_anchor',EXISTS(SELECT 1 FROM jsonb_array_elements(statements) e WHERE (e->>'before_anchor')::boolean),
      'backdated_rows',coalesce((st->'anchor'->>'backdated_rows')::int,0),
      'same_day_rows',coalesce((st->'anchor'->>'same_day_rows')::int,0),
      'mismatched_statements',(SELECT count(*) FROM jsonb_array_elements(statements) e WHERE coalesce((e->>'delta_start')::numeric,0)<>0 OR coalesce((e->>'delta_end')::numeric,0)<>0)));
END $$;

-- ── Wallet create: an optional dated opening (unchanged behaviour without a date) ──────────
CREATE OR REPLACE FUNCTION public.rpc_create_business_wallet(
  p_business_id uuid,p_user_id bigint,p_request_key text,p_intent jsonb,p_wallet jsonb,p_opening jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE prior public.financial_write_requests; w public.wallets; t public.transactions; answer jsonb; owner_id bigint; local_today date;
BEGIN
  PERFORM public.fn_ledger_writer_lock();
  PERFORM public.fn_balance_actor(p_business_id,p_user_id);
  SELECT owner_user_id INTO owner_id FROM businesses WHERE id=p_business_id AND
    (owner_user_id=p_user_id OR EXISTS(SELECT 1 FROM business_members m WHERE m.business_id=p_business_id
      AND m.user_id=p_user_id AND m.status='active' AND m.role IN ('owner','ceo','admin','cfo')));
  IF NOT FOUND THEN RAISE EXCEPTION 'business_write_forbidden: Wallet management role required'; END IF;
  IF p_request_key IS NULL OR length(p_request_key) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'idempotency_key_required: Keep a stable request key for this create intent';
  END IF;
  SELECT * INTO prior FROM financial_write_requests WHERE business_id=p_business_id AND actor_user_id=p_user_id
    AND operation='wallet_create' AND request_key=p_request_key;
  IF FOUND THEN
    IF prior.intent IS DISTINCT FROM p_intent THEN RAISE EXCEPTION 'idempotency_key_mismatch: Request key already used'; END IF;
    SELECT * INTO w FROM wallets WHERE id=(prior.result->'wallet'->>'id')::uuid AND business_id=p_business_id;
    RETURN prior.result || jsonb_build_object('is_replay',true,'result_is_historical',true,
      'object_state',CASE WHEN NOT FOUND THEN 'removed' WHEN w.is_active=false THEN 'archived' ELSE 'active' END);
  END IF;
  IF p_wallet->>'scope' IS DISTINCT FROM 'business' OR nullif(btrim(p_wallet->>'name'),'') IS NULL THEN
    RAISE EXCEPTION 'wallet_scope_mismatch: A named Business wallet is required';
  END IF;
  INSERT INTO wallets(business_id,user_id,name,currency,type,entity_name,color,sort_order,scope)
    VALUES(p_business_id,owner_id,p_wallet->>'name',upper(p_wallet->>'currency'),p_wallet->>'type',
      p_wallet->>'entity_name',p_wallet->>'color',COALESCE((p_wallet->>'sort_order')::int,0),'business') RETURNING * INTO w;
  IF p_opening IS NOT NULL AND p_opening<>'null'::jsonb THEN
    t:=jsonb_populate_record(NULL::public.transactions,p_opening);
    IF t.currency_original IS DISTINCT FROM w.currency OR t.amount_original IS NULL OR t.amount_original<=0
      OR t.type NOT IN ('income','expense') OR t.amount_original::text IN ('NaN','Infinity','-Infinity')
      OR t.amount_original<>(p_opening->>'amount_original')::numeric THEN
      RAISE EXCEPTION 'invalid_opening_balance: Explicit native opening amount/currency required';
    END IF;
    -- A dated opening = the balance at the END of that day (UI: "balance at the start of day D" -> D-1).
    local_today:=(now() AT TIME ZONE public.cfo_business_tz(p_business_id))::date;
    IF t.transaction_date IS NOT NULL AND (t.transaction_date>local_today OR t.transaction_date<DATE '2000-01-01') THEN
      RAISE EXCEPTION 'invalid_opening_balance: Opening date must be between 2000-01-01 and today';
    END IF;
    INSERT INTO transactions(business_id,user_id,created_by_user_id,type,amount_original,currency_original,amount_idr,
      booked_rate,rate_source,category,description,source,is_opening_balance,wallet_id,scope,transaction_date)
      VALUES(p_business_id,owner_id,p_user_id,t.type,t.amount_original,t.currency_original,t.amount_idr,
        t.booked_rate,t.rate_source,'Opening balance',t.description,'wallet_opening_balance',true,w.id,'business',t.transaction_date);
  END IF;
  answer:=jsonb_build_object('wallet',to_jsonb(w));
  INSERT INTO financial_write_requests VALUES(p_business_id,p_user_id,'wallet_create',p_request_key,p_intent,answer,now());
  RETURN answer;
END $$;

REVOKE ALL ON FUNCTION public.cfo_business_tz(uuid),public.cfo_ledger_anchor_class(text,boolean),public.cfo_wallet_ledger(uuid,uuid),
  public.cfo_wallet_anchor_state(uuid,uuid),public.cfo_reanchor_math(uuid,uuid,date,jsonb,text),public.fn_wallet_balance_at(uuid,uuid,date),
  public.cfo_statement_facts(uuid,uuid,date),public.cfo_apply_reanchor(uuid,uuid,bigint,text,uuid,jsonb,numeric,text),
  public.rpc_reanchor_wallet_opening(uuid,uuid,bigint,text,jsonb,jsonb),public.rpc_wallet_reconciliation(uuid,uuid,bigint),
  public.cfo_import_review_state(uuid,uuid,bigint),public.rpc_confirm_bank_import_reviewed(uuid,uuid,bigint,uuid,text,jsonb,jsonb,jsonb,text),
  public.rpc_create_business_wallet(uuid,bigint,text,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cfo_business_tz(uuid),public.cfo_ledger_anchor_class(text,boolean),public.cfo_wallet_ledger(uuid,uuid),
  public.cfo_wallet_anchor_state(uuid,uuid),public.cfo_reanchor_math(uuid,uuid,date,jsonb,text),public.fn_wallet_balance_at(uuid,uuid,date),
  public.cfo_statement_facts(uuid,uuid,date),public.cfo_apply_reanchor(uuid,uuid,bigint,text,uuid,jsonb,numeric,text),
  public.rpc_reanchor_wallet_opening(uuid,uuid,bigint,text,jsonb,jsonb),public.rpc_wallet_reconciliation(uuid,uuid,bigint),
  public.cfo_import_review_state(uuid,uuid,bigint),public.rpc_confirm_bank_import_reviewed(uuid,uuid,bigint,uuid,text,jsonb,jsonb,jsonb,text),
  public.rpc_create_business_wallet(uuid,bigint,text,jsonb,jsonb,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
