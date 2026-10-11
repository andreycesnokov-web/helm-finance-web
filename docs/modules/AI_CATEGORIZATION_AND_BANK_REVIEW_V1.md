# Module Report — AI Categorization & Bank Review Queue V1

| Field | Value |
|---|---|
| **Module** | Owner-controlled AI categorization + bank statement review queue |
| **Product** | Helm Finance (CFO AI) — financial OS for SMBs (Indonesia) |
| **Status** | ✅ Done — in production, validated live on a real Permata statement |
| **Version** | v1.0 |
| **Production commit (main HEAD at release)** | `8798068` (Merge PR #24 → main) |
| **Module-completing commit** | `38c4d46` — fix: transfer detection requires opposite directions |
| **Database migration** | `022_ai_bank_categorization_review.sql` (additive + idempotent, applied manually in Supabase) |
| **Validated on** | 2026-06-14 — Permata CSV, 43 rows |
| **Repositories** | `helm-finance-web` (web + API), `helm-finance-bot` (Telegram) |
| **Delivery** | 5 feature PRs + 2 live-fix PRs (`helm-finance-web`) + 1 PR (`helm-finance-bot`), all via `feature/* → develop → main → Railway` |

> Note: an earlier draft referenced commit `6d725df` as the production commit — that is incorrect (it predates the AI work). The accurate production HEAD at release is `8798068`; the last functional module commit is `38c4d46`.

---

## 1. Executive Summary

The module turns bank-statement import from "categorize every row by hand" into "review only the uncertain ones." Pipeline: statement → staging → deterministic cascade (rules / history / matching / keyword) → AI suggestions → **human review queue** → confirmed rows create transactions with category and system type.

**Core invariant:** the business owns its categories; AI suggests **only from existing business categories** and **never creates** them; the final choice is always the human's; the ledger does not change until confirmation.

---

## 2. Business Value

- Less manual work: on the 43-row test, **6 rows reached High confidence** (one-click import); the rest carried type/category suggestions.
- Tax-engine readiness: only **confirmed** classifications enter the ledger, with `reviewed_by` / `reviewed_at` — suitable for tax reporting.
- Per-business learning: after 3 identical confirmations the system offers to create a rule → future statements categorize without AI (cost saving).

---

## 3. Architecture — classification cascade

Rows pass levels in increasing cost order; AI runs only on what the deterministic layers cannot resolve.

| Level | Source | Confidence | Assigns |
|---|---|---|---|
| **L1** | Business rules `classification_rules` (contains/equals/starts_with) | 0.95 | type + category + counterparty |
| **L2** | Known counterparty + its most-frequent prior confirmed category (≥2×) | 0.85 | category |
| **L3** | Financial match: existing ledger tx (±1 day), payable/receivable, payroll, transfer (in/out pair) | 0.85–0.9 | match-link (no duplicate) |
| **L4** | Safe keyword hints (bank fee / interest / transfer) | 0.55–0.6 | system type only |
| **L5** | **AI** (Claude Sonnet) — batches of 30, only unresolved rows | 0–1 | type + category + counterparty + scope |
| **L6** | Manual review | — | human |

**Confidence policy:** ≥0.9 High · 0.7–0.89 Medium · <0.7 Low → `needs_review`. Special-risk types (transfer, owner_injection/withdrawal, correction, personal scope) **always** force manual review.

---

## 4. Two separated concepts

- **System Transaction Type** (cash logic): `income, expense, transfer, payroll, owner_injection, owner_withdrawal, correction`. Drives balance / cashflow / Pulse / AI CFO / reports.
- **Business Category** (analytics): belongs to the business, does not change cash impact, not global. Stored in the ledger as TEXT name (resolved from `category_id` on import to preserve the existing ledger format).

Intentionally two UI columns and two data concepts.

---

## 5. Data model (migration 022, additive / idempotent)

- **`bank_import_rows`** extended: `suggested_transaction_type / suggested_category_id / suggested_counterparty_id / suggested_scope / suggested_match_type / suggested_match_id / suggestion_source / suggestion_confidence / suggestion_reason / review_status / reviewed_by_user_id / reviewed_at / final_transaction_type / final_category_id / final_counterparty_id / final_scope`.
- **`classification_rules`** — business memory (pattern → type/category/counterparty), business-scoped, enable/disable/priority/audit.
- **`classification_feedback`** — audit of suggestion vs final choice; source for rule promotion.
- **`ai_usage_events`** — AI token/cost accounting (`business_id, batch_id, rows_processed, model, input_tokens, output_tokens, cost_estimate`).

`review_status` flow: `unprocessed → suggesting → suggested/high_confidence/needs_review/matched_existing/possible_duplicate → confirmed/excluded → imported/failed`. Import is blocked for `suggesting/needs_review/failed` without explicit confirmation.

---

## 6. API (new `/api/bank-imports/` namespace; the V1 singular endpoints are untouched)

- `POST /:batchId/suggest` — cascade L1–L4 + AI L5, writes suggestions, **does not touch the ledger**
- `GET /:batchId/review` — rows + categories + counterparties + summary + permission flag
- `POST /:batchId/confirm` — per-row **final** decisions: ownership validation, write `final_*`, audit, create transactions
- `POST /:batchId/rows/:rowId/exclude` · `…/link` (no double cash impact)
- `GET/POST/PATCH/DELETE /api/classification-rules` (CRUD + promotion candidates)
- `PATCH /api/transactions/:id` — post-import category edit → records feedback

---

## 7. AI contract & security

**AI receives only:** business categories (id + name), known counterparties, per-row desc/amount/direction/date/ref, ≤15 safe historical examples.
**AI never receives:** balances, employee lists, secrets, another business's data.
**Backend validates output:** `category_id` / `counterparty_id` belong to the business; type in allow-list; confidence 0–1; unknown category → **discarded**, confidence capped → `needs_review`.
**AI unavailable / bad JSON** → rows stay `needs_review`, import is never blocked.

All endpoints: auth + resolve business + membership + role gate + ownership validation of category/wallet/batch.

---

## 8. Permissions (RBAC)

| Role | Categories | Classify | Rules |
|---|---|---|---|
| Owner/CEO/Admin/CFO | create/edit/archive | yes | manage |
| Accountant | **propose** (create) | yes | — |
| Manager/Employee | select only | no (no review-queue access) | — |

Backend is the source of truth for permissions (Manager/Employee blocked from creating categories and from bulk-confirm).

---

## 9. Cost control

AI runs **only** for rows the cascade left unresolved (`suggestion_source === 'none'`), in batches of 20–50. Each call logs to `ai_usage_events`. Rule promotion gradually moves recurring patterns to L1 (zero AI cost).

---

## 10. Live validation (Permata CSV, 43 rows)

- ✅ Dates/amounts/directions/balance correct (prior module)
- ✅ Review queue: filters, summary chips, confidence badges, AI suggestions
- ✅ `TRF DARI MIDTRANS` → **Sales Revenue / Income / High 95%**
- ✅ `PB KE ANDREI` → **Owner Withdrawal / owner_withdrawal / Medium 85%**
- ✅ `BIAYA ADM` → Expense / Low 60% (keyword)
- ✅ AI invented zero categories (no matching category → Uncategorized)
- ✅ Duplicates create no cash impact
- ✅ Ledger import: category + type + scope + dates correct
- ✅ Manager/Employee blocked; "AI only recommends" banner shown

---

## 11. Bugs found & fixed during live testing

1. **Dedup against abandoned review batches** — re-uploading for another review pass marked every row a duplicate. Fix: only rows that actually became transactions (`linked_transaction_id`) count as prior duplicates. (`6061cfb`)
2. **Transfer false-positive** — any repeated amount was flagged "transfer" (two equal admin fees). Fix: require an opposite-direction pair (in + out). (`38c4d46`)

---

## 12. Telegram (unification, spec §20)

The bot is a separate repo/deploy. Its active flow creates payables/receivables (it does not categorize whole statements — by design). The legacy parser stopped inventing free-text categories (`category=null`); the single category source is `cashflow_categories` in the web app. No separate dictionary in the bot.

---

## 13. Acceptance criteria — all ✅

Categories fully business-scoped · AI only existing categories · AI never creates categories · owner can override any suggestion · ledger unchanged before confirmation · duplicates no cash impact · matching with telegram/payable/receivable/payroll/transfer · system type ≠ category · post-import editing preserved · Manager/Employee don't manage categories · AI unavailable → manual flow works · build passes · delivered via feature branch + PR.

---

## 14. Known limitations (V1)

PDF statements (CSV/XLSX only) · advanced fuzzy matching · automatic tax-treatment suggestion · direct bank integrations · cross-currency transfers · Telegram does not classify whole statements.

---

## 15. Recommended next step

**Tax engine (Accountant Phase 3)** — consumes this module's output directly: confirmed `type` + `category` + `reviewed_by/at`. Alternatives: PDF statements (wider import coverage), Partner Portal (external accountant access).
