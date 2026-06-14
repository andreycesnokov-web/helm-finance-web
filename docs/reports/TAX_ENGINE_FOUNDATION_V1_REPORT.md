# Tax Engine Foundation V1 — Production Implementation Report

| Field | Value |
|---|---|
| **Document type** | Production Implementation Report |
| **Module** | Tax Engine Foundation V1 |
| **Version** | 1.0 |
| **Status** | Completed / Active |
| **Jurisdiction** | Indonesia |
| **Migration** | 023 |
| **Verified date** | 2026-06-15 |
| **Production baseline** | `9f3eb66` (main HEAD at report time) |
| **Source of truth** | No — implementation snapshot |

> This is an implementation snapshot, not a source-of-truth spec. The authoritative
> module reference is [docs/modules/TAX_ENGINE_FOUNDATION_V1.md](../modules/TAX_ENGINE_FOUNDATION_V1.md);
> product/architecture source of truth lives under [docs/specs/](../specs/).

---

**Продукт:** Helm Finance (CFO AI) — AI-финансовая ОС для малого/среднего бизнеса (Индонезия)
**Задача:** Фундамент AI Accountant — Tax Profile · Versioned Rules Registry · Official Sources · Applicability Engine · Compliance Calendar · AI/CFO/Decision интеграция
**Статус:** ✅ Foundation завершён (не полноценная система подачи деклараций), в production
**Юрисдикция V1:** Indonesia national
**Migration:** `023_tax_engine_foundation.sql` (additive/idempotent, применена) поверх `020`
**Delivery:** 6 PR через `feature/* → develop → main → Railway`, `main` ни разу не сломан
**Репозиторий:** `helm-finance-web` · спеки: `docs/specs/*` · доклад: `docs/modules/TAX_ENGINE_FOUNDATION_V1.md`

---

## 1. Executive Summary

Построен детерминированный фундамент compliance-слоя поверх существующего CFO AI Core. Главный принцип:

```
Официальный источник (verified)
+ Версионированное детерминированное правило (active)
+ Налоговый профиль бизнеса
= Применимое обязательство
```

**AI не определяет** ставку, срок, периодичность, применимость или юридическое обязательство. AI **только** объясняет, суммирует, указывает недостающие данные и показывает официальный источник. Все расчёты — детерминированный код + версии правил. Каждый расчёт human-review-gated, с дисклеймером.

Это **не** tax-filing система: нет автоподачи, автооплаты, полного расчёта налогов, Coretax-интеграции, Partner Portal.

---

## 2. Аудит (что было до задачи)

Migration 020 уже создал таблицы `official_sources / tax_rules / tax_profiles / compliance_events / business_addons` и засидил 3 индонезийских правила (PPN, PPh Badan, PPh 21) как `active` — **но с непроверенными источниками**. Существовали endpoints `status/profile/rules/sources/calendar/remind`, entitlement-чек, дисклеймер RU/EN/ID, страница `Accountant.jsx`.

**Отсутствовало:** generic audit-таблица, версионирование правил, enforce «active требует verified source», applicability engine с объяснениями, структурные сроки, AI Q&A, CFO/Decision интеграция, admin-UI реестра, страницы профиля/календаря.

**Решение:** расширять существующие таблицы (`ADD COLUMN`), **не** создавать дубли (`business_tax_profiles`/`compliance_obligations` не создавались).

---

## 3. Данные (migration 023 — только additive)

| Таблица | Роль | Scope |
|---|---|---|
| `official_sources` | + source_type, validity window, `status`, content_hash, notes | Platform (global) |
| `tax_rules` | + `supersedes_rule_id`, `reviewed_by/at`, `due_date_rule_json`, multi-entity; `UNIQUE(rule_code, version)` | Platform (global) |
| `tax_profiles` | + `profile_status`, `verified_*`, npwp/nib, withholding, created_by | Business |
| `compliance_events` | + `rule_version`, `period_start/end`, `amount_status`, `confirmed_amount`, `source_verification_required`, `generated_*` | Business |
| `audit_events` | **новая** generic append-only (DB-триггер блокирует UPDATE/DELETE) | Platform + business |
| `business_addons` | entitlement `ai_accountant_compliance` | Business |

**Legacy seed-handling:** 3 непроверенных `active`-правила переведены в `under_review` (не draft, не удалены); их существующие события помечены `source_verification_required = TRUE` (сохранены для истории, исключены из подтверждённого давления).

**Preflight перед применением:** нет дублей `(rule_code, version)`, нет NULL-версий, `version` INT, нет CHECK-constraint на статус, типы FK выверены. **Verify-вывод подтвердил:** `under_review`=3, `active`=0, `audit_events` создана, 7 событий помечены.

---

## 4. Реализация по PR

