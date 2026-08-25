-- ============================================================================
-- Company Notification Grants (migrations 046 + 047) — TRANSACTIONAL SMOKE TEST
-- ============================================================================
--
-- ⛔ DISPOSABLE PostgreSQL / Supabase ONLY. NEVER run this in production.
--    Two independent reasons (see the runbook): (1) the grants BIGSERIAL advances on every
--    INSERT and nextval() does NOT roll back, so a prod run leaves sequence residue; (2) the
--    Supabase SQL Editor's transaction handling of a hand-authored BEGIN..ROLLBACK with a
--    mid-script assertion failure is not guaranteed. Run with:
--        psql "$DISPOSABLE_URL" -v ON_ERROR_STOP=1 -f <this file>
--
-- REQUIRES: migrations 046 AND 047 applied to the disposable DB.
--
-- SAFETY
--   * BEGIN … explicit ROLLBACK. No COMMIT / DELETE / TRUNCATE / DROP / ALTER / setval anywhere.
--   * Only synthetic ids: UUIDs prefixed dede0000…, user ids in the -9.99e9 range. Cannot collide
--     with real data; never touches a real user, business, or membership.
--   * BASELINE-RELATIVE: every audit assertion compares a before/after count, so the smoke is
--     correct even on a NON-EMPTY disposable DB (e.g. a sanitised production copy) that already
--     holds notification_grant audit rows. Audit counts are further scoped to the two synthetic
--     businesses, so unrelated concurrent activity cannot perturb them.
--   * Fails closed: any assertion RAISEs, aborting the transaction. An aborted Postgres transaction
--     can only roll back, never commit — so even if the trailing ROLLBACK line is not reached,
--     no rows persist.
--
-- COVERAGE: owner→CEO and owner→CFO (both positive); denied targets manager/accountant/EMPLOYEE;
--   non-owner actor; cross-business; INACTIVE and REMOVED targets (separately); transition
--   auto-revoke; same-value no-op; grant/revoke/auto-revoke audit; unknown category; idempotency.
--   Concurrency (target-demotion-vs-grant, actor-demotion-vs-grant) is the TWO-SESSION procedure
--   in the runbook — a single session cannot exercise the FOR UPDATE locks.
-- ============================================================================

BEGIN;

-- Synthetic identifiers (documented; used as literals below for client-portability):
--   BIZ_A = dede0000-0000-0000-0000-00000000000a
--   BIZ_B = dede0000-0000-0000-0000-00000000000b
--   owner_A -9990000001, cfo_A -9990000002, ceo_A -9990000003, manager_A -9990000004,
--   accountant_A -9990000005, employee_A -9990000006, cfo_A_inactive -9990000007,
--   cfo_A_removed -9990000008, owner_B -9990000009, ceo_B -9990000010

-- ── PREFLIGHT: the synthetic ids must be absent before we start ──────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE id BETWEEN -9990000010 AND -9990000001)
     OR EXISTS (SELECT 1 FROM businesses WHERE id IN
        ('dede0000-0000-0000-0000-00000000000a','dede0000-0000-0000-0000-00000000000b')) THEN
    RAISE EXCEPTION 'PREFLIGHT FAILED: synthetic ids already present — aborting to avoid touching real data';
  END IF;
END $$;

-- Record the grants sequence up front so the operator can compute the (non-rolling-back) advance.
SELECT last_value AS grants_seq_before, is_called FROM business_member_notification_grants_id_seq;

-- ── Fixtures — one dedicated member per scenario, so tests do not perturb each other ──
INSERT INTO users (id) VALUES
  (-9990000001),(-9990000002),(-9990000003),(-9990000004),(-9990000005),
  (-9990000006),(-9990000007),(-9990000008),(-9990000009),(-9990000010);

INSERT INTO businesses (id, owner_user_id, name, status) VALUES
  ('dede0000-0000-0000-0000-00000000000a', -9990000001, 'SMOKE Synthetic Co A', 'active'),
  ('dede0000-0000-0000-0000-00000000000b', -9990000009, 'SMOKE Synthetic Co B', 'active');

