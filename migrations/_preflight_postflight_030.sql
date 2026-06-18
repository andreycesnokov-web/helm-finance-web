-- Preflight / Postflight for migration 030 (run manually in Supabase). Read-only.

-- ════════════════ PREFLIGHT (before applying 030) ════════════════════════════
SELECT table_name, data_type FROM information_schema.columns
WHERE column_name='id' AND table_name IN ('businesses','users') ORDER BY table_name;  -- businesses uuid, users bigint
SELECT data_type FROM information_schema.columns WHERE table_name='businesses' AND column_name='owner_user_id';  -- bigint
SELECT 'business_code col' AS check, count(*) FROM information_schema.columns WHERE table_name='businesses' AND column_name='business_code'  -- expect 0
UNION ALL SELECT 'type col', count(*) FROM information_schema.columns WHERE table_name='businesses' AND column_name='type'
UNION ALL SELECT 'override col', count(*) FROM information_schema.columns WHERE table_name='businesses' AND column_name='admin_override_plan'
UNION ALL SELECT 'access_audit table', count(*) FROM information_schema.tables WHERE table_name='access_audit'
UNION ALL SELECT 'business_code_seq', count(*) FROM information_schema.sequences WHERE sequence_name='business_code_seq';
SELECT count(*) AS businesses_count FROM businesses;
SELECT count(*) AS memberships_count FROM business_members;
-- orphan memberships (member of a non-existent business)
SELECT count(*) AS orphan_memberships FROM business_members m LEFT JOIN businesses b ON b.id=m.business_id WHERE b.id IS NULL;
-- owners without an owner membership
SELECT b.id, b.name FROM businesses b
WHERE NOT EXISTS (SELECT 1 FROM business_members m WHERE m.business_id=b.id AND m.user_id=b.owner_user_id AND m.role='owner');

-- ════════════════ POSTFLIGHT (after applying 030) ════════════════════════════
SELECT b.id AS business_id, b.business_code, b.name, b.type, b.owner_user_id,
  (SELECT count(*) FROM business_members m WHERE m.business_id=b.id) AS member_count,
  (SELECT count(*) FROM wallets w WHERE w.business_id=b.id) AS wallet_count,
  (SELECT count(*) FROM transactions t WHERE t.business_id=b.id) AS transaction_count,
  (SELECT count(*) FROM debts d WHERE d.business_id=b.id) AS debt_count
FROM businesses b ORDER BY b.business_code;

SELECT 'business_code null count' AS check, count(*) AS value FROM businesses WHERE business_code IS NULL  -- 0
UNION ALL SELECT 'duplicate code count', count(*) FROM (SELECT business_code FROM businesses GROUP BY business_code HAVING count(*)>1) x  -- 0
UNION ALL SELECT 'code default trigger', count(*) FROM pg_trigger WHERE tgname='trg_business_code_default'  -- 1
UNION ALL SELECT 'immutable guard trigger', count(*) FROM pg_trigger WHERE tgname='trg_business_code_immutable'  -- 1
UNION ALL SELECT 'access_audit append-only trigger', count(*) FROM pg_trigger WHERE tgname='access_audit_append_only';  -- 1
