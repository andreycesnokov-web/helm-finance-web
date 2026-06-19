# Tax Documents Runtime V1 — operations

Secure document center over the migration-031 tables: signed-upload to a private
bucket, business-scoped metadata, linking to Payables/Receivables/Transactions,
and an append-only audit. No cash impact — documents never create a transaction,
move a wallet, or change a debt.

## Migrations
| Migration | Purpose | Status |
|---|---|---|
| 031–034 | document/tax tables | **applied in production** |
| 035 `document_audit` | append-only audit trail | approved for staging — **NOT in production** |
| 036 `rpc_document_*` | atomic mutation+audit RPCs | approved for staging — **NOT in production** |

Apply order on staging: **035 → 036** (036 aborts if 035 is absent). Run the
checks in `migrations/_preflight_postflight_035_036.sql` before/after.

## Required environment
- `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (service role) — already present.
- `DOCUMENTS_BUCKET` (optional; default `financial-documents`).
- A **private** bucket must exist (created manually — the app never auto-creates it).

## Atomic audit
Critical mutations (upload-complete, metadata, link, unlink, archive) run through
the 036 RPCs, which perform the mutation **and** the `document_audit` insert in
one transaction. If the audit insert fails, the mutation rolls back. Read-only
events (view / signed-url / download) use best-effort audit.

## Health
`GET /api/documents/health` — ordinary users get `{ available, degraded }`;
Platform Admin additionally sees bucket/env/audit/RPC readiness and `reasons[]`.
If storage is not ready, only Documents is disabled (rest of CFO AI is unaffected).

## Abandoned-upload cleanup
Objects can be left in the bucket if a client never completes an upload. The
cleanup script lists `businesses/*/documents/*`, finds objects older than 24h with
no `document_files` row, and removes only those. **It never deletes a referenced
file.** It is **dry-run by default**; deletion requires `--execute`. No cron is
scheduled in this PR.

```bash
# Dry-run (lists what WOULD be deleted, deletes nothing):
node server/scripts/cleanupOrphanDocuments.js

# Actually delete confirmed orphans:
node server/scripts/cleanupOrphanDocuments.js --execute

# Options:
node server/scripts/cleanupOrphanDocuments.js --hours=24 --bucket=financial-documents
```

## Staging integration test
Runs against a **separate** Supabase project (never production). See the test
header for the exact env. Run:

```bash
SUPABASE_URL="https://<staging-ref>.supabase.co" \
SUPABASE_SECRET_KEY="<staging service_role key>" \
DOCUMENTS_TEST_BUCKET="financial-documents-test" \
DOC_TEST_BIZ_A="<biz A uuid>" DOC_TEST_BIZ_B="<biz B uuid>" DOC_TEST_DEBT_B="<debt id in B>" \
node tests/integration/storageDocuments.test.js
```

## Production-readiness gate (all must be true)
- [ ] 035 applied + tested on staging
- [ ] 036 applied + tested on staging
- [ ] runtime uses atomic RPCs (done in code)
- [ ] real staging Storage integration test passes
- [ ] private production bucket created
- [ ] production env configured
- [ ] preflight/postflight approved
