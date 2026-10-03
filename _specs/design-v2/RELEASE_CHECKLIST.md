# Design v2 — release checklist (for the owner)

Only you do these steps:
- merge the PRs;
- apply the migrations;
- turn on `VITE_DESIGN_V2` in Railway.

Nothing here has been run against any real database, and no Railway setting has been changed.

**Workspace:** Business only. Personal is not touched by any step below. No step links Personal to a business.

---

## 1. Merge order (strictly one after another)

The PRs are stacked: each branch starts from the previous one. Merge them in this order and let CI pass on `main` after each merge.

| # | PR | Branch | What |
|---|---|---|---|
| 1 | #102 | `design-v2-r2/b1-shell` | Plan, flag, shell |
| 2 | #103 | `design-v2-r2/b2-pulse-radar` | Pulse, Radar |
| 3 | #104 | `design-v2-r2/b3-obligations-money` | Bills, approvals, counterparties, money |
| 4 | #105 | `design-v2-r2/b4-accounting` | Accountant, documents, settings |
| 5 | #106 | `design-v2-r2/b5-ai-cfo` | AI CFO |
| 6 | #107 | `design-v2-r2/b6-performance-assets` | Performance, assets (read-only) |
| 7 | #108 | `design-v2-r2/b7-admin` | Platform admin |
| 8 | #110 | `design-v2-r2/b8-approved` | Owner decisions, migrations 058–061 (option B) |
| 9 | #112 | `design-v2-r2/b9-p10` | P-10 profit groups, migration 062 |
| 10 | #113 | `design-v2-r2/b10-withholding` | PPh 23 withheld by a customer (**shared Business logic, not behind the flag**) |
| 11 | #114 | `design-v2-r2/b11-assets` | P-11 asset register, migration 063 |
| 12 | #115 | `design-v2-r2/b12-funding` | P-03 funding register, migration 064 |
| 13 | #116 | `design-v2-r2/b13-release` | Release walk, states, this checklist |

**What merging does with the flag still OFF:**
- The client bundle stays as it is today; the flag-OFF JS is byte-identical to `main`.
- The server gains new routes. Before the migrations are applied, they answer with empty values or 409 "migration not applied".
- The one deliberate change to today's behaviour is batch 10. The remaining balance subtracts recorded withholdings, and `/pay` follows the same rule. A bill with no withholding is calculated exactly as before; this is proven by a 3000-case equivalence test.

---

## 2. Migrations — test database first, then production

Apply them in this order:
1. Apply all of them to the **test** database and run the check query after each one.
2. Open the app against the test database with the flag ON and do the manual test list (section 5).
3. Only then apply them to **production**, in the same order, with the same checks.

All seven are additive and idempotent: running one twice is harmless. Each file ends with its own verification queries and a rollback block. Migrations 037–043 and R001 are not touched.

| Order | File | Check query after applying | Expected |
|---|---|---|---|
| 1 | `058_business_runway_target.sql` | `SELECT column_name FROM information_schema.columns WHERE table_name='businesses' AND column_name='runway_target_days';` | 1 row |
| 2 | `059_business_targets_alerts.sql` | `SELECT column_name FROM information_schema.columns WHERE table_name='businesses' AND column_name IN ('min_cash_idr','weekly_brief_cron');` | 2 rows |
| 3 | `060_counterparty_tax_fields.sql` | `SELECT column_name FROM information_schema.columns WHERE table_name='counterparties' AND column_name IN ('entity_form','payment_terms_days');` | 2 rows |
| 4 | `061_bill_checklist_status.sql` | `SELECT column_name FROM information_schema.columns WHERE table_name='debts' AND column_name IN ('accountant_checked_at','accountant_checked_by');` | 2 rows, and no `withholding_slip_document_id` column (option B) |
| 5 | `062_pnl_groups_industry_templates.sql` | `SELECT kbli_prefix, count(*) FROM industry_templates GROUP BY 1 ORDER BY 1;` | `*` 50 · `47999` 8 · `81210` 9; and `SELECT count(*) FROM cashflow_categories WHERE pnl_group IS NOT NULL;` → 0 |
| 6 | `063_asset_register.sql` | `SELECT count(*) FROM assets;` and `SELECT tgname FROM pg_trigger WHERE tgname='trg_iso_assets';` | 0, and 1 row |
| 7 | `064_business_funding_register.sql` | `SELECT count(*) FROM business_funding_records;` and `SELECT tgname FROM pg_trigger WHERE tgname LIKE 'trg_iso_business_funding%';` | 0, and 2 rows |

**Number 056 is skipped on purpose.** It is reserved for `aiUsageLimit`, as written in `_specs/mcp-server-audit-and-plan.md`.

**Optional, later: asset depreciation.**
- Assets get a useful life only from an active, **verified** tax rule with `obligation_type = 'depreciation'`. Its parameters look like `{ method: 'straight_line', groups: [{ code, label, useful_life_months | useful_life_years, asset_types: [...] }] }`.
- No such rule exists. Until a platform admin adds and verifies one through the existing tax-rule tools, assets are saved without a life and no depreciation is counted. Nothing guesses a life.

---

## 3. Turning the redesign on (Railway)

`VITE_DESIGN_V2` is a **build-time** flag. Vite reads it while `npm run build` builds `client/dist`, so changing it needs a rebuild.

