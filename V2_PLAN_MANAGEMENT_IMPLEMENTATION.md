# CFO AI V2 — Plan Management implementation

**Branch:** `feat/v2-email-password-auth` (local, not pushed) · **Head:** `575d9ec` · **Date:** 2026-10-17
**Workspace type:** Business (commercial billing) + Platform/admin. Personal workspaces are not touched.
**Companion documents:** `V2_BILLING_EXISTING_SYSTEM_AUDIT.md` (Phase A), `V2_DYNAMIC_PLAN_MATRIX.md` (Phase B contract).

The billing system built in `20261015033808`, `20261017090000` and `20261017120000` already had immutable plan versions,
CAS catalog commands, subscription pinning, overrides and quota reservations. This work **extends** it; nothing was
rewritten from scratch, no financial RPC was changed, no historical migration was edited.

## 1. What changed

| Area | Change | Where |
|---|---|---|
| Value contract | integer ≥ 1 = limited · `0` = disabled · `null` = unlimited · key **absent = undecided** → publication refused (`billing_terms_incomplete`) | `billing_terms_error` in `supabase/migrations/20261018090000_billing_plan_matrix.sql` |
| New meters | `accounts` (active wallets, current state), `bank_rows` (statement rows/month), `mcp`, `ai_accountant`, `ai_extraction` | same migration (`rpc_billing_quota`, `billing_usage`, catalog rows) + `server/lib/billingRoutes.js` |
| Catalog texts | `unit_i18n`, `definition_i18n` for every limit in EN/RU/ID | same migration |
| Owner values | Starter/Control/Pro **v2 drafts** with exactly the approved values (price, 7-day trial, users, transactions, documents, AI Assistant); everything else left undecided | DO block in the same migration |
| Super Admin only | catalog writes (`draft`, `publish`, `archive`, presentation) require `super_admin`; platform admins can read and preview | `catalogWriter` in `server/lib/commercialBilling.js` |
| Diff + impact | preview returns the effective-terms diff and the companies currently on that plan | `POST /api/admin/billing/catalog/:code/preview` |
| Public catalog | `GET /api/public/plans` (no auth): published, approved, visible, effective, non-fixture plans only | `billing_public_catalog()` + `commercialBilling.js` |
| Website sync | dependency-free loader `client/public/embed/cfo-pricing.js` fills marked elements; static text stays if the API is down | §5 |
| Flag OFF | "billing paused" for `commercial_v2` companies | `server/lib/billingPaused.js`, `commercialAdmission.js`, `server/index.js` |
| Admin UI | trial in days, incomplete-terms message, affected companies, **Not decided** limit mode, features seeded from effective values | `client/src/v2/admin/billing/PlansSection.jsx`, `copy.js` |
| Customer UI | billing page lists every metered limit (headline first), localized; `0` reads "Not included" | `client/src/v2/pages/Billing.jsx`, `lib/billingCopy.js` |

## 2. Resolution order (effective entitlement)

`billing_effective_version(company)` → `billing_effective_terms(company)`:

1. **Version:** active admin grant → verified paid service period → trial window (`trial_hours` snapshotted on the
   account at activation). No active source → no commercial access.
2. **Terms:** that version's `features` (+ `billing_feature_defaults()`: `always` features on for every plan;
   `absent_allows` features on when the key is missing) and `limits`.
3. **Overrides:** active company overrides (`starts_at ≤ now < ends_at`, not revoked) replace the matching feature or
   limit. When one expires the plan value applies again with no job or migration.

So: *active subscription snapshot → permitted company override → effective entitlement*, as required.

## 3. Subscription rules

- A company is pinned to the version it selected. Publishing a new version changes **only new selections**; the
  preview lists the companies on the plan and states that they keep their version until moved explicitly.
  Verified: existing Starter client stays on v3 (1,000) after v6 (2,000) is published (browser + `billingPlanMatrixHttp`).
- Plan change during a trial applies at once and does **not** move the trial end (`billingPlanMatrixHttp`).
- Trial length comes from the version (`trial_hours`, 168 = 7 days; a 14-day version gives 336 h to new trials only).
- No retroactive worsening: versions are immutable (`plan_versions` trigger), pinned accounts never follow a publish.

