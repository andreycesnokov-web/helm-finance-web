-- Preflight / Postflight for migrations 031–034 (run manually in Supabase).
-- NOT a migration. No DDL. Read-only checks.
-- NOTE: renumbered from 026–029 — these apply AFTER migration 030 (business registry).

-- ════════════════ PREFLIGHT (run BEFORE applying 031) ════════════════════════
-- 1. FK target types must be: debts/transactions = bigint; rest = uuid.
SELECT table_name, data_type FROM information_schema.columns
WHERE column_name='id' AND table_name IN ('debts','transactions','counterparties','businesses','compliance_events','payroll_payments','tax_rules','official_sources')
ORDER BY table_name;

-- 2. Dependencies present (must all exist before 031). Includes migration 030's businesses columns.
SELECT t AS required_table,
  (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name=t) AS present
FROM unnest(ARRAY['businesses','counterparties','debts','transactions','compliance_events','payroll_payments','tax_rules','official_sources']) t;

-- 3. None of the new objects exist yet (clean target).
SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN
 ('document_files','financial_documents','document_links','tax_treatments','withholding_records',
  'debt_settlement_allocations','withholding_payment_allocations','tax_billing_allocations',
  'business_relationships','intercompany_funding_records','intercompany_settlement_allocations',
  'tax_deposit_accounts','tax_deposit_entries','tax_deposit_allocations');

-- ════════════════ POSTFLIGHT (run AFTER applying 031–034) ════════════════════
-- 4. Object counts.
SELECT 'tables' AS kind, count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN
 ('document_files','financial_documents','document_links','document_debt_links','document_transaction_links',
  'document_compliance_links','tax_treatments','withholding_records','debt_settlement_allocations',
  'withholding_payment_allocations','tax_billing_allocations','business_relationships',
  'intercompany_funding_records','intercompany_settlement_allocations','tax_deposit_accounts',
  'tax_deposit_entries','tax_deposit_allocations')   -- expect 17
UNION ALL SELECT 'view intercompany_balances', count(*) FROM information_schema.views WHERE table_schema='public' AND table_name='intercompany_balances'  -- 1
UNION ALL SELECT 'guard/iso functions', count(*) FROM information_schema.routines WHERE routine_schema='public' AND routine_name LIKE 'fn_%'  -- >=9
UNION ALL SELECT 'active triggers', count(*) FROM information_schema.triggers WHERE trigger_schema='public' AND trigger_name LIKE 'trg_%';

-- 5. Triggers must be enabled (tgenabled = 'O').
SELECT tgname, tgenabled FROM pg_trigger WHERE tgname LIKE 'trg_%' ORDER BY tgname;

-- 6. Cross-business / orphan inconsistencies (must all return 0 rows).
SELECT 'fd file other business' AS check, count(*) FROM financial_documents d JOIN document_files f ON f.id=d.file_id WHERE f.business_id <> d.business_id
UNION ALL SELECT 'doc_links cross-business', count(*) FROM document_links l JOIN financial_documents s ON s.id=l.source_document_id JOIN financial_documents t ON t.id=l.target_document_id WHERE s.business_id<>l.business_id OR t.business_id<>l.business_id
UNION ALL SELECT 'settlement debt other business', count(*) FROM debt_settlement_allocations a JOIN debts d ON d.id=a.debt_id WHERE d.business_id <> a.business_id
UNION ALL SELECT 'debt over-allocated', count(*) FROM (
  SELECT a.debt_id, SUM(a.allocated_amount) alloc, COALESCE(d.original_amount,d.amount)-COALESCE(d.paid_amount,0) avail
  FROM debt_settlement_allocations a JOIN debts d ON d.id=a.debt_id GROUP BY a.debt_id, d.original_amount, d.amount, d.paid_amount
) x WHERE x.alloc > x.avail + 0.005;
