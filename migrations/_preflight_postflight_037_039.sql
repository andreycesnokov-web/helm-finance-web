-- Preflight / Postflight for migrations 037–039 (run manually in Supabase).
-- NOT a migration. Read-only. Order: 037 → 038 → 039. NOT YET APPLIED to production.
-- 037 contains ONE type-widening ALTER (transactions.amount_original/amount_idr → NUMERIC(38,18));
-- everything else is purely additive. Stop for approval before applying.

-- ════════════════ PREFLIGHT (before 037) ════════════════════════════════════
SELECT 'businesses.type' AS dep, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='businesses' AND column_name='type'))::text AS present
UNION ALL SELECT 'businesses.base_currency', (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='businesses' AND column_name='base_currency'))::text
UNION ALL SELECT 'wallets', (to_regclass('public.wallets') IS NOT NULL)::text
UNION ALL SELECT 'transactions', (to_regclass('public.transactions') IS NOT NULL)::text
UNION ALL SELECT 'financial_documents (031)', (to_regclass('public.financial_documents') IS NOT NULL)::text
UNION ALL SELECT 'service_role', (EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role'))::text;

-- Current money column types (record — 037 widens these).
SELECT column_name, data_type, numeric_precision, numeric_scale FROM information_schema.columns
 WHERE table_schema='public' AND table_name='transactions' AND column_name IN ('amount_original','amount_idr') ORDER BY 1;

-- New objects must be absent (clean target).
SELECT 'new funding/fx tables (expect 0)' AS check, count(*)::text AS value FROM information_schema.tables
 WHERE table_schema='public' AND table_name IN ('user_workspace_preferences','personal_business_relationships','personal_business_relationship_roles','exchange_rate_quotes','fx_conversions','funding_transfers','funding_repayments','funding_audit')
UNION ALL SELECT 'new rpc/fn (expect 0)', count(*)::text FROM information_schema.routines WHERE routine_schema='public'
 AND (routine_name LIKE 'rpc_%funding%' OR routine_name LIKE 'rpc_%connection%' OR routine_name LIKE 'rpc_%fx%' OR routine_name LIKE 'rpc_%wallet_transfer%' OR routine_name IN ('fn_fund_leg','fn_wallet_asset_check','fn_is_workspace_type'));

-- Baseline counts (MUST be unchanged after 037–039 — schema-only).
SELECT (SELECT count(*) FROM transactions) AS transactions, (SELECT count(*) FROM wallets) AS wallets,
       (SELECT count(*) FROM businesses) AS businesses, (SELECT count(*) FROM businesses WHERE type='personal') AS personal_ws;

-- ════════════════ POSTFLIGHT (after 037 → 038 → 039) ════════════════════════
-- Precision widened, legacy values intact.
SELECT 'amount_original scale (expect 18)' AS check, (SELECT numeric_scale::text FROM information_schema.columns WHERE table_name='transactions' AND column_name='amount_original') AS value
UNION ALL SELECT 'wallets.asset_code present', (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='wallets' AND column_name='asset_code'))::text
UNION ALL SELECT 'funding/fx tables (expect 8)', (SELECT count(*)::text FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('user_workspace_preferences','personal_business_relationships','personal_business_relationship_roles','exchange_rate_quotes','fx_conversions','funding_transfers','funding_repayments','funding_audit'))
UNION ALL SELECT 'view personal_funding_balances (1)', (SELECT count(*)::text FROM information_schema.views WHERE table_name='personal_funding_balances')
UNION ALL SELECT 'rpc functions (expect 10)', (SELECT count(*)::text FROM information_schema.routines WHERE routine_schema='public' AND routine_name LIKE 'rpc_%' AND (routine_name LIKE '%funding%' OR routine_name LIKE '%connection%' OR routine_name LIKE '%fx%' OR routine_name LIKE '%wallet_transfer%'))
UNION ALL SELECT 'PUBLIC execute on fns (MUST be 0)', (SELECT count(*)::text FROM information_schema.routine_privileges WHERE grantee='PUBLIC' AND routine_name LIKE 'rpc_%' AND (routine_name LIKE '%funding%' OR routine_name LIKE '%connection%' OR routine_name LIKE '%fx%' OR routine_name LIKE '%wallet_transfer%'))
UNION ALL SELECT 'append-only audit guard (1)', (SELECT count(*)::text FROM information_schema.triggers WHERE trigger_name='funding_audit_append_only')
UNION ALL SELECT 'personal owner-only guard (1)', (SELECT count(*)::text FROM information_schema.triggers WHERE trigger_name='trg_personal_owner_only')
UNION ALL SELECT 'wallet asset-immutable guard (1)', (SELECT count(*)::text FROM information_schema.triggers WHERE trigger_name='trg_wallet_asset_immutable');

-- Security: no SECURITY DEFINER, fixed search_path on every funding/fx function.
SELECT proname, prosecdef, proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND (proname LIKE 'rpc_%funding%' OR proname LIKE 'rpc_%connection%' OR proname LIKE 'rpc_%fx%' OR proname LIKE 'rpc_%wallet_transfer%' OR proname LIKE 'fn_%fund%' OR proname IN ('fn_wallet_asset_check','fn_is_workspace_type'))
 ORDER BY 1;  -- prosecdef=false; proconfig must include search_path

-- No NEW triggers on cash tables except the two intended guards
-- (business_members.trg_personal_owner_only, wallets.trg_wallet_asset_immutable).
SELECT event_object_table, trigger_name FROM information_schema.triggers
 WHERE trigger_schema='public' AND event_object_table IN ('transactions','wallets','debts','business_members') ORDER BY 1,2;

-- ════════════════ ROLLBACK / STOP CONDITIONS ════════════════════════════════
-- STOP and do not proceed if:
--   • any preflight dependency absent / service_role missing;
--   • funding/fx objects already exist with a different shape;
--   • applying 038/039 raises a dependency error;
--   • postflight precision scale <> 18, or legacy transaction values changed;
--   • rpc count <> 10, PUBLIC execute <> 0, any prosecdef=true, or any function
--     without a fixed search_path;
--   • any NEW trigger on transactions/wallets/debts beyond the two intended guards;
--   • baseline transaction/wallet/business counts changed (must be ZERO change).
-- The precision ALTER is non-lossy but rewrites the table — schedule a low-traffic
-- window and confirm row counts before/after. Additive objects can be DROPped to
-- undo in NON-PRODUCTION only; never touch 031–036.
