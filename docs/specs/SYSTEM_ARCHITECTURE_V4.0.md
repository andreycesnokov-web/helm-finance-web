HELM FINANCE
SYSTEM ARCHITECTURE V4.0
ACCESS, PLANS, TRIAL & AI ACCOUNTANT ECOSYSTEM INTEGRATION
Одна экосистема: CFO AI Core + AI Accountant + Professional Partner Network + Telegram / Mobile / Web.
Контроль версии
Содержание
1. Архитектурное назначение
2. Единая продуктовая экосистема
3. Архитектурные принципы
4. Домены и модули
5. Business Workspace и tenancy
6. Identity, roles и permissions
7. Финансовый источник истины
8. AI и детерминированные движки
9. AI Accountant architecture
10. Professional Partner Layer
11. Documents, Bank Import и reconciliation
12. Access, plans, trial и add-ons
13. Backend access flow
14. Telegram, Mobile, Web и WhatsApp
15. Data model V4.0
16. Jobs, notifications и workers
17. Security, audit и compliance
18. Scalability и deployment
19. Lifecycle flows
20. Current limitations и next architecture milestones
1. Архитектурное назначение
Документ определяет технический Source of Truth для единой экосистемы Helm Finance. Он заменяет модель, где CFO AI и будущий AI Accountant могли рассматриваться как отдельные продукты.
CFO AI Core — cash, wallets, transactions, payroll, receivables/payables, approvals, Decision Engine, Pulse.
AI Accountant — bank imports, documents, tax profile, compliance calendar, tax drafts, official sources.
Professional Partner Network — licensed accountants, tax consultants, review workflow and SLA.
Channels — Web/Desktop, Mobile/PWA, Telegram and future WhatsApp.
Commercial Core — plans, trial, add-ons, usage limits, entitlements, billing and upgrade flows.
2. Единая продуктовая экосистема
AI Accountant использует те же business_id, members, wallets, transactions, documents, approvals и audit events. Отдельная база пользователей, отдельный ledger и отдельный billing запрещены.
3. Архитектурные принципы
4. Домены и модули
5. Business Workspace и tenancy
business_id является владельцем financial, document и compliance records.
user_id идентифицирует человека; created_by_user_id и approved_by_user_id фиксируют ответственность.
Один пользователь может состоять в нескольких бизнесах с разными ролями и тарифами.
Любой переданный business_id проверяется через business_members. Неверный явно переданный id должен возвращать 403, а не тихо переключаться на другой бизнес.
Personal finance в будущем реализуется как отдельный workspace type, а не смешивается с business cash.
6. Identity, roles и permissions
7. Финансовый источник истины
Wallet balance хранится как вычисляемое значение из confirmed transactions либо поддерживается materialized snapshot только как оптимизация, но не как независимая финансовая истина.
8. AI и детерминированные движки
LLM не пересчитывает суммы и не подменяет deterministic result.
AI CFO использует business-only cash и отделяет pending от confirmed.
AI Accountant не придумывает ставку, срок или применимость налога.
При отсутствии правила ответ помечается Source verification required.
Local fallback должен сохранять базовый расчёт даже при недоступности внешней AI-модели.
9. AI Accountant architecture
AI Accountant — add-on поверх CFO AI Core. Он получает подтверждённые финансовые данные, но хранит собственные compliance entities, rule versions и review states.
10. Professional Partner Layer
Партнёры не являются обычными business members без ограничений; доступ назначается к конкретным бизнесам и scope.
Профиль хранит firm, license number/type/level, issuing authority, status, verification date, jurisdictions, languages and SLA.
Верификация лицензий V1 выполняется вручную по официальному реестру.
Professional cannot access owner personal workspace, payment credentials or unrelated businesses.
Каждое review action фиксируется в audit trail.
11. Documents, Bank Import и reconciliation
12. Access, plans, trial и add-ons
Subscription принадлежит Business. Add-ons расширяют базовый план без создания отдельного аккаунта или отдельной подписки AI Accountant.
13. Backend access flow
Frontend, Telegram Bot, Mobile App и AI Chat могут запрашивать доступ, но не могут самостоятельно разрешать действие.
14. Telegram, Mobile, Web и WhatsApp
15. Data model V4.0
Все business records имеют business_id.
Документы хранят private storage pointer; download выдаётся через signed URLs.
Tax rules never overwrite historical versions.
Tax draft stores rule version references and calculation inputs for reproducibility.
Audit events immutable for normal users.
16. Jobs, notifications и workers
MVP может использовать Railway cron/workers. На масштабе — queue + PostgreSQL/Redis workers, idempotency keys and retries.
17. Security, audit и compliance
Strict business isolation for every endpoint and file.
No self-approval except explicit Owner/CEO policy.
Bot calls require a separate TELEGRAM_WEBHOOK_SECRET, not the Bot Token.
Professional access is assignment-scoped and read/write permissions are explicit.
Sensitive documents use private storage, signed URLs and access logs.
Financial, tax and billing actions create immutable audit events.
AI outputs store model, source context, rule versions and confidence where applicable.
Automated filing is out of V1 and requires separate legal/security approval.
18. Scalability и deployment
19. Lifecycle flows
19.1 New business and trial
19.2 Accountant add-on activation
19.3 Bank import
20. Current limitations и next architecture milestones
Full audit trail must be completed before production tax workflows.
Transfers require two-legged ledger implementation if not yet complete.
Bank PDF parsing follows structured CSV/XLSX support.
Tax rules for Indonesia require licensed professional validation before activation.
Professional billing and payouts are separate commercial milestones.
Native mobile app follows stable PWA and production API contracts.
Automated filing remains out of scope until legal, security and government integration review.