## 4. API

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/api/public/plans` | anyone | `Cache-Control: public, max-age=60`, `Access-Control-Allow-Origin: *`; 30 s in-memory cache per instance; 503 `catalog_unavailable` on error |
| GET | `/api/admin/billing/catalog` | platform admin | plans, versions, catalog items |
| POST | `/api/admin/billing/catalog/:code/preview` | platform admin | dry run: validity, `changes` (effective diff), `affected` |
| POST | `/api/admin/billing/catalog/:code` | **super_admin** | `draft` / `publish` (needs `confirm_publish`) / `archive` / presentation; CAS on `expected_version`; idempotent `request_key`; audited |
| GET | `/api/admin/billing/companies[/:id]`, `/subscriptions`, `/overrides`, `/audit` | platform admin | read |
| POST | `/api/admin/billing/companies/:id/:action` | platform admin | assign, schedule, grant, revoke, extend, override, revoke_override; reason required; audited |
| GET | `/api/billing` | company member | own plan, trial, usage, offered plans |

Errors the UI maps to text: `super_admin_required`, `billing_terms_incomplete`, `billing_publish_not_confirmed`,
stale `expected_version` (CAS).

## 5. Website embed contract

```html
<script src="https://<app>/embed/cfo-pricing.js" data-api="https://<app>/api/public/plans" defer></script>
<div data-cfo-plan-card="starter">…<span data-cfo-plan="starter" data-cfo-field="price">$59</span>
  <span data-cfo-plan="starter" data-cfo-limit="transactions">1,000</span>…</div>
```

Fields: `price | name | description | trial-days | interval`; limits by key; features by key (✓ / — / "(Beta)");
`[data-cfo-glossary]` explains each limit. Language: `data-lang`, else `<html lang>`, else EN. The root gets
`data-cfo-pricing="live"` when filled, `"static"` when the API is unreachable (static text is kept).

Verified on a **scratch copy** of `website-design/pricing-page.html` served from another origin (the original file was
not edited): live → Starter 2,000 after publish; API down → static text, all cards visible; mobile 375 px without
horizontal scroll. Publishing the loader on the real site needs owner approval.

**Staleness after a publish:** the instance that handled the publish clears its cache at once; other instances serve
their cached copy for ≤ 30 s; browsers/CDN may keep a response ≤ 60 s. Worst case ≈ 90 s before every visitor sees
a new publication. Enforcement never uses this cache.

## 6. Flag OFF (`COMMERCIAL_BILLING_ENABLED=false`) = billing paused

For companies with `billing_policy='commercial_v2'`: legacy Free limits never apply; features come from the effective
version, else the selected version, else core finance only; nothing is metered; an expired trial does not restrict;
costly external features (`ai`, `cfo_ai`, `ai_accountant`, `api`, `integrations`) answer `503 billing_paused`; a feature
missing from the plan answers `402`. Legacy companies keep exactly today's behaviour. Billing routes answer 404.
Verified by `billingPausedHttp` (6) and the rehearsal `billing_off` phase (5).

## 7. Defects found and fixed during this work

| Finding | Effect | Fix |
|---|---|---|
| Editor seeded features from stored values only | publishing a one-line limit change would switch off radar, transactions, accounts, bills, tax, accounting export for new Starter subscribers | seed from effective value (`575d9ec`) |
| Diff treated a missing feature as off | the change above was invisible in the review step | diff compares effective values (`575d9ec`, regression test in `billingPlanMatrixHttp`) |
| Undecided limit shown as "Not available" | saving would decide "disabled" (0) silently | "Not decided" mode keeps the key absent (`575d9ec`) |
| Customer page omitted transactions and newer meters | the main approved limit was invisible to customers | full list (`575d9ec`) |
| Diff showed always-on `pulse` as a change | noise in the review step | same diff fix |

## 8. Not done / owner decisions

- PENDING values (`V2_DYNAMIC_PLAN_MATRIX.md` §2) and the feature matrix (§3): the drafts cannot be published until decided.
- Company actions (overrides, free access, plan assignment) are allowed for **any platform admin**; catalog changes are
  super_admin only. Decide whether overrides/grants should also be super_admin only.
- Export limit has no server counter (`Нет серверного счётчика`), so it cannot be limited yet.
- Online payments remain out of scope (no payment provider is connected).
