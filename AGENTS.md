# CFO AI / Helm Finance - AI Agent Rules

Read this file before any work in this repository.

## Required Reading Before Coding

Before changing product code, every AI agent must read:

1. `_specs/AI_WORKING_MEMORY.md`
2. `_specs/PROJECT_STATE.md`
3. `_specs/ARCHITECTURE.md`
4. `_specs/RISKS_AND_TESTS.md`

Do not start implementation from assumptions or stale chat memory.

## Workspace Type Must Be Explicit

Every task must state which workspace type it affects:

- Personal
- Business
- Telegram bot / channel
- Platform/admin

If a task touches both Personal and Business, explicitly explain the data boundary.

## Hard Boundaries

- Never mix personal wallets with business wallets.
- Never route personal requests through business APIs.
- Never route business requests through personal APIs.
- Never expose internal ids like `id -2` in user-facing UI.
- Telegram is not the primary login method.
- Email is the primary identity entry.
- Telegram is legacy login and future paid integration/add-on.
- Do not change backend auth without explicit approval.
- Do not add migrations unless necessary and approved.
- Do not change env flags without documenting them.
- Any critical financial/data mutation needs audit/security review.
- Any business change must preserve business isolation.
- Any Personal change must not create business records automatically.
- Personal wallets and business wallets must remain fully separated.

## Feature Flags

- If a task is behind a frontend Vite flag, build with the flag OFF and ON when applicable.
- If a task is behind a backend runtime flag, verify the OFF behavior first.
- Flag OFF must preserve production behavior.
- Do not enable/disable Railway flags unless explicitly asked.

## Reporting After Every Task

Report:

- Files changed.
- Tests/checks run.
- Workspace type affected.
- Flags touched or not touched.
- Migrations touched or not touched.
- Risks introduced or reduced.
- Production impact.

## Multi-Agent Collaboration Rule

Only one AI agent may change code at a time.

Default roles:

- Claude writes narrow, approved changes: safe quick fixes, small docs updates, and small scoped implementation batches.
- Codex reviews diffs, checks regression risk, confirms tests/builds/flags, and gives go/no-go.
- MiMo performs independent review after fixes: security, auth, workspace isolation, and feature flags.

Do not let Claude, Codex, and MiMo modify code in parallel. One writes, one reviews, one audits.

Batch flow:

1. Owner assigns one agent to implement.
2. Implementing agent produces a scoped commit/report.
3. Codex reviews scope, diff, tests, flags, migrations/env, and production risk.
4. Owner approves merge/promote.
5. MiMo audits after the fix if needed.
6. New findings become the next batch, not extra edits inside the current batch.

## Do Not Touch Without Explicit Go

- Reset/R001.
- Migrations 037-039, 040, 041, 043.
- Payments/billing.
- Personal-to-Business bridge.
- Telegram linking/cutover.
- Railway env.
- Backend auth.
- Production data.
