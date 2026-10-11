-- READ ONLY. Counts/catalog only; no real amounts, descriptions or documents.
-- Run against staging only after its owner authorizes that separate read.
BEGIN TRANSACTION READ ONLY;
SELECT current_setting('server_version') AS postgres_version;
DO $$ DECLARE rows jsonb; BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE NOTICE 'Migration history missing: resolve deployment mechanism before any apply';
  ELSE
    EXECUTE 'SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations' INTO rows;
    RAISE NOTICE 'Migration versions: %',rows;
  END IF;
END $$;
SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND NOT t.tgisinternal AND (t.tgname LIKE '%balance%' OR t.tgname LIKE '%gate%' OR t.tgname LIKE '%provenance%' OR t.tgname LIKE '%import_pair%' OR t.tgname LIKE '%metadata%') ORDER BY c.relname,t.tgname;
SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,p.prosecdef AS security_definer,
  p.proconfig,p.proacl,
  CASE WHEN l.lanname='plpgsql' THEN position('fn_ledger_writer_lock' in pg_get_functiondef(p.oid))>0 END AS mentions_gate
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE n.nspname='public' AND (p.proname LIKE 'rpc_%' OR p.proname LIKE 'fn_%balance%' OR p.proname LIKE 'fn_%import%') ORDER BY p.proname;
SELECT table_name,column_name,data_type,is_nullable,numeric_precision,numeric_scale
 FROM information_schema.columns WHERE table_schema='public' AND table_name IN
 ('wallets','transactions','debts','bank_import_batches','bank_import_rows','financial_write_requests') ORDER BY table_name,ordinal_position;
SELECT business_id,name,count(*) AS wallet_name_duplicates FROM wallets WHERE business_id IS NOT NULL GROUP BY business_id,name HAVING count(*)>1;
SELECT count(*) AS orphan_wallets FROM wallets WHERE business_id IS NULL;
SELECT count(*) AS legacy_null_wallet FROM transactions WHERE wallet_id IS NULL AND source IS NOT NULL;
SELECT count(*) AS ambiguous_legacy_bindings FROM transactions t WHERE t.wallet_id IS NULL AND
  (SELECT count(*) FROM wallets w WHERE w.business_id=t.business_id AND w.name=t.source)>1;
SELECT count(*) AS incompatible_wallet_currency FROM transactions t JOIN wallets w ON w.id=t.wallet_id
 WHERE upper(t.currency_original) IS DISTINCT FROM upper(w.currency) AND COALESCE(t.amount_original,t.amount_idr,0)<>0;
SELECT count(*) AS incompatible_legacy_currency FROM transactions t JOIN wallets w ON w.business_id=t.business_id AND w.name=t.source
 WHERE t.wallet_id IS NULL AND upper(t.currency_original) IS DISTINCT FROM upper(w.currency) AND COALESCE(t.amount_original,t.amount_idr,0)<>0;
SELECT count(*) AS scope_mismatch FROM wallets w JOIN businesses b ON b.id=w.business_id
 WHERE (b.type='personal') IS DISTINCT FROM (w.scope='personal');
SELECT bank_import_row_id,count(*) AS duplicate_import_transactions FROM transactions WHERE bank_import_row_id IS NOT NULL GROUP BY bank_import_row_id HAVING count(*)>1;
SELECT count(*) AS invalid_bank_provenance FROM transactions t LEFT JOIN bank_import_rows r ON r.id=t.bank_import_row_id
 LEFT JOIN bank_import_batches b ON b.id=r.batch_id WHERE t.bank_import_row_id IS NOT NULL AND
 (r.id IS NULL OR b.id IS NULL OR t.business_id IS DISTINCT FROM r.business_id OR t.business_id IS DISTINCT FROM b.business_id
 OR t.wallet_id IS DISTINCT FROM b.wallet_id OR r.matched_transaction_id IS DISTINCT FROM t.id);
SELECT count(*) AS dangling_import_matches FROM bank_import_rows r LEFT JOIN transactions t ON t.id=r.matched_transaction_id
 WHERE r.matched_transaction_id IS NOT NULL AND (t.id IS NULL OR t.business_id IS DISTINCT FROM r.business_id);
SELECT c.relname,c.reloptions FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname='intercompany_balances';
ROLLBACK;
