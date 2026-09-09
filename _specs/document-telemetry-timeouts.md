# Document read telemetry and cancellation

Base: main eb10e3ad. Isolated branch: feature/document-telemetry-timeouts.
Audit/benchmark is its own preceding commit e9030562. No PR79 merge or cherry-pick.

## Scope and unchanged behavior

Business readDocumentForIntake only: used by intake, extract and counterparty suggestion.
No new endpoint, dependency, UI, auth, migration, table, env setting or feature flag.
Current model claude-sonnet-4-5, prompt, 1500 output ceiling, embedded-text-first route,
existing 45-second ceiling, size/MIME guards, SDK retries and human confirmation remain.
Personal, payments, wallets, transactions, Telegram and support logic are unchanged.
Existing auth/business checks run before this reader. Logs confer no access or authority.

## Events in the existing console logger

Filter server logs by [document-processing]. JSON schema_version=1:
- run_started/run_finished: generated run_id, business_id, document_id, total read duration,
  controlled reason, read_source and controlled OCR fallback reason.
- stage_finished: file_lookup, download, pdf_text, field_parse, vision, dates_parties durations.
- model_attempt: logical_call_id, increasing attempt, transport duration/status/outcome.
- model_call_finished: provider, requested_model, actual_model, logical_calls=1, attempt/retry
  counts, elapsed time, safe failure reason/status, abort_requested, usage and cost fields.

SDK 0.20.9 exposes client.fetch. A transparent wrapper counts real SDK transport invocations,
including retries, only inside the document-call AsyncLocalStorage context. It does not alter
requests, responses, retry settings or transport behavior outside that context. Concurrent
runs do not share counters. If instrumentation is unavailable (e.g. stub without fetch),
attempts are null, NOT one. This is SDK-fetch count, not TCP packets or provider billing.
Fetch duration ends at response headers; logical-call duration includes response parsing.
Download stage measures the storage request; total run also includes buffer materialization,
OCR merge and local work. It is not a full upload-to-confirmation end-to-end timer.

No bytes, file names, storage paths, prompt, headers, key, transcript, tax/bank values or
raw error messages enter these events. IDs are accepted only as UUIDs. Existing unrelated
log statements are not rewritten by this PR. Logs remain access-controlled operational data;
retention/sampling and dashboards are future operational decisions. Logger failure is ignored.

## Cost and cancellation limits

Usage is response-derived or null. Requested alias and actual response model are separate.
Tariff anthropic-standard-2026-09-09-v1 uses standard Sonnet4.5 $3/$15 per million,
source: https://platform.claude.com/docs/en/about-claude/pricing (checked 2026-09-09).
Only exact returned claude-sonnet-4-5-20250929 with both token counts, <=200K input and no
positive cache usage is priced. Missing/unknown model, usage, cache TTL or long-context tier
does not receive a guessed price. No cache is requested by this path. Price must be revisited
if model/tier changes. Estimate excludes tax, negotiated rates, storage and human labor.

estimated_final_response_cost_usd covers ONLY the final returned usage. Total cost is unknown
after multiple attempts or unknown attempt instrumentation. Retry cost is unknown, not zero.
Timeout/no response can still incur charges. These logs are estimates, never provider invoices.

AbortController.signal goes to messages.create request options. The deadline aborts fetch
and bounds local waiting. Timers clear on success/error. Late answers cannot replace the
manual fallback or produce a second success. A late transport completion is explicitly marked.
The old SDK may finish its retry-backoff sleep before observing abort; no subsequent request
is sent. Local abort does NOT guarantee that provider processing/billing stopped.

## Validation recorded

- 24 affected test files: Node runner reported 232 tests passed, zero failed/skipped.
  Several legacy files contain additional internal assertions counted as one file by Node.
- 14 new telemetry scenarios: flag off; SDK success/usage; absent usage; unknown tariff;
  real SDK mock retry; provider failure; signal abort; retry-backoff timeout; late answer;
  timer cleanup; privacy; concurrent run isolation/non-document pass-through; logger failure;
  actual shared-reader execution with business-scoped read mocks and zero DB writes.
- 11 benchmark scorer tests pass. Five complete text fixtures: type 4/5; scalar fields 19/30;
  line rows 0/2; one duplicate false positive; no verifiable original-page evidence.
  Seven cases unverified, duplicate recall unknown. This is NOT engine/model accuracy.
- node --check server/index.js passed.
- client npm run build passed. Existing xlsx mixed-import and >500KB chunk warnings remain.
- No paid API call, production DB/storage access, live invoice upload, merge or deployment.
- Browser/provider-live performance, production costs and actual saving remain unmeasured.

## Next PR: atomic financial confirmation and audit (plan only)

Current PATCH /api/documents/:id/financial-fields updates the document and then attempts
document_audit and recordAudit separately. Current behavior can commit without its audit.

1. Add a forward-only service-role-only RPC with fixed search_path and explicit actor ID,
   business ID, document ID, expected version, idempotency key and a validated field patch.
   No caller-supplied role may authorize the call or populate audit actor_role.
2. Verify active same-business membership in the DB. Preserve canManageDocuments policy
   (owner/ceo/admin/cfo/accountant), do not accidentally import notification owner-only policy.
   Reject removed/inactive/missing/cross-business actors and personal/archived business context.
   Keep API auth and entitlement gates; inspect existing membership/bypass rules before SQL.
3. Lock actor membership, then document, consistently across mutation paths. Recheck business,
   archive state and effective money/currency/date/reference/counterparty values under lock.
   Use NUMERIC semantics, preserve null-vs-omitted behavior and current explicit aliases.
   Counterparty must belong to this business. Never touch cash/ledger/payment records.
4. Update fields and write BOTH required document_audit and audit_events records atomically.
   Any audit failure must rollback the fields. Derive actor role from locked membership.
5. Scoped idempotency (business/document/actor/key + canonical payload digest): identical retry
   returns the recorded outcome after current authorization checks, without duplicate audit;
   reused key with changed payload conflicts. expected_version rejects stale competing edits.
6. Test real two-session races in disposable Postgres: archive vs confirm, actor removal/demotion
   vs confirm, competing edits and duplicate retries in both orderings. Test audit failures,
   cross-business/role denial, rejected replay, nulls and zero ledger effects. PGlite alone is
   not proof of real lock blocking. Review lock order with existing archive/update RPCs.
7. Keep UI response contract, review-first policy and existing flags. No production apply until
   separate review, backup, disposable smoke and operator approval.

PR79 useful paths and exact reviewed commit are recorded in document-engine-audit-2026-09-09.md.