INSERT INTO business_members (business_id, user_id, role, status) VALUES
  ('dede0000-0000-0000-0000-00000000000a', -9990000001, 'owner',      'active'),
  ('dede0000-0000-0000-0000-00000000000a', -9990000002, 'cfo',        'active'),  -- grant/revoke/transition
  ('dede0000-0000-0000-0000-00000000000a', -9990000003, 'ceo',        'active'),  -- CEO positive
  ('dede0000-0000-0000-0000-00000000000a', -9990000004, 'manager',    'active'),  -- denied
  ('dede0000-0000-0000-0000-00000000000a', -9990000005, 'accountant', 'active'),  -- denied
  ('dede0000-0000-0000-0000-00000000000a', -9990000006, 'employee',   'active'),  -- denied
  ('dede0000-0000-0000-0000-00000000000a', -9990000007, 'cfo',        'active'),  -- INACTIVE test
  ('dede0000-0000-0000-0000-00000000000a', -9990000008, 'cfo',        'active'),  -- REMOVED test
  ('dede0000-0000-0000-0000-00000000000b', -9990000009, 'owner',      'active'),
  ('dede0000-0000-0000-0000-00000000000b', -9990000010, 'ceo',        'active');  -- cross-business target

-- Scoped audit counter (only our two synthetic businesses); every audit assertion is a delta on it.
-- (Implemented inline via local n0/n1 variables in each block below.)

