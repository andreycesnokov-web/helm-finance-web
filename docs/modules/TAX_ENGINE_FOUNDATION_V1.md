# Module Report — Tax Engine Foundation V1

| Field | Value |
|---|---|
| **Module** | AI Accountant foundation: Tax Profile · Versioned Rules Registry · Official Sources · Applicability · Compliance Calendar |
| **Product** | Helm Finance (CFO AI) — financial OS for SMBs |
| **Status** | ✅ Foundation complete (not a full tax-filing system) |
| **First jurisdiction** | Indonesia (national) |
| **Database migration** | `023_tax_engine_foundation.sql` (additive + idempotent; applied manually in Supabase) — builds on `020` |
| **Delivery** | 6 PRs via `feature/* → develop → main → Railway` |
| **Governing specs** | `docs/specs/AI_ACCOUNTANT_MODULE_SPECIFICATION_V1.0.md`, `docs/specs/SYSTEM_ARCHITECTURE_V4.0.md` |
| **Implementation report** | [docs/reports/TAX_ENGINE_FOUNDATION_V1_REPORT.md](../reports/TAX_ENGINE_FOUNDATION_V1_REPORT.md) |

---

## 1. Architecture

```
Official source (verified)
+ Versioned deterministic rule (active)
+ Business tax profile
= Applicable compliance obligation
```

The AI never determines a tax rate, deadline, frequency, applicability or legal
obligation. It only explains, summarises, points out missing data and shows the
official source. Deterministic engines compute everything.

## 2. Tables (extend migration 020; no duplicate tables created)

| Table | Role | Scope |
|---|---|---|
| `official_sources` | Authority/title/url + `status` + `last_verified_at` | Platform (global) |
| `tax_rules` | Versioned rules; `status`, `version`, `supersedes_rule_id`, `due_date_rule_json`, `official_source_id` | Platform (global) |
| `tax_profiles` | One per business; `profile_status`, completeness, `verified_*`, npwp/nib | Business |
| `compliance_events` | Generated obligations; `rule_version`, `period_start/end`, `amount_status`, `source_verification_required` | Business |
| `audit_events` | Generic append-only audit (DB trigger blocks UPDATE/DELETE) | Platform + business |
| `business_addons` | `ai_accountant_compliance` entitlement | Business |

Migration 023 adds columns only (`ADD COLUMN IF NOT EXISTS`), creates
`audit_events` + its append-only trigger, `UNIQUE(rule_code, version)`, and
demotes the 3 unverified seed rules from `active` → `under_review` (their
existing events are flagged `source_verification_required`, never deleted).

## 3. Rule lifecycle (platform admin only)

```
draft --submit--> under_review --activate--> active --deprecate--> deprecated
                                   |
                                   +-- new-version --> draft (v+1, supersedes_rule_id -> old)
```

- An **active** rule is immutable; editing requires a new version. The old row
  stays and keeps its links to already-generated events.
- **Activation is blocked unless the rule cites a verified official source.**
- `effectiveRuleActive(rule, source)` = `status=active` AND rule verified AND
  source verified. Only effective rules drive obligations / AI / Decision Engine.

## 4. Official source requirement

A rule cannot become `active` without an `official_source_id` whose source is
`verified`/`active` with a `last_verified_at`. Allowed sources: government
authorities, official regulations/portals, ministry publications. Blogs, SEO
articles, forums and AI-generated text are not acceptable.

## 5. Applicability engine — `evaluateApplicableTaxRules({ taxProfile, activeRules, asOfDate })`

Deterministic, no LLM. Returns `{ applicable_rules, excluded_rules,
missing_profile_fields, warnings }`, each verdict with a reason
("Requires entity type PT; business is CV", "vat_status is missing", …). Checks
effective dates, legal entity type, `vat_status`, employee status.

## 6. Calendar generation — `calculateDueDate(rule, periodStart, periodEnd)`

Structured `due_date_rule_json` only: `day_of_next_month`, `end_of_next_month`,
`months_after_period_end` (`day_policy:same_day_or_month_end` or explicit `day`).
Pure UTC date math → timezone-stable; **unknown types throw — never guessed**.
Covered by `tests/dueDate.test.js` (16 cases incl. Feb / leap year / month-end
clamp / year rollover / error paths).

Generation is idempotent (`onConflict: business_id,rule_code,period`); `paid`/
`filed` events are never recomputed; rules without a structured due date are
skipped with a warning, not guessed.

## 7. AI Accountant & integrations

- `POST /accountant/ask`: AI explains using only deterministic facts; strict
  prompt forbids inventing a rate/deadline/requirement; cites
  `rule_code`+`version`+source; if no active rule applies → "determination not
  possible"; always returns the disclaimer; local fallback if the model is down.
- **CFO AI** (`buildAiCfoContext.compliance`): `upcoming_7d/30d/90d`,
  `overdue_count/amount`, estimated vs confirmed amounts, review/approval
  pending, missing fields. Amounts are context only — never subtracted from cash.
- **Decision Engine**: payment simulation flags reviewed/owner-approved tax
  obligations due within 30d that a payment would leave uncovered. Draft /
  unverified / estimate-only obligations are never treated as confirmed.

## 8. Security & permissions

Every business endpoint: auth → active business → membership → role →
entitlement → business isolation. `tax_rules`/`official_sources` admin endpoints
require a platform admin (`canEditTaxRules`). Tax profile editing: owner/CEO/
admin/CFO. Manager/Employee have no access to the tax profile, rule registry or
full compliance calendar. Every rule/source/profile/calendar action writes an
`audit_event`.

## 9. Telegram

Six templates (RU/EN/ID): `tax_profile_incomplete`, `tax_obligation_due_soon`,
`tax_obligation_overdue`, `tax_rule_source_outdated`,
`professional_review_required`, `owner_tax_approval_required`. Manual test
endpoint `POST /accountant/telegram/test` (owner/admin). Telegram never shows a
full return — short alerts + deep links only. Scheduler is future work.

## 10. Known limitations (V1)

No full tax calculation, no filing integration, no Coretax integration, no
Professional Partner Portal, no automatic source monitoring, Indonesia only.
Three seed rules ship as `under_review` and must be verified by a licensed
professional before activation.
