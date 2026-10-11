# Helm Finance — Production Verification Report

**Date:** 2026-06-09  
**Prepared by:** Claude Sonnet 4.6 (CTO)  
**Status:** DEPLOYMENT PUSHED — awaiting Railway build completion

---

## Git Commits Pushed

### helm-finance-web (Railway: helm-finance-web)

| Commit | Description |
|--------|-------------|
| `5043ca4` | Merge branch 'claude/intelligent-wilbur-2e5714' — Groups A/B/D/E/F + security |
| `e3a241a` | feat: security hardening, data contract alignment, snooze endpoint |

**GitHub:** https://github.com/andreycesnokov-web/helm-finance-web  
**Branch:** main

### helm-finance-bot (Railway: helm-finance-bot)

| Commit | Description |
|--------|-------------|
| `be0fb05` | feat: Groups A/B/D — canonical prompt, transaction writes, fix categories join |

**GitHub:** https://github.com/andreycesnokov-web/helm-finance-bot  
**Branch:** main

---

## Changes Deployed

### Web App (helm-finance-web)

| Group | Change | Status |
|-------|--------|--------|
| Security | Remove hardcoded JWT_SECRET fallback; crash on missing env vars | ✅ Deployed |
| A-2 | Canonical AI parser prompt in /api/parse | ✅ Deployed |
| B-2 | POST /api/transactions/batch writes category, source, scope, project, amount_idr | ✅ Deployed |
| E | Schema migration: transactions.category + reminders.snoozed_until (run in Supabase) | ✅ Live |
| F | PATCH /api/reminders/:id/snooze endpoint | ✅ Deployed |
| F | Pulse.jsx: replace alert() with real snooze modal + API call | ✅ Deployed |
| BUG-01 | CSS color tokens in :root | ✅ Deployed |
| BUG-08 | i18n nested key traversal + English fallback | ✅ Deployed |
| BUG-09/10 | Modal overlay max-width removed (createPortal pattern) | ✅ Deployed |

### Bot (helm-finance-bot)

| Group | Change | Status |
|-------|--------|--------|
| A-1 | Canonical AI parser prompt in parseTransactions | ✅ Deployed |
| B-1 | saveall writes category field; removed getCategories() call | ✅ Deployed |
| D-1 | getTransactions uses select('*') — no broken categories join | ✅ Deployed |

---

## Build Configuration

| Item | Value |
|------|-------|
| Web build command | `cd client && npm run build` |
| Web start command | `node server/index.js` |
| Web static serving | Express serves `client/dist` |
| Bot start command | `node src/bot.js` |
| client/dist in git | ❌ Gitignored — Railway rebuilds from source |

---

## Production Verification Checklist

**Instructions:** Verify each item in production after Railway deployment completes (green status).

### 1. Railway Deployment Status

- [ ] helm-finance-web Railway deployment: GREEN / no build errors
- [ ] helm-finance-bot Railway deployment: GREEN / no build errors
- [ ] No startup crashes (env var validation passes — JWT_SECRET, SUPABASE_URL, etc. present)

### 2. Authentication

- [ ] Navigate to production URL → redirects to `/login`
- [ ] Telegram Login Widget renders
- [ ] Login with Telegram completes successfully
- [ ] JWT stored, user session active
- [ ] Protected routes accessible after login

### 3. Pulse Page

- [ ] Page loads without JS errors
- [ ] Balance, income, expense figures display correctly
- [ ] Existing transactions from before migration show correctly
- [ ] Reminders section renders (may be empty)
- [ ] Debts section renders
- [ ] "Snooze" button visible on reminder items (if any reminders exist)
- [ ] Snooze modal opens (1 day / 3 days / 7 days / custom date options)
- [ ] Snooze action calls API and closes modal (no alert())

### 4. Accounts Page

- [ ] Page loads without JS errors
- [ ] Virtual accounts derived from transaction.source display correctly
- [ ] Account balances calculate correctly
- [ ] Add transaction modal opens and submits

### 5. Radar Page

- [ ] Page loads without JS errors
- [ ] Transactions list renders
- [ ] Category column shows (null for pre-migration rows is expected)
- [ ] Filters work

### 6. Web Transaction Parsing

- [ ] Navigate to /add
- [ ] Enter text describing a transaction (e.g. "кофе 35000 наличные личное")
- [ ] AI parses and returns transaction preview
- [ ] Confirm saves to database
- [ ] New transaction appears in Pulse/Radar
- [ ] Transaction has: source, category, scope, amount_idr populated

### 7. Bot Transaction Parsing

- [ ] Send transaction text to Telegram bot
- [ ] Bot replies "Анализирую..."
- [ ] Bot shows transaction preview with ✅ Да, сохранить / ❌ Отмена
- [ ] Confirm saves to database
- [ ] New transaction visible in web app
- [ ] Transaction has: source, category, scope, amount_idr populated (category now included)

### 8. Reminder Snooze Flow

- [ ] Create a reminder (via bot or directly in DB)
- [ ] Reminder appears in Pulse todayFocus section
- [ ] Click Snooze button — modal opens
- [ ] Select "1 day" — modal closes, reminder snoozed
- [ ] Verify `snoozed_until` updated in Supabase Dashboard → Table Editor → reminders

### 9. Existing Data Integrity

- [ ] All 14 pre-migration transactions still visible
- [ ] Balances match pre-deployment values
- [ ] No data loss, no corrupted rows

---

## Known Acceptable States

| Item | Expected |
|------|---------|
| `category` on pre-migration transactions | `NULL` — expected, migration used DEFAULT NULL |
| `snoozed_until` on existing reminders | `NULL` — expected, never snoozed |
| `category_id` column | Still exists, always NULL — harmless legacy column |
| `account_id` column | Still exists, always NULL — harmless legacy column |
| Bot `amount_idr` for non-IDR amounts | `NULL` (e.g. USD transactions) — correct for now |

---

## Deferred (Not Deployed — Awaiting Approval)

| Item | Reason deferred |
|------|----------------|
| Group C — Auto-generated tx hygiene | Not approved |
| Group G — Source normalization | Not approved |
| DROP COLUMN category_id | Destructive — awaiting explicit approval |
| DROP COLUMN account_id | Destructive — awaiting explicit approval |

---

## Next Step

Once Railway shows green and you have verified the checklist items above, report back with:
1. Railway deployment IDs / timestamps
2. Any errors observed
3. Screenshots of Pulse, Accounts, and snooze modal in production

Then Groups C and G can be approved.