-- ════════════════════════════════════════════════════════════════════════════
-- #1  OWNER grants CFO  (positive) — grant enabled, +1 'granted' audit.
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE n0 int; n1 int; r jsonb;
BEGIN
  SELECT count(*) INTO n0 FROM audit_events WHERE entity_type='notification_grant'
    AND business_id IN ('dede0000-0000-0000-0000-00000000000a','dede0000-0000-0000-0000-00000000000b');
  r := apply_notification_grants('dede0000-0000-0000-0000-00000000000a', -9990000002, -9990000001, 'owner',
         '{"company_financial": true}'::jsonb);
  IF (r->>'changed')::int <> 1 THEN RAISE EXCEPTION 'ASSERT #1: expected changed=1, got %', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM business_member_notification_grants
      WHERE business_id='dede0000-0000-0000-0000-00000000000a' AND user_id=-9990000002
        AND category='company_financial' AND enabled=true) THEN
    RAISE EXCEPTION 'ASSERT #1: CFO grant not enabled';
  END IF;
  SELECT count(*) INTO n1 FROM audit_events WHERE entity_type='notification_grant'
    AND business_id IN ('dede0000-0000-0000-0000-00000000000a','dede0000-0000-0000-0000-00000000000b');
  IF n1 - n0 <> 1 THEN RAISE EXCEPTION 'ASSERT #1: expected +1 audit, got %', n1 - n0; END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_events WHERE entity_type='notification_grant' AND action='granted'
      AND business_id='dede0000-0000-0000-0000-00000000000a' AND entity_id='-9990000002') THEN
    RAISE EXCEPTION 'ASSERT #1: no granted audit for the CFO';
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- #2  OWNER grants CEO  (positive) — grant enabled, +1 'granted' audit.
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE n0 int; n1 int; r jsonb;
BEGIN
  SELECT count(*) INTO n0 FROM audit_events WHERE entity_type='notification_grant'
    AND business_id IN ('dede0000-0000-0000-0000-00000000000a','dede0000-0000-0000-0000-00000000000b');
  r := apply_notification_grants('dede0000-0000-0000-0000-00000000000a', -9990000003, -9990000001, 'owner',
         '{"tax_compliance": true}'::jsonb);
  IF (r->>'changed')::int <> 1 THEN RAISE EXCEPTION 'ASSERT #2: expected changed=1, got %', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM business_member_notification_grants
      WHERE business_id='dede0000-0000-0000-0000-00000000000a' AND user_id=-9990000003
        AND category='tax_compliance' AND enabled=true) THEN
    RAISE EXCEPTION 'ASSERT #2: CEO grant not enabled';
  END IF;
  SELECT count(*) INTO n1 FROM audit_events WHERE entity_type='notification_grant'
    AND business_id IN ('dede0000-0000-0000-0000-00000000000a','dede0000-0000-0000-0000-00000000000b');
  IF n1 - n0 <> 1 THEN RAISE EXCEPTION 'ASSERT #2: expected +1 audit, got %', n1 - n0; END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- #3  Denied target roles — manager, accountant, EMPLOYEE — member_not_grantable, NO new audit.
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE n0 int; n1 int; uid bigint;
BEGIN
  SELECT count(*) INTO n0 FROM audit_events WHERE entity_type='notification_grant'
    AND business_id IN ('dede0000-0000-0000-0000-00000000000a','dede0000-0000-0000-0000-00000000000b');
  FOREACH uid IN ARRAY ARRAY[-9990000004::bigint, -9990000005, -9990000006] LOOP  -- manager, accountant, employee
    BEGIN
      PERFORM apply_notification_grants('dede0000-0000-0000-0000-00000000000a', uid, -9990000001, 'owner',
                '{"company_financial": true}'::jsonb);
      RAISE EXCEPTION 'ASSERT #3: a non-grantable role (user %) was granted', uid;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%member_not_grantable%' THEN RAISE; END IF;
    END;
  END LOOP;
  SELECT count(*) INTO n1 FROM audit_events WHERE entity_type='notification_grant'
    AND business_id IN ('dede0000-0000-0000-0000-00000000000a','dede0000-0000-0000-0000-00000000000b');
  IF n1 <> n0 THEN RAISE EXCEPTION 'ASSERT #3: a denied target wrote % audit rows', n1 - n0; END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- #4  Non-owner ACTOR cannot grant (047) — actor_not_authorized, NO new audit.
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE n0 int; n1 int;
BEGIN
  SELECT count(*) INTO n0 FROM audit_events WHERE entity_type='notification_grant'
    AND business_id IN ('dede0000-0000-0000-0000-00000000000a','dede0000-0000-0000-0000-00000000000b');
  BEGIN
    PERFORM apply_notification_grants('dede0000-0000-0000-0000-00000000000a', -9990000002, -9990000004, 'owner',  -- actor = manager
              '{"company_financial": true}'::jsonb);
    RAISE EXCEPTION 'ASSERT #4: a non-owner actor was allowed to grant';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%actor_not_authorized%' THEN RAISE; END IF;
  END;
  SELECT count(*) INTO n1 FROM audit_events WHERE entity_type='notification_grant'
    AND business_id IN ('dede0000-0000-0000-0000-00000000000a','dede0000-0000-0000-0000-00000000000b');
  IF n1 <> n0 THEN RAISE EXCEPTION 'ASSERT #4: a forbidden actor wrote % audit rows', n1 - n0; END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- #5  Cross-business grant rejected — ceo of B via business A id — member_not_grantable, NO new audit.
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE n0 int; n1 int;
BEGIN
  SELECT count(*) INTO n0 FROM audit_events WHERE entity_type='notification_grant'
    AND business_id IN ('dede0000-0000-0000-0000-00000000000a','dede0000-0000-0000-0000-00000000000b');
  BEGIN
    PERFORM apply_notification_grants('dede0000-0000-0000-0000-00000000000a', -9990000010, -9990000001, 'owner',
              '{"company_financial": true}'::jsonb);
    RAISE EXCEPTION 'ASSERT #5: a cross-business grant was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%member_not_grantable%' THEN RAISE; END IF;
  END;
  SELECT count(*) INTO n1 FROM audit_events WHERE entity_type='notification_grant'
    AND business_id IN ('dede0000-0000-0000-0000-00000000000a','dede0000-0000-0000-0000-00000000000b');
  IF n1 <> n0 THEN RAISE EXCEPTION 'ASSERT #5: a cross-business attempt wrote % audit rows', n1 - n0; END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- #6  INACTIVE target cannot receive (dedicated member) — member_not_grantable, NO new audit.
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE n0 int; n1 int;
BEGIN
  UPDATE business_members SET status='inactive'
   WHERE business_id='dede0000-0000-0000-0000-00000000000a' AND user_id=-9990000007;
  SELECT count(*) INTO n0 FROM audit_events WHERE entity_type='notification_grant'
    AND business_id IN ('dede0000-0000-0000-0000-00000000000a','dede0000-0000-0000-0000-00000000000b');
  BEGIN
    PERFORM apply_notification_grants('dede0000-0000-0000-0000-00000000000a', -9990000007, -9990000001, 'owner',
              '{"company_financial": true}'::jsonb);
    RAISE EXCEPTION 'ASSERT #6: an inactive target was granted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%member_not_grantable%' THEN RAISE; END IF;
  END;
  SELECT count(*) INTO n1 FROM audit_events WHERE entity_type='notification_grant'
    AND business_id IN ('dede0000-0000-0000-0000-00000000000a','dede0000-0000-0000-0000-00000000000b');
  IF n1 <> n0 THEN RAISE EXCEPTION 'ASSERT #6: an inactive target attempt wrote % audit rows', n1 - n0; END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- #7  REMOVED target cannot receive (dedicated member, SEPARATE from inactive) — member_not_grantable.
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE n0 int; n1 int;
BEGIN
  UPDATE business_members SET status='removed'
   WHERE business_id='dede0000-0000-0000-0000-00000000000a' AND user_id=-9990000008;
  SELECT count(*) INTO n0 FROM audit_events WHERE entity_type='notification_grant'
    AND business_id IN ('dede0000-0000-0000-0000-00000000000a','dede0000-0000-0000-0000-00000000000b');
  BEGIN
    PERFORM apply_notification_grants('dede0000-0000-0000-0000-00000000000a', -9990000008, -9990000001, 'owner',
              '{"company_financial": true}'::jsonb);
    RAISE EXCEPTION 'ASSERT #7: a removed target was granted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%member_not_grantable%' THEN RAISE; END IF;
  END;
  SELECT count(*) INTO n1 FROM audit_events WHERE entity_type='notification_grant'
    AND business_id IN ('dede0000-0000-0000-0000-00000000000a','dede0000-0000-0000-0000-00000000000b');
  IF n1 <> n0 THEN RAISE EXCEPTION 'ASSERT #7: a removed target attempt wrote % audit rows', n1 - n0; END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- #8  Transition AUTO-REVOKE — demote the granted CFO → grant disabled, +1 'auto_revoked' audit
