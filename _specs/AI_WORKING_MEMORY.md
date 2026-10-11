# AI Working Memory - CFO AI / Helm Finance

Last updated: 2026-07-04.

Read this before every task.

## Current Mental Model

CFO AI is a Finance OS:

Email identity -> Personal Account -> optional Business Workspace -> optional paid Telegram channel.

Personal is the human user's home. Business is the company workspace. Telegram is a channel, not the identity foundation.

## Current Branch Context

- During this sync, local branch is `feature/business-premium-p3b`.
- Local HEAD is one commit ahead of `origin/main`: P3b deterministic tax obligations.
- Do not assume that local HEAD is production unless explicitly promoted.

## Critical Boundaries

- Personal wallets never appear in Business.
- Business wallets never appear in Personal.
- Personal API must not accept business workspace context.
- Business API must not accept personal workspace context.
- No implicit Personal -> Business money movement.
- Telegram submissions must include/resolve an active company; never write null business id.

## Recent Important Work

- Email auth 042 live.
- Resend magic links live.
- Email login is primary.
- Telegram login moved to legacy route.
- 043 Telegram active-business state applied.
- 044 Personal Account v1 foundation applied.
- Personal v1 backend and UI exist behind flags.
- Avatar upload live.
- Business premium UI / AI Accountant work exists behind flags.
- Bot `/company`, confirmation/edit/cancel, and active company selection were recently improved in separate bot repo.

## Work Process

1. State workspace type affected: Personal, Business, Telegram, Platform.
2. Read `_specs/PROJECT_STATE.md` and `_specs/ARCHITECTURE.md`.
3. Check git branch/status before changes.
4. Keep changes surgical.
5. Do not touch unrelated dirty/untracked files.
6. Run builds/tests relevant to flags.
7. Report files, tests, risks, and production impact.

## Multi-Agent Operating Model

Only one AI agent changes code at a time.

Roles:

- Claude: implementation agent for narrow, approved changes.
- Codex: review/check agent for diff, regressions, tests, flags, migrations/env, and production risk.
- MiMo: independent post-fix audit agent for security, auth, workspace isolation, and feature flags.

Do not allow parallel edits from multiple agents. If Claude is coding, Codex and MiMo stay read-only. If Codex is coding, Claude and MiMo stay read-only. If MiMo is auditing, nobody should treat its report as code changes until the owner creates a separate implementation task.

Batch flow:

1. One scoped task.
2. One implementing agent.
3. One commit/report.
4. Codex review.
5. Owner go/no-go.
6. Optional MiMo audit.
7. Next batch.

## Production Safety

- Railway does not apply migrations automatically.
- Vite flags are build-time and require rebuild.
- Backend flags are runtime and require restart/redeploy.
- Do not change Railway env without explicit approval.
