# REVIEW-01 package — Codex review + MiMo audit (not yet performed)

**Status: BLOCKED (2026-10-17).** Neither reviewer could run on this machine. No review result exists; nothing here
imitates one.

| Tool | Version | Attempt | Result |
|---|---|---|---|
| Codex CLI | 0.160.0 | `codex exec --sandbox read-only` | `refresh_token_invalidated` → 401; the stored login was revoked (`codex_attempt_2026-10-17.txt`) |
| MiMo CLI | 0.1.13 | `mimo run --agent plan` | "MiMo free API service has ended. Sign in or configure a third-party API." (`mimo_attempt_2026-10-17.txt`) |

To unblock: the owner signs in to Codex (`codex login`) and signs in to MiMo or configures its API provider. Agents
must not do this (credentials).

## What to review

- Branch `feat/v2-email-password-auth`, base `1f51422`, head `575d9ec` (13 commits, `commits.txt`).
- Full diff: `v2_1f51422_to_575d9ec.diff`, regenerate with `git diff 1f51422..575d9ec > v2_1f51422_to_575d9ec.diff` (≈15k lines, not committed; most of it is the schema snapshot copied into
  `install/000_baseline_public_schema.sql`, which is identical to `tests/fixtures/schema/prod_public_schema_2026-10-08.sql`).
- Prompt with scope and contracts: `review_prompt.md`.

## Commands (read-only, on a throwaway detached worktree)

```bash
git -C C:/tmp/cfo-auth worktree add --detach C:/tmp/cfo-review 575d9ec
codex exec --sandbox read-only -C C:/tmp/cfo-review "$(cat review_prompt.md)" > codex_review.txt 2>&1
mimo run --agent plan "$(cat review_prompt.md) Focus as an independent security auditor: auth, workspace/tenant isolation, feature flags, billing enforcement." --dir C:/tmp/cfo-review > mimo_audit.txt 2>&1
git -C C:/tmp/cfo-auth worktree remove C:/tmp/cfo-review
```

Afterwards: record both outputs verbatim, fix confirmed P0/P1 as a new batch, re-run the regression
(`bash tests/rehearsal/run_all.sh` + the billing/auth suites listed in `V2_BILLING_TEST_REPORT.md`).
