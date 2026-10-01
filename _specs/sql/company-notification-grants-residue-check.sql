-- ============================================================================
-- Company Notification Grants smoke — POST-RUN RESIDUE CHECK (READ-ONLY)
-- Run AFTER the smoke's ROLLBACK. Every statement is a SELECT.
--
-- BASELINE-AWARE: the checks are scoped to the SYNTHETIC ids the smoke uses (synthetic businesses
-- never pre-exist, so their baseline is 0). This is correct on a NON-EMPTY disposable DB — e.g. a
-- sanitised production copy that legitimately holds other businesses' grants/audit — because it
-- never asserts a global "= 0"; it asserts only that NO SYNTHETIC row survived the rollback.
-- ============================================================================

SELECT
  (SELECT count(*) FROM users
     WHERE id BETWEEN -9990000010 AND -9990000001)                                 AS synthetic_users_should_be_0,
  (SELECT count(*) FROM businesses
     WHERE id IN ('dede0000-0000-0000-0000-00000000000a',
                  'dede0000-0000-0000-0000-00000000000b'))                          AS synthetic_businesses_should_be_0,
  (SELECT count(*) FROM business_members
     WHERE business_id IN ('dede0000-0000-0000-0000-00000000000a',
                           'dede0000-0000-0000-0000-00000000000b'))                 AS synthetic_members_should_be_0,
  (SELECT count(*) FROM business_member_notification_grants
     WHERE business_id IN ('dede0000-0000-0000-0000-00000000000a',
                           'dede0000-0000-0000-0000-00000000000b'))                 AS synthetic_grants_should_be_0,
  (SELECT count(*) FROM audit_events
     WHERE entity_type='notification_grant'
       AND business_id IN ('dede0000-0000-0000-0000-00000000000a',
                           'dede0000-0000-0000-0000-00000000000b'))                 AS synthetic_grant_audit_should_be_0;
-- Expected: every column 0. A non-zero value means a synthetic row survived the rollback — a real
-- defect; investigate before anything else.

-- Informational only (NOT a failure): the grants BIGSERIAL will have ADVANCED and will NOT have
-- rolled back — the documented, unavoidable side effect on a disposable DB. Compare to the
-- grants_seq_before the smoke printed to see the exact advance. Do NOT setval() to "reset" it:
-- a gap in a surrogate key is harmless, and resetting a sequence is itself a mutation.
SELECT last_value AS grants_seq_current, is_called FROM business_member_notification_grants_id_seq;
