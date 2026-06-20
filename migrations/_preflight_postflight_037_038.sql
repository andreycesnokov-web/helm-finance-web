-- Preflight / Postflight for migrations 037–038 (run manually in Supabase).
-- NOT a migration. No DDL. Read-only checks. Order: 037 → 038 (038 needs 037).
-- These are ADDITIVE; nothing existing is modified. NOT YET APPLIED to production.

-- ════════════════ PREFLIGHT (run BEFORE applying 037) ════════════════════════
-- 1. Dependencies present.
SELECT 'businesses' AS dep, (to_regclass('public.businesses') IS NOT NULL)::text AS present
UNION ALL SELECT 'businesses.type column', (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='businesses' AND column_name='type'))::text
UNION ALL SELECT 'wallets (id uuid)', (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='wallets' AND column_name='id' AND data_type='uuid'))::text
UNION ALL SELECT 'transactions', (to_regclass('public.transactions') IS NOT NULL)::text
UNION ALL SELECT 'financial_documents (031)', (to_regclass('public.financial_documents') IS NOT NULL)::text
UNION ALL SELECT 'business_members', (to_regclass('public.business_members') IS NOT NULL)::text
UNION ALL SELECT 'service_role exists', (EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role'))::text;

-- 2. New objects must NOT exist yet (clean target).
SELECT 'funding tables present (expect 0)' AS check, count(*)::text AS value
  FROM information_schema.tables WHERE table_schema='public' AND table_name IN
   ('user_workspace_preferences','personal_business_relationships','personal_business_relationship_roles',
    'funding_transfers','funding_repayments','funding_audit')
UNION ALL SELECT 'funding rpc/fn present (expect 0)',
  count(*)::text FROM information_schema.routines WHERE routine_schema='public'
   AND (routine_name LIKE 'rpc_%funding%' OR routine_name LIKE 'rpc_%connection%' OR routine_name IN ('fn_funding_leg','fn_wallet_check','fn_is_workspace_type'));

-- 3. Baseline financial counts (record; must be UNCHANGED after 037/038 — these
--    are pure schema migrations, no data/cash change).
SELECT
 (SELECT count(*) FROM transactions)        AS transactions,
 (SELECT count(*) FROM wallets)             AS wallets,
 (SELECT count(*) FROM businesses)          AS businesses,
 (SELECT count(*) FROM businesses WHERE type='personal') AS personal_workspaces;

-- ════════════════ POSTFLIGHT (run AFTER applying 037 then 038) ═══════════════
-- 4. Object inventory.
SELECT 'funding tables (expect 6)' AS check, count(*)::text AS value FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN
   ('user_workspace_preferences','personal_business_relationships','personal_business_relationship_roles',
    'funding_transfers','funding_repayments','funding_audit')
UNION ALL SELECT 'view personal_funding_balances (expect 1)',
  count(*)::text FROM information_schema.views WHERE table_schema='public' AND table_name='personal_funding_balances'
UNION ALL SELECT 'rpc functions (expect 7)',
  count(*)::text FROM information_schema.routines WHERE routine_schema='public'
   AND (routine_name LIKE 'rpc_%funding%' OR routine_name LIKE 'rpc_%connection%')
UNION ALL SELECT 'append-only guards (audit) (expect 1)',
  count(*)::text FROM information_schema.triggers WHERE trigger_schema='public' AND trigger_name='funding_audit_append_only'
UNION ALL SELECT 'personal owner-only guard on business_members (expect 1)',
  count(*)::text FROM information_schema.triggers WHERE trigger_schema='public' AND trigger_name='trg_personal_owner_only'
UNION ALL SELECT 'PUBLIC execute on funding fns (MUST be 0)',
  count(*)::text FROM information_schema.routine_privileges WHERE grantee='PUBLIC'
   AND (routine_name LIKE 'rpc_%funding%' OR routine_name LIKE 'rpc_%connection%' OR routine_name IN ('fn_funding_leg','fn_wallet_check','fn_is_workspace_type'));

-- 5. Security: no SECURITY DEFINER, fixed search_path on every funding function.
SELECT proname, prosecdef, proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND (proname LIKE 'rpc_%funding%' OR proname LIKE 'rpc_%connection%'
   OR proname IN ('fn_funding_leg','fn_wallet_check','fn_is_workspace_type','fn_uwp_type_guard',
                  'fn_pbr_type_guard','fn_funding_type_guard','fn_funding_audit_no_mutate','fn_personal_owner_only_membership'))
 ORDER BY 1;  -- prosecdef must be false; proconfig must include search_path

-- 6. No new triggers on the cash/ledger tables EXCEPT the intentional personal
--    owner-only guard on business_members.
SELECT event_object_table, trigger_name FROM information_schema.triggers
 WHERE trigger_schema='public' AND event_object_table IN ('transactions','wallets','debts','business_members')
 ORDER BY 1, 2;  -- expect only trg_personal_owner_only on business_members from this pair

-- ════════════════ ROLLBACK / STOP CONDITIONS ════════════════════════════════
-- Additive only — nothing destructive to roll back. STOP and do NOT proceed if:
--   • any preflight dependency is absent, or service_role is missing;
--   • preflight #2 shows funding objects already exist with a different shape;
--   • applying 038 raises '038 requires migration 037';
--   • postflight #4 rpc count <> 7, or PUBLIC execute <> 0;
--   • postflight #5 shows any prosecdef = true (unexpected SECURITY DEFINER) or a
--     funding function without a fixed search_path;
--   • postflight #6 shows any NEW trigger on transactions/wallets/debts (none
--     expected — only business_members.trg_personal_owner_only is intended);
--   • baseline transaction/wallet/business counts changed (must be ZERO change).
-- Undo in NON-PRODUCTION only: DROP the rpc_*/fn_* funding functions, the
-- personal_funding_balances view, and the six new tables. Never touch 031–036.