--     (system actor, NULL); re-promotion does NOT restore.
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE n0 int; n1 int;
BEGIN
  SELECT count(*) INTO n0 FROM audit_events WHERE entity_type='notification_grant'
    AND business_id IN ('dede0000-0000-0000-0000-00000000000a','dede0000-0000-0000-0000-00000000000b');
  UPDATE business_members SET role='manager'
   WHERE business_id='dede0000-0000-0000-0000-00000000000a' AND user_id=-9990000002;  -- was granted in #1
  IF EXISTS (SELECT 1 FROM business_member_notification_grants
      WHERE business_id='dede0000-0000-0000-0000-00000000000a' AND user_id=-9990000002
        AND category='company_financial' AND enabled=true) THEN
    RAISE EXCEPTION 'ASSERT #8: the grant survived a demotion';
  END IF;
  SELECT count(*) INTO n1 FROM audit_events WHERE entity_type='notification_grant'
    AND business_id IN ('dede0000-0000-0000-0000-00000000000a','dede0000-0000-0000-0000-00000000000b');
  IF n1 - n0 <> 1 THEN RAISE EXCEPTION 'ASSERT #8: expected +1 auto_revoked audit, got %', n1 - n0; END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_events WHERE entity_type='notification_grant' AND action='auto_revoked'
      AND business_id='dede0000-0000-0000-0000-00000000000a' AND entity_id='-9990000002'
      AND actor_user_id IS NULL) THEN
    RAISE EXCEPTION 'ASSERT #8: no system-attributed auto_revoked audit';
  END IF;
  UPDATE business_members SET role='cfo'
   WHERE business_id='dede0000-0000-0000-0000-00000000000a' AND user_id=-9990000002;  -- re-promote
  IF EXISTS (SELECT 1 FROM business_member_notification_grants
      WHERE business_id='dede0000-0000-0000-0000-00000000000a' AND user_id=-9990000002
        AND category='company_financial' AND enabled=true) THEN
    RAISE EXCEPTION 'ASSERT #8: re-promotion resurrected a stale grant';
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- #9  Same-value / unrelated membership update does NOT remove a valid grant.
-- ════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  PERFORM apply_notification_grants('dede0000-0000-0000-0000-00000000000a', -9990000002, -9990000001, 'owner',
            '{"payables_receivables": true}'::jsonb);  -- CFO is active cfo again after #8
  UPDATE business_members SET role='cfo', status='active'
   WHERE business_id='dede0000-0000-0000-0000-00000000000a' AND user_id=-9990000002;  -- no transition
  IF NOT EXISTS (SELECT 1 FROM business_member_notification_grants
      WHERE business_id='dede0000-0000-0000-0000-00000000000a' AND user_id=-9990000002
        AND category='payables_receivables' AND enabled=true) THEN
    RAISE EXCEPTION 'ASSERT #9: a same-value update wiped a valid grant';
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- #10  REVOKE audit + idempotency — revoke → +1 'revoked'; same value again → +0.
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE n0 int; n1 int; n2 int; r jsonb;
BEGIN
  SELECT count(*) INTO n0 FROM audit_events WHERE entity_type='notification_grant'
    AND business_id IN ('dede0000-0000-0000-0000-00000000000a','dede0000-0000-0000-0000-00000000000b');
  r := apply_notification_grants('dede0000-0000-0000-0000-00000000000a', -9990000002, -9990000001, 'owner',
         '{"payables_receivables": false}'::jsonb);  -- revoke the #9 grant
  IF (r->>'changed')::int <> 1 THEN RAISE EXCEPTION 'ASSERT #10: revoke changed=% (expected 1)', r; END IF;
  SELECT count(*) INTO n1 FROM audit_events WHERE entity_type='notification_grant'
    AND business_id IN ('dede0000-0000-0000-0000-00000000000a','dede0000-0000-0000-0000-00000000000b');
  IF n1 - n0 <> 1 THEN RAISE EXCEPTION 'ASSERT #10: expected +1 revoked audit, got %', n1 - n0; END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_events WHERE entity_type='notification_grant' AND action='revoked'
      AND business_id='dede0000-0000-0000-0000-00000000000a' AND entity_id='-9990000002') THEN
    RAISE EXCEPTION 'ASSERT #10: no revoked audit';
  END IF;
  PERFORM apply_notification_grants('dede0000-0000-0000-0000-00000000000a', -9990000002, -9990000001, 'owner',
            '{"payables_receivables": false}'::jsonb);  -- idempotent repeat
  SELECT count(*) INTO n2 FROM audit_events WHERE entity_type='notification_grant'
    AND business_id IN ('dede0000-0000-0000-0000-00000000000a','dede0000-0000-0000-0000-00000000000b');
  IF n2 <> n1 THEN RAISE EXCEPTION 'ASSERT #10: an idempotent repeat wrote % audit rows', n2 - n1; END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- #11  Unknown category rejected — unknown_category, no row, NO new audit.
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE n0 int; n1 int;
BEGIN
  SELECT count(*) INTO n0 FROM audit_events WHERE entity_type='notification_grant'
    AND business_id IN ('dede0000-0000-0000-0000-00000000000a','dede0000-0000-0000-0000-00000000000b');
  BEGIN
    PERFORM apply_notification_grants('dede0000-0000-0000-0000-00000000000a', -9990000002, -9990000001, 'owner',
              '{"not_a_real_category": true}'::jsonb);
    RAISE EXCEPTION 'ASSERT #11: an unknown category was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%unknown_category%' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM business_member_notification_grants WHERE category='not_a_real_category') THEN
    RAISE EXCEPTION 'ASSERT #11: an unknown-category row was written';
  END IF;
  SELECT count(*) INTO n1 FROM audit_events WHERE entity_type='notification_grant'
    AND business_id IN ('dede0000-0000-0000-0000-00000000000a','dede0000-0000-0000-0000-00000000000b');
  IF n1 <> n0 THEN RAISE EXCEPTION 'ASSERT #11: an unknown category wrote % audit rows', n1 - n0; END IF;
END $$;

SELECT 'SMOKE (046+047): all in-transaction assertions PASSED (rows will be rolled back)' AS result;

-- The one unavoidable, NON-transactional side effect: the grants BIGSERIAL advanced by the number
-- of successful grant INSERT attempts above (each granted/revoked category is one INSERT … ON
-- CONFLICT, which calls nextval() before detecting a conflict). Rejected calls that raise BEFORE
-- the insert loop (member_not_grantable / actor_not_authorized) do NOT advance it. nextval() is
-- not rolled back, so this advance survives the ROLLBACK below. Reading it does not advance it.
SELECT last_value AS grants_seq_after FROM business_member_notification_grants_id_seq;

ROLLBACK;
