# CFO AI / Helm Finance - AI Agent Rules

Read this file before any work in this repository.

## Required Reading Before Coding

Before changing product code, every AI agent must build context in this order.

### 1. Knowledge Vault first (only when it exists)

The project Vault `CFO AI OBSIDIAN/` is an optional, local-only knowledge base kept in the owner's main
checkout and excluded from Git there via `.git/info/exclude`. It is absent from other clones, cloud
sessions and CI, and no rule in this file requires it. Locate it from any worktree with:

```bash
VAULT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/CFO AI OBSIDIAN"
test -f "$VAULT/CURRENT_STATE.md" && echo "vault: $VAULT" || echo "vault: absent"
```

If the Vault is present:

1. Read `CURRENT_STATE.md`.
2. Check freshness: take `commit:` from its frontmatter and run
   `git merge-base --is-ancestor <commit> HEAD` and `git diff --name-only <commit> HEAD`.
   Trust notes only for files outside that diff; read changed files directly. If HEAD does not contain
   `<commit>` (another branch), use the Vault as background only and verify every fact in code.
3. Read `02 Modules/00 Module Index.md`, then only the module notes relevant to the task.
4. Follow the source links from those notes into the code; read files narrowly (search, then offsets).

### 2. Fallback when the Vault is absent

Read the repository documentation, as before:

1. `_specs/AI_WORKING_MEMORY.md`
2. `_specs/PROJECT_STATE.md`
3. `_specs/ARCHITECTURE.md`
4. `_specs/RISKS_AND_TESTS.md`

These files may lag the code; confirm current state with `git log --oneline -20` and the code itself.

### 3. Older `_specs` and root documents

When the Vault is used, read the four files above and other `_specs/` or root documents selectively, only
when the task needs their history, a runbook or a decision record. They never override the code.

### Rules for every path

- The Vault, `_specs` and chat memory never override the code, the real schema or this file. SQL, security,
  auth, migrations, payments, staging and production always need verification against the real code and schema.
- Code-intelligence tools such as Graphify are optional helpers, never a required step.
- Never commit the Vault: do not `git add -f` it, and if `CFO AI OBSIDIAN/` shows up as untracked, leave it out.
  Never store secrets, API keys, JWTs, infrastructure addresses, customer data or financial documents in it.
- If the Vault is present, update it after a completed PR per its `06 Claude Code Protocol.md`.

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
