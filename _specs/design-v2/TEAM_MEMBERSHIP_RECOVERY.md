# Business team membership — scoped hardening

Actual API/PostgREST/native baseline a376ed3 on a fresh synthetic company reproduced
admin self-promotion to owner, missing business_id on already-member acceptance,
and two active memberships consuming one single-use invitation with uses_count=1.
The test escalation was immediately reversed using the actual owner's API.

New additive migration 20261012123000 provides service-only SECURITY INVOKER RPCs.
Both acquire the existing global writer gate before parent/metadata locks. No gate
replacement, JWT model, Auth UUID bridge, legacy migration or financial writer is
changed. Acceptance validates the Business boundary, current membership, closed
invite role, expiry and use limit. Membership, use counter and audit commit together.
Active own membership provides replay after the code is exhausted, without role
change, reactivation or another use. Removed members cannot reuse exhausted codes.

Role/status changes recheck the actor inside that same transaction. Ownership
transfer is not offered. The actual business owner and self are protected, and an
admin cannot modify peers/higher roles or grant them. Audit failure rolls back the
membership change. The existing grant-cleanup trigger, where present, remains part
of the same transaction; its availability/flag is not silently changed.

Existing POST accept, PATCH role and DELETE member delegate to these RPCs and fail
closed if the schema is absent. No fallback to the unsafe multi-request writer.
Authenticated read-only membership lookup exposes company identity only to its
current member/owner. V2 uses it after an actual accept acknowledgement and when a
reload finds an exhausted code; replay recovery can navigate without another POST.
Late results from a different signed-in actor or outdated code are discarded.

Six native groups passed in a separate restored PostgreSQL17 database, with audit
failure rollback and independent-session race. Real staging rollout and API/browser
acceptance remain pending. Fresh private backup hashes and unchanged original data
fingerprints are recorded. No production access changes or migration repair.

Follow-up source/actual API review found the older email-OTP invitation endpoint
still performed a separate unchecked upsert. On fcbb5c0 it granted two new members
against one single-use code without incrementing uses_count, and granted an expired
invitation. It now delegates to the same tested atomic membership RPC after the
unchanged OTP identity/consumption flow. No alternate direct membership writer or
new auth model is introduced. If the OTP response is lost, sign in with a new
challenge and read current membership; do not reuse a consumed OTP or guess a role.