| PR | Ветка | Содержание |
|---|---|---|
| **PR1** | tax-engine-foundation | Migration 023 + `recordAudit()` (append-only) + `canEditTaxRules()` (platform-gate) + `effectiveRuleActive()` (active И rule+source verified). Чисто additive, поведение не менялось. |
| **PR2** | tax-rules-registry | Реестр: CRUD источников + `/verify`; правила draft→submit→activate (**enforce verified source**, 422 иначе)→deprecate→new-version (`supersedes_rule_id`, active неизменяем). Страница `/admin/tax-rules`. Audit на каждое. |
| **PR3** | tax-profile-applicability | Профиль: status workflow, completeness %, `/verify`, critical-field audit, npwp/tax_identifier mismatch. **`evaluateApplicableTaxRules()`** (детерминированно, verdict+причина+missing fields). UI `/accountant/tax-profile`. |
| **PR4** | tax-calendar-duedates | **`calculateDueDate()`** (структурный JSON, throw на unknown) + `server/lib/dueDate.js` + **16 unit-тестов**. Календарь на applicability+structured dates, идемпотентный, paid/filed не пересчитывает. UI `/accountant/calendar`. |
| **PR5** | tax-ai-cfo-integration | `/accountant/ask` (AI-контракт), CFO-контекст `compliance:{}`, Decision Engine `tax_obligations` factor. Главная `/accountant`: плитки + AI-окно. |
| **PR6** | tax-telegram-docs | 6 Telegram-шаблонов RU/EN/ID + manual test endpoint. Документация модуля. |

---

## 5. Ключевые движки

**Rule lifecycle:** `draft → under_review → active → deprecated`; изменение active = **new version** (старая неизменна, хранит связи с событиями). Активация **блокируется** без verified-источника.

**`effectiveRuleActive(rule, source)`** = `status=active` AND rule verified AND source verified. Только такие правила питают obligations/AI/Decision.

**Applicability:** `evaluateApplicableTaxRules()` → `{applicable, excluded, missing_profile_fields, warnings}`, каждый verdict с причиной («Requires PT; business is CV», «vat_status missing»). Без LLM.

**Due dates:** `calculateDueDate()` — типы `day_of_next_month / end_of_next_month / months_after_period_end`. Чистая UTC-арифметика (timezone-stable, Asia/Jakarta fallback), **неизвестный тип → throw, не угадывает**. Тесты: февраль, високосный, клэмп конца месяца, смена года, ошибки — **16/16 PASS**.

---

## 6. AI-контракт (§17)

`/accountant/ask` получает **только** детерминированные факты (профиль-подмножество, applicable rules с rule_code/version/source, calendar). Промпт запрещает выдумывать ставку/срок/требование; требует ссылку на rule_code+version+source; при отсутствии активного правила → «determination not possible»; всегда возвращает дисклеймер. **Локальный fallback** сохраняет работу при недоступности модели. AI **не** считает суммы.

---

## 7. Интеграции

**CFO AI** (`buildAiCfoContext.compliance`): `upcoming_7d/30d/90d`, `overdue_count/amount`, estimated vs confirmed, review/approval pending, missing fields. Непроверенные/оплаченные исключены. **Суммы — давление, не вычитаются из cash.**

**Decision Engine:** snapshot `tax_obligations` (только reviewed/owner-approved + verified + неоплаченные). Payment-симуляция флагует, если платёж оставит налоговое обязательство (≤30 дней) непокрытым. Draft/unverified/estimate-only **не** считаются подтверждёнными. Текущий cash меняется только фактическим платежом.

---

## 8. Безопасность и права

Все business-endpoints: `auth → active business → membership → role → entitlement → business isolation`. Реестр правил/источников — **platform-admin** (`canEditTaxRules`). Профиль — owner/ceo/admin/cfo. **Manager/Employee — нет доступа** к профилю, реестру, полному календарю. `audit_events` **append-only** (DB-триггер, отключаемый для обслуживания). Backend — окончательный источник прав; frontend доступ не выдаёт.

---

## 9. Telegram

6 шаблонов RU/EN/ID: `tax_profile_incomplete, tax_obligation_due_soon, tax_obligation_overdue, tax_rule_source_outdated, professional_review_required, owner_tax_approval_required`. Manual test endpoint (owner/admin). Deep-links при `WEB_APP_URL`. **Полную декларацию не показывает.** Планировщик — следующая задача.

---

## 10. Acceptance Criteria (§31) — все ✅

Профиль business-scoped · правила версионированы · active неизменяем · active требует verified source · applicability детерминированна · календарь идемпотентен · AI не выдумывает ставки/сроки · каждый ответ показывает source+disclaimer · CFO AI получает compliance pressure · cash не меняется до платежа · Manager/Employee без tax-admin · RU/EN/ID · Bank Import и AI Categorization не сломаны · migration additive/idempotent · через feature branch + PR · документация в repo.

---

## 11. Тесты и сборка

- `tests/dueDate.test.js`: **16/16 PASS**.
- `node --check` + `npm run build`: зелёные во всех 6 PR.
- Migration verify: подтверждён (under_review=3, audit создана, events помечены).

---

## 12. Known Limitations (V1)

Нет полного расчёта налогов · нет filing/Coretax-интеграции · нет Professional Partner Portal · нет авто-мониторинга источников · нет PDF/OCR налоговых документов · только Indonesia · 3 seed-правила в `under_review` до проверки лицензированным специалистом.

---

## 13. Следующие вехи (по roadmap V4.0)

1. **Tax Draft Engine** — детерминированный расчёт (tax_base, adjustments, rate, estimated_liability, source_trace) из confirmed-данных; AI объясняет, специалист проверяет, владелец подтверждает.
2. **Professional Partner Portal** (Phase 3) — лицензированная проверка, review queue, SLA.
3. **Compliance scheduler** — авто-напоминания (3д/1д/overdue) поверх готовых Telegram-шаблонов.
4. **Forecasting V2** — 30/60/90 cash forecast с учётом налоговых обязательств.
