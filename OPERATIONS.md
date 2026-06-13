# Operations Runbook

Operational procedures for CFO AI (web + helm-finance-bot). Keep this current.

## Services & repos

| Service | Repo | Deploy | Runtime |
|---|---|---|---|
| Web + API | `andreycesnokov-web/helm-finance-web` | Railway, branch `main` | Node (`server/index.js`) + static `client/dist` |
| Telegram bot | `andreycesnokov-web/helm-finance-bot` | Railway, branch `main` | Node (`src/bot.js`, grammy long-poll) |
| Database | Supabase (Postgres) | — | shared by both services |

## Branch & deploy workflow

```
feature/<task>  →  PR  →  develop  →  PR  →  main  →  Railway auto-deploy
```

- `main` is protected (ruleset `protect-main`): PR required, no force push, no deletion.
  Repository admin can bypass for emergency hotfixes.
- Never run large changes directly on `main`. One bad task can break working
  Telegram approvals, payroll, business-scoping or the Decision Engine.
- Tag a release before each major phase: `git tag -a vX.Y.Z -m "..."; git push origin vX.Y.Z`.
- Current stable tag: **`v0.9.0-beta`**.

## Required environment variables (names only — values live in Railway)

**Web (`helm-finance-web`)**
```
SUPABASE_URL  SUPABASE_SECRET_KEY  JWT_SECRET  BOT_TOKEN
ANTHROPIC_API_KEY  ADMIN_TELEGRAM_IDS  CLIENT_URL
TELEGRAM_BOT_USERNAME  TELEGRAM_WEBHOOK_SECRET  VITE_BOT_USERNAME
(optional) WEB_APP_URL
```

**Bot (`helm-finance-bot`)**
```
SUPABASE_URL  SUPABASE_SECRET_KEY  BOT_TOKEN  ANTHROPIC_API_KEY
CFO_API_URL  WEBHOOK_SECRET
```

Invariants:
- `TELEGRAM_WEBHOOK_SECRET` (web) **must equal** `WEBHOOK_SECRET` (bot).
- `CFO_API_URL` (bot) points at the web service public URL.
- `users.id` is the Telegram id (no separate `telegram_id` column).

## Database migrations

- SQL files in `migrations/` (`001`–`020`; `004` intentionally absent). Additive + idempotent.
- Applied **manually** in the Supabase SQL Editor — there is no auto-migration runner.
- Before deploying code that needs a new column, run its migration in Supabase **first**.

## Backup (Supabase Free Plan — no scheduled backups)

Run a logical JSON dump before any major task:

```bash
cd "C:\Users\HUAWEI\Desktop\Fin Bot"
node backup.js
```

- Reads `SUPABASE_URL` / `SUPABASE_SECRET_KEY` from `.env` (never printed).
- Writes `C:\Users\HUAWEI\Desktop\helm-backup-<timestamp>\` with one JSON per table + `_summary.txt`.
- **Copy each backup folder to cloud storage** — the local disk is not a backup.
- Upgrade to Supabase Pro later for automated daily backups + point-in-time recovery.

## Restore

- **Code rollback:** `git checkout v0.9.0-beta` (or the relevant tag) → open a PR / redeploy.
- **Data rollback (from JSON dump):** restore per-table via the Supabase client
  (upsert the JSON rows) or recreate the project and re-import. Schema comes from
  `migrations/001–020`. Prefer Supabase Pro PITR once available.

## Pre-task checklist (before each major feature)

1. `node backup.js` and copy the folder to cloud.
2. Confirm `main` is green and deployed.
3. Branch: `git checkout develop && git pull && git checkout -b feature/<task>`.
4. Review any new migration (additive + idempotent) before running it in Supabase.
5. Build locally: `node --check server/index.js` and `cd client && npm run build`.
6. PR → review → merge to `develop`, then `develop` → `main`.

## CI

`.github/workflows/ci.yml` runs on PRs to `main`/`develop`: server syntax check +
client build. Enable it as a required status check in the `protect-main` ruleset
once it has run at least once.
