# Native acceptance — 21 October 2026

**Verified Business candidate:** product HEAD `2d60634fb355ed80c4a0e731324544f8352db53d`, tree `ff10b741d1a6cb769fc57b193e69cfcbe098e482`, baseline `a55876d09103fc888b42935b4bd801074089efaf`. Later acceptance-only commits do not change this tested application code. This document supersedes the earlier pre-native BLOCKED statements in IMPLEMENTATION/LOCAL_INTEGRATION_GATE; their historical evidence is retained.

## Verified evidence

Owner approval `call_16a7be5366d244bda25b1e4adf9d1171` admitted ONLY new project `cfo-picker-payroll-rc-20261021` on114.29.239.192. New PostgreSQL17.6 cluster `7698928172490620963`, private Storage, GoTrue, PostgREST, gateway/app; separate secrets/volumes/internal networks; no host ports. Existing24 containers' IDs/status/StartedAt unchanged. Initial empty public schema verified. No production data, production env, old staging data or customer files copied.

| Layer | Actual result |
|---|---|
| Targeted Node | 53 PASS, zero failures/skips. Embedded SQL is PostgreSQL18.3, separately qualified. |
| V2 OFF/ON builds | Both PASS after final decimal-search fix. |
| UI fixture | Desktop/mobile1205 rows, filters/empty/error/keyboard, skip disabled linked rows, no automatic link. Fixture evidence is distinct from native backend tests. |
| Native PostgreSQL17.6 | 3 PASS: same-key concurrency; employee-month concurrency; membership revocation writer order; independent connections, no embedded fallback. |
| Real platform/app admission | 5 PASS: health, JWT required401, actual email sign-in, private Storage, independent GoTrue sign-in/refresh. App retains its custom email JWT; no auth rewrite. |
| Picker real HTTP | 11 PASS:1206 rows/3 cursor pages; signed synthetic upload/download integrity; link/readback/duplicate/concurrent link/unlink; foreign tenant; revoked membership; audit rollback; immutable ledger; anon private table denied. |
| Payroll real HTTP | 11 PASS: audited employee create/edit/stale; concurrent one run/audit/receipt; key/payload conflict; duplicate employee-period; receipt recovery; draft edit/version/approval pending; reviewed existing debit only; date preserved/paid immutable; zero PPh21/cancel; audit failure rollback; owner/creator attribution; actor-private receipts/roles/revocation; legacy payout409; zero unintended cash. |
| Real V2 browser | Documents search/keyboard/compare/double-click/reload; payroll draft; real commit then response abort/reload/receipt recovery without second create; approval with no transfer; shared bank picker and paid readback;13-person mobile form/last field/footer; fresh sign-in after own-app restart; membership revoked while selection open ->403; payable + receivable detail -> linked document -> same picker. |

Screenshots, case JSON, source/image/isolation/migration/backup proofs, explicit test commands and checksums are in the versioned native review package. Earlier browser harness mistakes (overlay/navigation/fixture description ambiguity) are retained; final lifecycle script passed as a whole. No product bypass or mocked HTTP response was substituted.

## Narrow fixes after b0b83ba

`fd82b8d`: keyboard arrows/Home/End skip disabled linked options, including all-disabled search. `2d60634`: search recognizes decimal/localized amount input and numeric strings returned by PostgREST. Search normalization does not modify stored money. Unit coverage, desktop/mobile fixture and real browser query verified.

## Migration / security / rollback

RC-A adds no migration. RC-B adds ONLY `20261020163121_payroll_runs_no_cash.sql`. Fresh-target DDL+dependency chain manifested; pre-payroll synthetic backup928670bytes with valid archive TOC/SHA256. No restore performed. Migration applied once to NEW empty-cluster test database; committed historical migrations were not replayed against any existing database. Applicability on current production remains a separate pre-deployment gate.

Backend current membership/role and actor/company receipt isolation checked through actual signed app JWT, PostgREST RPC and DB. Private payroll RPC grants and invoker/writer checks retained; anon cannot read private payroll. These checks do not claim production end-user RLS proof. Audit failure rolls back writes. No fabricated user-supplied owner attribution, no new receipt mechanism, no unaudited fallback. Existing cash-creating legacy payroll POST now refuses409 intentionally.

Rollback: stop new payroll writes; preserve additive tables, audit and receipts; restore exact reviewed app while retaining the fail-closed legacy payout guard. Never reactivate old cash payroll endpoint. Do not delete history or execute a destructive down migration. Any database restore requires a fresh named target/plan/approval. New RC environment can be stopped by exact project only, preserving volumes; do not touch existing staging or restart Docker daemon.

## Graphify and release decision

Verified OAuth, cfo-ai workspace and correct repository; real list/stats/find/query/callers/callees/trace/tests/impact/expand/remember/recall calls. Cloud graph indexes main`fb03df5` from15October, not unpublished candidate. Current code and tests validate the new modules; graph-derived weak name matches are not coverage proof. Supported MCP has no refresh operation; no push/merge just for indexing. Nine relevant engineering notes saved with review_required intake, not publication. See Graphify transcripts in review package.

**GO for technical owner/code review; NO-GO for automatic production promotion.** Pending: AntiGravity OCR owner hunk agreement for shared server/index.js; current production applicability/grants/schema/backup; explicit owner promotion approval. Graphify candidate reindex/publication pending separately. No production deploy, push, merge, OCR branch changes or paid AI. No claim of accountant approval, tax-ready export or owner Windows access.

Known product limits: IDR whole rupiah, manual accountant-entered PPh21 including explicit zero, employer BPJS separate; no automatic tax profile/TER engine, bank transfer, split one debit across people or paid-run amendment. Up to500 selected employees; latest100 runs visibly bounded. Existing settlement-allocation side effects are a separate unchanged flow. Windows Docker4.78.0 remains blocked at Inference manager socket/ReparsePoint error1920; no system remediation without approval.
