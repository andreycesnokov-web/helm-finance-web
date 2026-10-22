# CI session fixture recovery

Scope: Business bank-import test fixtures and Platform CI only. No application/auth/RPC/migration change.

Original exact-SHA run39871250796 on bf110c returned503 session_check_unavailable before both pre/post-migration assertions. The current sessionUser guard queries public.users; both older HTTP fixtures omitted that actor table/row. Their SQL-backed adapter propagates missing-table errors. These tests use locally signed app JWTs and a real PostgreSQL adapter, not an external Auth service. This is a test-data/setup defect, not evidence of a production Auth outage.

Seed real synthetic actor rows for both fixtures. Keep original expected500 schema-mismatch /200 normal-success assertions. Add actual HTTP missing-user401 and foreign-company403 with zero writes. Fail CI when PostgreSQL is unreachable rather than silently skipping. Run existing session/revoked-token security assertions in CI and explicitly keep paid OCR flags OFF for test jobs.

Do not mock authentication to true, weaken authorization, accept503 in a normal flow or skip the later reconciliation tests. Hosted exact-SHA evidence is required; green embedded tests alone are insufficient. Any later fixture-contract gaps must be fixed against the current real RPC/schema, not hidden by status changes.
