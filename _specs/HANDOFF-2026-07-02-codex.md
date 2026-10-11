# Handoff → Codex — 2026-07-02 (для утра)

Кратко: сегодня были (1) продуктовые/дизайн-решения по спеке и (2) один готовый фикс,
ждущий ревью + промоута. Ниже — что зафиксировано, что проверить и что делать утром.

---

## 1. Что уже в проде (не трогать, база)
- Personal Account v1 — dark за флагами `PERSONAL_ACCOUNT_V1_ENABLED` / `VITE_PERSONAL_ACCOUNT_V1_ENABLED` (выкл).
- Email auth 042 — LIVE, бесплатный вход. Migration 044 применена (personal ws guard + one-per-owner).
- Codex-работа: brand alignment + wallet mobile fix — в main (`d4ae77cb`).

## 2. Готовый фикс на ревью (НЕ промоучен)
Ветка **`feature/email-business-access`**, коммит **`e52de039`** (в главном репо, off main).
- Проблема: email-пользователь после «Open business» на `/account` мог застрять обратно в Personal.
- Причина: `openBusiness` (PersonalProfile.jsx) и delete-business (Settings.jsx) ставили
  `activeBusinessId` + `activeWorkspaceId`, но НЕ `last_active_workspace_id` — а именно его
  первым читают `WorkspaceProvider.pickActive` и `PulseWrapper` (App.jsx:439). Стейл-значение
  `'personal'` перетирало выбор → редирект на `/account`.
- Фикс: ставим/чистим все три ключа вместе (как уже делал flag-on PersonalDashboard).
- Файлы: `client/src/pages/PersonalProfile.jsx`, `client/src/pages/Settings.jsx` (2 файла, frontend-only).
- Проверено: build Personal OFF/ON = pass; без backend/migrations/env/Telegram.
- **Нужен живой smoke как член Helm Care** (я не мог залогиниться): открыть Helm Care с `/account`,
  переключения Personal ↔ Helm Care и старый бизнес ↔ Helm Care, нет console/DB ошибок,
  бизнес-страницы (Pulse/Accounts/Transactions/Receivables/Payables/Team/Settings) работают,
  изоляция personal↔business сохранена.
- Промоут только после ревью владельца.

## 3. Решения по монетизации (ФИНАЛ, принято владельцем)
Точная формулировка:
> «Email registration/login = free identity entry; product usage is gated by plan/trial;
>  Telegram channel = paid/add-on; legacy Telegram login remains for existing users until
>  Phase 2 linking/cutover.»
- Email — фундамент идентичности, всегда бесплатный signup/login; регистрацию НЕ гейтим/НЕ лочим.
- Платный гейтинг — ПОСЛЕ создания идентичности: план/trial на продукт, лимиты, AI, Telegram, бизнес.
- Telegram — paid/add-on для новых; legacy-вход только для существующих до Phase 2.

## 4. Процессные правила (принято)
- **Каноника спек/роадмапа = локальный `_specs/`** (в репо, под git). Ведём и итерируем тут.
- **Google Drive = только финальные экспорты после approve.** Не создавать Drive-доки без «go».

## 5. Дизайн-скоуп (утверждён визуально; UX из Stitch, палитра/типографика = наш бренд)
Бренд: navy `#003366`, electric-blue `#3399FF`, page `#F4F6F8`, cards `#DDE5EC`;
JetBrains Mono для цифр; Archivo Black / Manrope. Спеки:
- `_specs/business-premium-redesign.md` — Pulse (Radar/Decision Engine/AI CFO Insight/Compliance),
  Accounts (share%), модуль AI Accountant. KEEP всё существующее, ADD за флагами.
- `_specs/roadmap-update-v4.1.md` — сводка апдейта V4.1 (монетизация, скоуп, бэклог, фазы).
- `_specs/stitch-brief-business-desktop.md` — тех-задание для Stitch (десктоп Business + AI Accountant).
Ключевое: **движок считает, AI объясняет**; никаких фейковых цифр — honest «preview/not connected».

## 6. Новое в продукте (из дизайна, для планирования — НЕ строить без задачи)
- AI Accountant = платный модуль внутри Business Workspace (`/business/accountant`): Workbench,
  Compliance Calendar (месяц-сетка), Bank Import (stepper+confidence), Deterministic Tax Draft
  (расчёт + AI explanation + Official Source Traceability), Document Center, Audit trail.
- Professional Partner Portal (Phase 3): внешняя роль `professional_partner`/CPA, per-line verify,
  accountant overrides (+audit), query threads, professional sign-off, **owner final-approval перед подачей**.
- Owner mobile: cockpit + approvals pipeline.
- Must-бэклог: e-Filing (DJP/e-Faktur/e-Bupot)+receipt, финотчётность P&L/BS/CF, tax profile
  (NPWP/PKP/FY), payment/e-Billing, immutable sign-off snapshot.

## 7. Что делать утром (приоритет)
1. Ревью + **живой smoke** ветки `feature/email-business-access` как член Helm Care (см. §2). Если ок — промоут develop→main по обычному циклу (build OFF/ON, secret scan, без dist/node_modules).
2. НЕ начинать премиум-редизайн (P1) — ждём от владельца точный скоуп следующей реализации.
3. Держать границы: не трогать Telegram, payments, bridge, reset/R001, миграции 037–039/040/041/043,
   Railway env, AI Accountant движок, premium billing без отдельной задачи.

## 8. Инварианты (напоминание)
Backend-first доступ; business_id-изоляция; Personal ≠ Business; UI за флагами (OFF ⇒ прод байт-в-байт,
0 ссылок `/api/personal`); feature branch → проверки → отчёт → merge после ревью; движок считает / AI объясняет.
