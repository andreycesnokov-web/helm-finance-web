-- Preflight / Postflight for migrations 035–036 (run manually in Supabase).
-- NOT a migration. No DDL. Read-only checks.
-- Order: 035_document_audit.sql  →  036_document_audit_rpc.sql
-- 036 depends on 035 (it has an explicit guard that aborts if document_audit is absent).

-- ════════════════ PREFLIGHT (run BEFORE applying 035) ════════════════════════
-- 1. 031 must already be applied (financial_documents present).
SELECT 'financial_documents present (031)' AS check,
  (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='financial_documents') AS value;  -- expect 1

-- 2. New objects must NOT exist yet (clean target).
SELECT 'document_audit absent' AS check,
  (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='document_audit') AS value  -- expect 0
UNION ALL SELECT 'no rpc_document_* yet',
  (SELECT count(*) FROM information_schema.routines WHERE routine_schema='public' AND routine_name LIKE 'rpc_document_%');  -- expect 0

-- ════════════════ POSTFLIGHT (run AFTER applying 035 then 036) ═══════════════
-- 3. Audit table + append-only trigger.
SELECT 'document_audit table' AS check,
  (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='document_audit')::text AS value  -- 1
UNION ALL SELECT 'append-only trigger',
  (SELECT count(*) FROM information_schema.triggers WHERE trigger_name='document_audit_append_only')::text  -- >=1
UNION ALL SELECT 'rpc functions (expect 5)',
  (SELECT count(*) FROM information_schema.routines WHERE routine_schema='public' AND routine_name LIKE 'rpc_document_%')::text  -- 5
UNION ALL SELECT 'EXECUTE not granted to PUBLIC (expect 0)',
  (SELECT count(*) FROM information_schema.routine_privileges WHERE grantee='PUBLIC' AND routine_name LIKE 'rpc_document_%')::text;  -- 0

-- 4. Every rpc_document_* function has a fixed search_path (no shadowing).
SELECT proname, proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname LIKE 'rpc_document_%' ORDER BY 1;  -- proconfig must include search_path=...

-- 5. None of the functions are SECURITY DEFINER (prosecdef must be false).
SELECT proname, prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname LIKE 'rpc_document_%' ORDER BY 1;  -- prosecdef = false for all

-- ════════════════ ROLLBACK / STOP CONDITIONS ════════════════════════════════
-- These migrations are ADDITIVE; there is no destructive change to roll back.
-- STOP immediately and do NOT proceed to 036 if:
--   • preflight #1 shows financial_documents absent (031 not applied);
--   • applying 035 errors, or document_audit already exists with a different shape;
--   • applying 036 raises '036 requires migration 035' (035 not applied first);
--   • postflight #3 shows rpc count <> 5, or PUBLIC still has EXECUTE (#0 <> 0);
--   • postflight #5 shows any prosecdef = true (unexpected SECURITY DEFINER);
--   • any existing wallet balance, transaction count or debt amount changes
--     (must be ZERO — these migrations touch only document/audit objects).
-- To undo in a NON-PRODUCTION env: DROP the rpc_document_* functions and the
-- document_audit table (additive objects only). Never drop 031–034 objects.