1. Railway → project → the **web** service (`helm-finance-web`, branch `main`) → **Variables**.
2. Add `VITE_DESIGN_V2` = `true`.
3. Redeploy the service. The root `build` script rebuilds the client: `cd client && npm ci && npm run build`.
4. Check:
   - `/business` opens the new shell with the left menu Pulse · Radar · Performance · AI CFO.
   - `/admin` shows the new admin for a platform admin.
   - Every old page is still reachable under `…/classic`, `…/manage` or `…/tools`.

Do **not** change any other variable for this release. The weekly brief scheduler is **not** part of the release; it needs its own approval later.

## 4. Rollback

- **Screens:** set `VITE_DESIGN_V2` back to `false` (or delete it) and redeploy. The old UI comes back exactly; the flag-OFF bundle is byte-identical to `main`.
- **Data:** the migrations do not need to be rolled back. Everything they add is additive and is ignored by the old UI. If you ever must, each migration file ends with its own rollback block. Read it first: the asset and funding tables hold data that owners entered.
- **Batch 10 (withholding) is not behind the flag.** If it has to be undone, revert its PR. Withholding records already written stay in `withholding_records` and `debt_settlement_allocations` (031) and do no harm.

---

## 5. Manual test list (flag ON, test database, owner account)

Use a test company. For each screen, check desktop and phone width.

**Before the migrations** (they show what users see if the flag is turned on early):
- [ ] Settings → Targets says "can be saved once migrations 058 and 059 are applied", and the edit button is disabled with that note.
- [ ] Bill detail → the accountant check says "not tracked here yet".
- [ ] Performance → Profit groups says "migration 062"; Assets and Funding say "063" and "064".

**After the migrations:**
- **Pulse**
  - [ ] The hero, runway meter and target follow Settings → Targets: set 90 days, Pulse says "Target 90 days".
  - [ ] Items waiting for approval are not in the totals or in "Next 7 days".
  - [ ] Approve and Reject work and need the owner, admin or CFO role.
- **Radar**
  - [ ] Pending items show "Waiting for approval" and are not in the line.
  - [ ] The what-ifs change only the screen: worst case, pays late, collect, pay a bill later, revenue −20%, if you approve.
  - [ ] Loan repayments from Funding appear on their dates.
- **Bills & invoices / Bill detail**
  - [ ] "Mark checked" toggles, and an audit row `debt_checklist_updated` appears.
  - [ ] The withholding slip row reads from `withholding_records`.
  - [ ] "Record tax withheld by the customer" on an invoice paid net:
    - the open balance drops by the withheld amount;
    - the invoice is not overdue;
    - "Waiting for the tax slip" shows;
    - the audit row is `debt_withholding_recorded`.
  - [ ] On an invoice that already has settlement-log entries, the same action shows the 409 message: "This invoice already has payment records in the settlement log; record the withholding with the accountant."
  - [ ] After a withholding, "Mark paid" refuses an amount above the new remaining balance.
- **Counterparties**
  - [ ] Add and edit: entity form, Landlord and Lender roles, and payment terms are saved.
  - [ ] A manager or employee cannot set the tax fields.
- **Performance**
  - [ ] Before confirming the groups, Profit says "Estimate".
  - [ ] Profit groups: use the suggestions and save. Then Profit says "Accrual" and "N of M records have a category".
  - [ ] Interest on loans sits below EBITDA.
  - [ ] Other income sits below operating profit.
  - [ ] With the UMKM tax regime, the tax line reads "Turnover tax (0.5%)".
  - [ ] Export downloads a CSV.
- **Assets & balance**
  - [ ] Add an asset, optionally from an existing bill. That bill no longer counts as a cost in Profit.
  - [ ] Without a verified depreciation rule, the asset shows "no useful life yet".
- **Funding**
  - [ ] Record a founder loan with a schedule. It shows under "Still to pay back", and the repayment appears on Radar.
  - [ ] "Mark paid today" lowers the amount still owed.
  - [ ] Nothing appears in Personal.
- **AI CFO**
  - [ ] Questions are answered.
  - [ ] Clickable phrases open the right screen.
- **AI Accountant**
  - [ ] Close, packages and tax calendar load.
  - [ ] "Tax slips to make" has a number.
  - [ ] Review and download say "not available yet".
- **Settings, Documents, Accounts, Transactions, Payroll, Approvals, More:** they load, links open the right screens, and nothing scrolls sideways on a phone.
- **Admin** (platform admin only)
  - [ ] Overview, Companies, Flags & system load.
  - [ ] "Request support access" stays disabled (P-13 waits for the audit).
- **Roles**
  - [ ] Repeat Pulse, Bill detail and Funding as an accountant and as a manager.
  - [ ] Write buttons the role may not use answer "Only … can …".
- **Personal**
  - [ ] Switch to Personal and back; no business data appears in Personal.

---

## 6. Known gaps at release (honest disabled states in the app)
- Weekly brief sending (needs a scheduler; separate approval).
- Customer payment reminders (P-06, after the MiMo audit).
- Support access to a customer's data (P-13, after the MiMo audit).
- Accountant review and monthly package download (P-07).
- Company people register (P-09).
- Admin metrics: AI cost and service health (P-12).
- Merging duplicate counterparties.
- "Hire 1 person" what-if on Radar.
- Tax billing codes.
- `/allocate` vs `/pay` double counting against the 031 guard: reported as **F-01** in `PROPOSALS.md`, not fixed.
- `/api/accountant/calendar` writes on read: not used by v2; its fix is a separate task.
