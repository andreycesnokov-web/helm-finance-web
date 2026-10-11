# Security cleanup (BEFORE main) — strict `x-business-id` handling

**Status:** TODO / blocker-before-production-rollout. **Not** fixed in the UI-migration
branch to avoid touching every business endpoint mid-migration.

## Current behavior
`resolveActiveBusiness(req)` (server/index.js) resolves the active business from
`x-business-id` → `?business_id` → `body.business_id` → user's default business. If an
**explicit** `x-business-id` is provided but the user is **not** an active member, it
**silently falls back** to the user's default business.

Verified in Step 3 live: a spoofed/foreign `x-business-id` does **not** leak the other
workspace's data (it returns the caller's own default) — so this is **safe**, not a leak.
The original rationale (code comment) is that it also gracefully handles a *stale*
`localStorage` business id after switching accounts in the same browser.

## Desired behavior (more correct semantics)
- `x-business-id` **absent** → fallback to last/default workspace. ✅ (keep)
- `x-business-id` **present and accessible** → use it. ✅ (keep)
- `x-business-id` **present but NOT accessible** to the caller → return
  **`403 { error: 'workspace_not_accessible' }`** instead of a silent fallback.

Silent fallback on an explicit-but-inaccessible id hides client bugs and makes
spoof/stale attempts indistinguishable from success.

## Why deferred (risk)
`resolveActiveBusiness` is called by **~every** business endpoint (Pulse, wallets,
transactions, payables, receivables, payroll, documents, …). Switching the explicit-
inaccessible case to `403` could break the documented **stale-localStorage account-switch**
UX (a returning user with an old id would get errors instead of graceful recovery). This
must be rolled out with: (a) the new `WorkspaceProvider` always sending a valid id, (b) a
client interceptor that clears a stale id + retries without it on `403 workspace_not_accessible`,
and (c) regression across all business flows.

## Proposed implementation (when scheduled)
1. In `resolveActiveBusiness`, when `requested` is truthy and the membership lookup returns
   no row, **throw `{ status: 403, message: 'workspace_not_accessible' }`** instead of
   falling through to `ensureDefaultBusiness`.
2. Frontend `apiFetch`: on `403 workspace_not_accessible`, clear `activeBusinessId` /
   `activeWorkspaceId`, refetch `/api/workspaces`, re-pick active, and retry once.
3. Regression: all business endpoints + the workspace-switch E2E + a new test asserting
   `403` for an explicit foreign id.

**Acceptance before main:** explicit foreign/stale `x-business-id` → `403`; absent id →
graceful default; no business flow regressions.
