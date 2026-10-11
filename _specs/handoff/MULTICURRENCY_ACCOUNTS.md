# Handoff: multi-currency accounts (for Antigravity)

## 1. The project in 2 minutes
- **CFO AI / Helm Finance** — a finance OS for small companies in Indonesia (IDR is the home currency).
- **Prod:** app.cfo-ai.site (Railway, auto-deploys from `main`). **DB:** Supabase (Postgres).
- **Code:**
  - `client/`: React + Vite; the new UI lives in `client/src/v2/`, which is ON in prod through `client/.env.production` (`VITE_DESIGN_V2=true`).
  - `server/`: Express; almost all routes are in `server/index.js`.
  - `migrations/`: numbered SQL; the last one applied is 064.
  - `tests/`: plain `node file.test.mjs`.
- **Workspaces:**
  - **Business:** company money, isolated by `business_id`.
  - **Personal:** the user's own money.
  - The two must never mix.
- **Read first, in this order:**
  1. `AGENTS.md` (the hard rules);
  2. `_specs/AI_WORKING_MEMORY.md`, `_specs/PROJECT_STATE.md`, `_specs/ARCHITECTURE.md`, `_specs/RISKS_AND_TESTS.md`;
  3. `client/src/v2/lib/format.js`.

## 2. Rules you must follow (from AGENTS.md)
- **Do not touch without the owner's explicit go:**
  - migrations 037–043 (037–039 already contain the FX tables; extend them, do not rewrite them);
  - backend auth, payments/billing, Telegram linking, the Personal↔Business bridge, Reset/R001;
  - Railway env, production data.
- **New migrations need the owner's approval.** Write them, but do not apply them to prod yourself.
- Every money mutation needs an `audit_events` row.
- Respect roles: owner/admin/accountant write; viewers read.
- **Workflow:**
  - one agent writes code at a time;
  - work on a branch and open a PR; never push to `main` yourself;
  - after each task, report: files, tests, workspace, flags, migrations, risks, production impact.

## 3. What exists today (the starting point)
- **Wallets** have `currency` (`WalletCurrencyField.jsx`, `server/lib/telegramCurrency.js`).
- **Transactions** carry `amount_original` + `currency_original` + `amount_idr`.
- **FX:**
  - `server/lib/fxProvider.js` has a mock-only rate provider (no real provider is connected);
  - migrations 038/039 add `exchange_rate_quotes` and `fx_conversions`, which Personal funding uses today.
- **Known problems (this is why the task exists):**
  1. Many writes set `amount_idr = amount` without converting (`server/index.js`: bank import ~5938, batch ~6450, PATCH ~754). A USD row is therefore counted as rupiah.
  2. `/api/pulse` totals `amount_original` across all currencies. `/api/wallets` totals `amount_idr`. A non-IDR wallet shows an inconsistent balance.
  3. v2 is IDR-only:
     - Accounts lists non-IDR wallets separately and leaves them out of the total;
     - "+ Add" (`client/src/v2/lib/addEntry.js`) forces IDR;
     - Pulse, Radar and Performance skip non-IDR rows.

## 4. The task
Make it possible for a **business** to keep accounts in USD, SGD, EUR or USDT next to IDR, and see correct totals.

1. **Data rules (decide them, write them down, get the owner's OK before coding):**
   - `amount_original` + `currency_original` are the truth. `amount_idr` = the original amount × the rate **on the transaction date**, and the rate used is stored on the row (or linked to `exchange_rate_quotes`).
   - A wallet's balance is kept in its own currency. Company totals are in IDR at **today's** rate, with an "as of <rate date>" label.
   - Transfers between currencies are two legs (out in A, in B) plus the FX gain or loss. Reuse `fx_conversions`.
2. **Server:**
   - one helper `toIdr(amount, currency, date)` using `fxProvider`, plus a manual-rate override that is audited;
   - use it in every write path listed in §3.1;
   - fix the `/api/pulse` and `/api/wallets` totals so they agree.
3. **Rate source:** propose a real provider (e.g. Bank Indonesia JISDOR, or an exchangerate API). Do not connect it without the owner's go; the mock is fine for tests.
4. **UI (v2):**
   - Accounts shows each wallet in its own currency plus its IDR equivalent, and the company total in IDR;
   - "+ Add" lets you pick a wallet in any currency, and the amount follows that wallet's currency;
   - Pulse, Radar and Performance include non-IDR money in IDR equivalents;
   - all text is in EN/RU/ID (`client/src/v2/i18n/*.js`).
5. **Backfill:**
   - write a read-only report SQL that lists rows where `currency_original <> 'IDR' and amount_idr = amount_original`;
   - write a separate fix script for them. The owner runs it.

## 5. Done means
- [ ] A rules doc in `_specs/multicurrency/RULES.md`, approved by the owner.
- [ ] Unit tests for `toIdr`, the balance math and cross-currency transfers. The existing tests still pass:
  - the whole suite (`tests/*.test.*`, `tests/design/*.test.mjs`);
  - `node scripts/design-v2-verify.mjs`.
- [ ] Pulse "Cash now" = the Accounts total, for a company that has an IDR wallet and a USD wallet.
- [ ] No Personal↔Business mixing. No change to auth, billing or Telegram.
- [ ] A PR with the report from §2 and the migration (if one is needed) attached but **not applied**.

## 6. Production facts worth knowing
- The real company is Helm Care Indonesia. All of its wallets are IDR today, so production numbers must not change after your work: Cash now = Accounts total = Rp 131.82M on 4 Oct 2026.
- The `scope` column on transactions defaults to `'personal'` even for company rows. Inside a company, `scope` is a label, not ownership; isolation comes from `business_id`. See `_specs/accounts-personal-scope-ambiguity.md`.
