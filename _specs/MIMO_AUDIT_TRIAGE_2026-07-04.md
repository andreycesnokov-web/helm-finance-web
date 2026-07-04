# Xiaomi MiMo Audit Triage - 2026-07-04

Source: pasted Xiaomi MiMo audit continuation, sections 10-14.

Important: this is only the continuation of the audit report. Sections 1-9, including the stated 2 Critical and 5 High findings, were not included in this pasted text. Do not claim the full audit is triaged until the full report is available.

## Immediate Interpretation

MiMo found a mix of:

- missing tests,
- safe quick fixes,
- larger architectural fixes,
- owner questions.

No code changes were requested by the audit text itself. This file is documentation/triage only.

## Missing Tests Identified

### MT6 - HTTP-level personal/business rejection tests

Severity: Medium.

Gap:

- `personalAccount.test.js` tests lib/PGlite behavior.
- Missing real HTTP tests proving `/api/personal/*` rejects business context such as `x-business-id`.

Recommended action:

- Add HTTP-level tests for `/api/personal/wallets`, `/api/personal/transactions`, and `/api/personal/summary` with a business header/query/body.
- Expect 409/403, depending on existing handler behavior.

### MT7 - Custom test framework

Severity: Low.

Gap:

- Test harness is mostly hand-rolled.
- No standard root `test` script/framework integration.

Recommended action:

- Do not block product work.
- Later migrate incrementally to Vitest/Jest, starting with unit tests.

## Safe Quick Fix Queue

These should be done as surgical PRs, one small batch at a time.

### Batch A - Security and API correctness

Recommended first because low scope and high safety value:

1. QF4 - Production guard for `EMAIL_AUTH_DEV_RETURN_CODE`.
2. QF5 - HTML-encode magic link URL in email body.
3. QF6 - API-prefix guard before SPA catch-all.
4. QF7 - Remove secret length from logs.

### Batch B - Telegram paid gate hardening

1. QF1 - Fix `.effectivePlan` -> `.effective_plan` in `telegramPaidGate()`.
2. QF3 - Use dedicated `TELEGRAM_WEBHOOK_SECRET`; remove or deprecate `BOT_TOKEN` fallback only after bot service env is confirmed.

Note:

- QF3 may break bot calls if the bot service is not updated with the same secret. Treat as two-service rollout, not a blind one-line change.

### Batch C - Personal Funding dark-route safety

1. QF2 - Add feature flag gate around `personalFundingRouter` or at least `/api/workspaces` if the route exposes dark/unsupported state.
2. QF8 - Document required flag pairs and rollout order.

Note:

- QF2 must be handled carefully because `/api/workspaces` may now be used by `/account` / workspace switcher. Confirm current frontend dependency before gating.

## Larger Architectural Fixes

Do not mix these with quick fixes:

- AF1 - Move JWT from localStorage to httpOnly cookies.
- AF2 - JWT revocation / refresh-token model.
- AF3 - Replace `ADMIN_TELEGRAM_IDS` with DB admin roles.
- AF4 - Rate limiting for authenticated APIs.
- AF5 - React route error boundaries.
- AF6 - `/api/auth/me`.
- AF7 - workspace accessibility validation on navigation.
- AF8 - entitlement/migration validation for personal funding.
- AF9 - production schema/migration state inventory.
- AF10 - test framework migration.

Recommended order later:

1. AF9 - production migration inventory.
2. AF6 - `/api/auth/me`.
3. AF7 - workspace navigation validation.
4. AF4 - API rate limiting.
5. AF1/AF2 - auth token architecture project.

## Owner Questions To Resolve

1. Full production migration state.
2. Whether P3b deterministic tax obligations were promoted/deployed.
3. Current Railway flag values.
4. Current `ADMIN_TELEGRAM_IDS` meaning and whether any ids conflict with email negative ids.
5. Timeline for migrations 037-039.
6. Entitlement strategy for personal funding routes.
7. Expected `/api/health` behavior: JSON API or SPA fallback.
8. JWT expiry policy.

## Recommended Next Action

Before implementation:

1. Request or paste the full MiMo audit sections 1-9.
2. Confirm whether there are Critical/High issues not shown here.
3. Then run a surgical quick-fix task for Batch A only.

Do not start larger architectural fixes until the full audit is consolidated.