## Tables (flattened)

Версия | 4.0
Статус | Technical Source of Truth
Дата | Июнь 2026
Назначение | Единая архитектура Helm Finance / CFO AI: финансовое ядро, AI Accountant, профессиональная проверка, доступ, тарифы и каналы.
Версия | Дата | Изменение | Статус
System Architecture V3.3 | До июня 2026 | Исходные документы по access, plans, trial и roadmap | Superseded
4.0 | Июнь 2026 | Объединение CFO AI и AI Accountant в единую продуктовую экосистему | Current Source of Truth
Главное изменение V4.0: AI Accountant не является отдельным приложением. Это платный модуль внутри общего Business Workspace, использующий те же данные, роли, биллинг, Telegram identity и audit trail.
Business остаётся главным финансовым объектом. Все интерфейсы, AI-модули, бухгалтерские функции и профессиональные партнёры работают вокруг одного Business Workspace.
HELM FINANCE / CFO AI ECOSYSTEM
│
├── CFO AI Core
│   ├── Business Workspace
│   ├── Wallets & Transactions
│   ├── Payroll
│   ├── Receivables / Payables
│   ├── Team & Approvals
│   ├── Pulse / Radar
│   └── AI CFO Decision Engine
│
├── AI Accountant Add-on
│   ├── Tax & Compliance Profile
│   ├── Tax Rules Registry
│   ├── Official Sources Layer
│   ├── Compliance Calendar
│   ├── Document Center
│   ├── Bank Import & Reconciliation
│   ├── Tax Draft Engine
│   └── Professional Review Workflow
│
├── Professional Partner Portal
├── Access & Commercial Core
└── Web / Mobile / Telegram / WhatsApp
Принцип | Правило
Business ownership | Financial and compliance data belongs to business_id, not to the acting user.
Single source of truth | Database + backend validation + versioned rules own financial truth.
AI boundary | AI classifies and explains; deterministic engines calculate.
No silent cash impact | Only confirmed transactions change wallet balances.
Approval ≠ Payment | Approving an obligation never pays it.
Human control | Tax drafts require professional review and owner approval before filing/payment.
Channels are interfaces | Telegram, Mobile, Web and WhatsApp cannot bypass backend rules.
Additive evolution | No destructive migrations or silent loss of legacy data.
Домен | Состав
Identity & Workspace | Users, businesses, members, invitations, roles, active business selection.
Financial Ledger | Wallets, transactions, transfer legs, corrections and reconciliation.
Operational Finance | Receivables, payables, payroll, tasks, reminders and approvals.
Decision Intelligence | Pulse, CFO Score, runway, risks, approval/payment simulation and next actions.
Documents & Imports | Files, statements, receipts, invoices, raw rows, match review and deduplication.
Compliance | Tax profile, rules, sources, calendar, obligations and filing status.
Professional Services | Partner profiles, assignments, review queue, SLA and verification.
Commercial Access | Plans, subscriptions, trial, usage, feature flags, add-ons and billing events.
Communication | Telegram bot, notifications, PWA/mobile push, email and future WhatsApp.
business_id = кому принадлежат данные
created_by_user_id = кто создал
approved_by_user_id = кто подтвердил
source_channel = web | telegram | mobile | api | whatsapp
last_action_channel = канал последнего действия
Роль | Доступ по умолчанию
Owner / CEO | Полный доступ, team management, approvals, payments, plans, accountant partner assignment.
Admin | Operational administration and approvals within granted permissions.
CFO | Full financial visibility, decision analysis, approvals and compliance oversight.
Accountant | Confirmed finance, categorisation, reconciliation, drafts; no owner-level settings.
Tax Consultant | Compliance profile, rules-based drafts, professional review, source verification.
Manager | Submissions, own operational tasks, limited records; no full cash by default.
Employee | Own submissions, receipts and requested documents only.
Auditor | Read-only access to assigned business and audit evidence.
Backend-first security: интерфейс может скрывать кнопки, но окончательное разрешение всегда проверяет backend.
Событие | Cash impact
Income transaction | Увеличивает выбранный wallet.
Expense transaction | Уменьшает выбранный wallet.
Payroll payment | Уменьшает wallet на net paid один раз.
Correction | Signed impact; требует audit.
Receivable creation/approval | Нет cash impact.
Payable creation/approval | Нет cash impact.
Receivable received | Создаёт income transaction.
Payable paid | Создаёт expense transaction.
Training / pending submission | Не влияет на cash и confirmed totals.
Bank import preview | Не влияет до подтверждения import batch.
Database records
↓
Deterministic engines
- cash & balance
- burn & runway
- approval/payment simulation
- reconciliation
- tax calculation rules
↓
Structured result
↓
AI explanation and recommendations
↓
Web / Telegram / Mobile
Tax Profile
+ Versioned Tax Rule
+ Confirmed Transactions
+ Supporting Documents
+ Reporting Period
=
Structured Tax Draft
↓
Professional Review
↓
Owner Approval
↓
Ready for Payment / Filing
Компонент | Архитектурная функция
Tax Profile | Jurisdiction, entity type, tax regime, identifiers, reporting year, VAT/PKP and payroll status.
Rules Registry | Versioned rules with effective dates, status and deterministic parameters.
Official Sources | Authority, title, URL, effective date, last verified date and rule version.
Compliance Calendar | Generated obligations and deadlines derived from profile + active rules.
Tax Draft Engine | Tax base, adjustments, rates, liabilities, assumptions and warnings.
Review Workflow | AI Draft → Professional Review → Owner Approval → Ready.
Upload CSV / XLSX / PDF / Image
↓
Document Center / Import Batch
↓
Raw extraction
↓
Duplicate & match detection
↓
AI category / counterparty / tax suggestions
↓
Review Queue
↓
Confirm
↓
Transactions + reconciliation result
Entity | Назначение
documents | Metadata, storage pointer, source, links and review status.
bank_import_batches | One uploaded statement and its processing lifecycle.
bank_import_rows | Immutable raw parsed rows.
bank_import_matches | Suggested links to transactions, debts, payroll and duplicates.
bank_reconciliations | Opening/closing balance and discrepancy evidence.
Ни документ, ни строка выписки не создают confirmed transaction автоматически. Сначала review, затем explicit confirmation.
Access decision =
Membership
+ Role / Permission
+ Subscription status
+ Base plan entitlement
+ Add-on entitlement
+ Usage limit
+ Security validation
Слой | Примеры
Base plans | free, starter, business, founder, enterprise
Trial | 7-day full trial at maximum available base features; premium human services excluded unless granted.
Add-ons | AI Accountant Compliance, Professional Review, Full Service, WhatsApp Channel.
Usage | transactions, AI requests, voice, documents, imports, seats, exports.
Overrides | feature_flags for beta, enterprise or temporary access.
User or Channel Action
↓
Authentication / Bot Secret
↓
Resolve Active Business
↓
Business Membership
↓
Role & Permission
↓
Subscription / Trial Status
↓
Feature + Add-on Entitlement
↓
Usage Limit
↓
Domain Validation
↓
Database Write
↓
Usage Event + Audit Event + Notification
Канал | Роль в экосистеме
Web/Desktop | Полный financial, compliance and professional workspace; complex tables, rules and reports.
Mobile/PWA | CEO cockpit, approvals, alerts, document upload, statuses and AI chat.
Telegram | Manager input, receipts/documents, owner approvals, AI CFO alerts, compliance reminders.
WhatsApp add-on | Premium alternative channel using the same backend services and permissions.
Канал не владеет бизнес-логикой. Любое действие вызывает те же backend services и создаёт тот же audit trail.
Группа | Сущности
Identity & Access | users, businesses, business_members, plans, subscriptions, subscription_addons, usage_periods, usage_events
Finance | feature_flags, wallets, transactions, debts, payroll_employees, payroll_payments, payroll_payment_items
Documents & Imports | documents, bank_import_batches, bank_import_rows, bank_import_matches, bank_reconciliations
Compliance | tax_profiles, tax_rules, tax_rule_sources, compliance_obligations
Professional & Audit | tax_drafts, professional_profiles, professional_business_assignments, professional_reviews, audit_events, notifications
Job | Назначение
Trial lifecycle | 3-day, 1-day and expiration notifications; downgrade to Free.
Compliance generation | Create calendar obligations from active profile/rules.
Deadline monitor | Due soon / overdue alerts.
Document processing | Async extraction and classification.
Bank import processing | Parsing, hash/dedup and match suggestions.
Daily CFO pulse | Cash, runway, approvals, obligations and compliance risks.
Rule verification monitor | Flags rules that have not been verified within policy.
Этап | Инфраструктура
MVP / Beta | Railway + Supabase + bot service + scheduled jobs.
Growth | Dedicated workers, Redis queue, storage policies and observability.
Enterprise | Dedicated environment, SSO, SLA and audit exports.
Register → Create Business → Create Subscription → 7-Day Full Trial
→ Onboarding → Usage Tracking → Reminder → Paid Plan or Free Downgrade
Upgrade / Add-on Purchase → Tax Profile → Rule Matching
→ Compliance Calendar → Document Checklist → AI Draft
→ Professional Review (optional/required) → Owner Approval
Upload → Parse → Preview → Deduplicate → Match → Review → Confirm → Reconcile
Final Architecture Statement: Helm Finance is one business financial ecosystem. CFO AI controls financial clarity and decisions; AI Accountant adds compliance preparation and professional review; all modules share the same workspace, ledger, access layer and audit trail.
