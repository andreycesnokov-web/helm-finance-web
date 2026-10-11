HELM FINANCE
SYSTEM ARCHITECTURE V3.3 — ACCESS, PLANS & TRIAL UPDATE
Версия: 3.3
Статус: Technical Source of Truth Update
Назначение: обновление архитектуры Helm Finance с учётом Free Plan, 7-Day Trial, paid plans, usage limits и feature access

1. ЧТО МЕНЯЕМ В SYSTEM ARCHITECTURE V3.2
В архитектуру Helm Finance нужно добавить отдельный слой:
Plans
Subscriptions
Trial
Usage Limits
Feature Access
Billing Status
Upgrade Flow

Это не маркетинговая часть.
Это часть технической архитектуры.
Причина:
Free Plan ограничивает функции;
Trial открывает максимум функций на 7 дней;
Paid Plans дают разные лимиты;
AI Chat и voice input стоят денег;
Telegram voice должен иметь usage limit;
payroll, approval flow и team access должны зависеть от тарифа;
после окончания trial система должна автоматически перевести business на Free Plan.

2. ОБНОВЛЁННАЯ ОБЩАЯ ИЕРАРХИЯ
Обновлённая архитектура:
Platform
│
├── Users
│
├── Plans
│
└── Businesses
    │
    ├── Subscription
    ├── Usage Limits
    ├── Business Members
    ├── Projects
    ├── Accounts
    ├── Transactions
    ├── Invoices
    ├── Receivables
    ├── Payables
    ├── Payroll
    ├── Tasks
    ├── Reminders
    ├── Approval Requests
    ├── Files / Receipts
    ├── AI Chat
    └── AI CFO Engine

Главное правило:
Business остаётся корневым объектом финансовой системы, но доступ к функциям Business зависит от Subscription, Plan и Usage Limits.

3. PLANS
Plans — это справочник тарифов Helm Finance.
Планы:
free
starter
business
founder
enterprise

Поля Plan:
id
name
code
price_monthly
price_yearly
currency
max_businesses
max_users
max_accounts
max_transactions_per_month
max_invoices_per_month
max_ai_chat_requests_per_month
max_voice_inputs_per_month
has_payroll
has_team_access
has_approval_flow
has_advanced_radar
has_reports
has_integrations
has_export
has_whatsapp
is_active
created_at
updated_at

Пример:
Plan: Free
max_businesses: 1
max_users: 1
max_accounts: 1
max_transactions_per_month: 30
max_invoices_per_month: 3
max_ai_chat_requests_per_month: 10
max_voice_inputs_per_month: 10
has_payroll: false
has_team_access: false
has_approval_flow: false
has_advanced_radar: false
has_reports: false
has_integrations: false
has_export: false
has_whatsapp: false


4. SUBSCRIPTIONS
Subscription — подписка конкретного Business.
Важно:
Подписка должна быть привязана к Business, а не только к User.
Причина:
один User может владеть несколькими Business;
у разных Business могут быть разные тарифы;
один Business может быть на Free, другой на Founder;
Enterprise может иметь отдельные условия.
Поля Subscription:
id
business_id
plan_id
plan_code
status
trial_status
trial_started_at
trial_ends_at
subscription_started_at
subscription_ends_at
billing_provider
billing_customer_id
billing_subscription_id
cancel_at_period_end
created_at
updated_at

Статусы subscription:
free
trial_active
trial_expired
active_paid
past_due
cancelled
suspended
enterprise

Trial statuses:
not_started
active
expired
converted
cancelled


5. FREE PLAN
Free Plan — постоянный бесплатный тариф.
Free Plan должен быть доступен каждому business после регистрации или после окончания trial без оплаты.
Free Plan limits:
1 Business
1 User
1 Account
30 transactions / month
3 invoices / month
10 AI Chat requests / month
10 voice inputs / month
basic Pulse
basic AI CFO summary
no Payroll
no Team Access
no Approval Flow
no Advanced Radar
no Integrations
no WhatsApp
no Export Reports

Архитектурное правило:
Free Plan не удаляет данные, но ограничивает доступ к функциям.
Пример:
Если после trial пользователь создал payroll, но не оплатил тариф:
Payroll data remains in database.
Payroll module becomes read-only or locked.
User sees upgrade prompt.


6. 7-DAY FULL TRIAL
Каждый новый Business получает 7 дней полного доступа.
Trial должен активироваться автоматически после создания первого Business.
Trial открывает доступ уровня:
Founder Plan
или
Maximum Available Plan

Поля, которые обязательно нужны:
trial_started_at
trial_ends_at
trial_status

Логика:
User creates Business
↓
System creates Subscription
↓
plan_code = founder_trial / maximum_trial
↓
trial_status = active
↓
trial_ends_at = now + 7 days
↓
All current features unlocked

После окончания trial:
If paid:
trial_active → active_paid

If not paid:
trial_active → trial_expired → free


7. USAGE LIMITS
Usage Limits — лимиты использования по каждому Business.
Они нужны, чтобы контролировать:
AI Chat;
voice input;
transactions;
invoices;
users;
accounts;
reports;
exports.
Поля Usage Limits:
id
business_id
plan_id
period_start
period_end
transactions_used
invoices_used
ai_chat_requests_used
voice_inputs_used
users_used
accounts_used
exports_used
created_at
updated_at

Пример:
Business: Helm Care
Plan: Free
transactions_used: 28 / 30
invoices_used: 2 / 3
ai_chat_requests_used: 8 / 10
voice_inputs_used: 7 / 10

Если лимит превышен:
action blocked
upgrade prompt shown
audit/log event created


8. USAGE EVENTS
Каждое платное или лимитированное действие должно фиксироваться как usage event.
Поля Usage Event:
id
business_id
user_id
event_type
source
units
metadata
created_at

Event types:
transaction_created
invoice_created
ai_chat_request
voice_input_used
report_exported
user_invited
account_created

Зачем это нужно:
считать лимиты;
понимать активность;
контролировать расходы на AI;
строить billing analytics;
видеть, почему пользователь должен upgrade.

9. FEATURE ACCESS CHECK
Каждая функция должна проходить проверку доступа.
Проверять нужно не только role, но и plan.
Функция доступна, если выполнены условия:
User belongs to Business
User role allows action
Business subscription allows feature
Usage limit is not exceeded
Trial or paid status is valid
Action passes security validation

Пример проверки для voice input:
1. User exists
2. User is Business Member
3. Role allows creating expense
4. Plan allows voice input
5. Monthly voice input limit not exceeded
6. AI Processing Layer creates draft
7. User confirms
8. Backend creates transaction


10. FEATURE ACCESS MATRIX
Минимальная матрица доступа:
Feature: Transactions
Free: limited
Starter: yes
Business: yes
Founder: yes
Enterprise: yes

Feature: Invoices
Free: limited
Starter: yes
Business: yes
Founder: yes
Enterprise: yes

Feature: AI Chat
Free: limited
Starter: limited
Business: extended
Founder: advanced
Enterprise: custom

Feature: Voice Input
Free: limited
Starter: limited
Business: extended
Founder: advanced
Enterprise: custom

Feature: Payroll
Free: no
Starter: no / limited
Business: yes
Founder: yes
Enterprise: yes

Feature: Team Access
Free: no
Starter: basic
Business: yes
Founder: yes
Enterprise: yes

Feature: Approval Flow
Free: no
Starter: no / basic
Business: yes
Founder: yes
Enterprise: yes

Feature: Reports
Free: no
Starter: basic
Business: basic
Founder: advanced
Enterprise: custom

Feature: Integrations
Free: no
Starter: no
Business: limited
Founder: yes
Enterprise: custom

Feature: WhatsApp
Free: no
Starter: no
Business: no / add-on
Founder: future
Enterprise: custom


11. BACKEND ACCESS FLOW
Все действия должны проходить через backend.
Общая схема:
User Action
↓
Authentication
↓
Business Membership Check
↓
Role & Permission Check
↓
Subscription Check
↓
Feature Access Check
↓
Usage Limit Check
↓
Business Logic
↓
Database Write
↓
Audit Trail

Важно:
Frontend, Telegram Bot, Mobile App и AI Chat не должны сами решать, доступна функция или нет.
Окончательное решение принимает backend.

12. TRIAL EXPIRATION FLOW
Система должна регулярно проверять активные trial.
Логика:
Daily Job
↓
Find trial_active subscriptions
↓
Check trial_ends_at
↓
If trial expired and no paid plan
↓
Set status = free
↓
Lock paid features
↓
Keep data
↓
Send notification

Уведомления:
Trial ends in 3 days
Trial ends tomorrow
Trial ended
Upgrade to continue using full features

Каналы уведомлений:
Telegram
Email
Mobile Push
Desktop


13. UPGRADE PROMPTS
Когда пользователь достигает лимита, система должна показывать upgrade prompt.
Примеры:
You reached 30 transactions this month.
Upgrade to Starter to continue adding transactions.

Payroll is available on Business Plan.
Upgrade to unlock Payroll.

Your 7-day trial has ended.
Your account is now on Free Plan.
Upgrade to restore full access.

На русском:
Вы достигли лимита 30 транзакций в этом месяце.
Перейдите на Starter, чтобы продолжить.

Payroll доступен на тарифе Business.
Обновите тариф, чтобы открыть зарплаты.

Ваш 7-дневный trial закончился.
Business переведён на Free Plan.
Обновите тариф, чтобы вернуть полный доступ.


14. DATABASE ADDITIONS
В базу данных нужно добавить таблицы:
plans
subscriptions
usage_limits
usage_events
billing_events
feature_flags


14.1 plans
id
code
name
price_monthly
price_yearly
currency
limits_json
features_json
is_active
created_at
updated_at


14.2 subscriptions
id
business_id
plan_id
plan_code
status
trial_status
trial_started_at
trial_ends_at
subscription_started_at
subscription_ends_at
billing_provider
billing_customer_id
billing_subscription_id
cancel_at_period_end
created_at
updated_at


14.3 usage_limits
id
business_id
period_start
period_end
transactions_used
invoices_used
ai_chat_requests_used
voice_inputs_used
users_used
accounts_used
exports_used
created_at
updated_at


14.4 usage_events
id
business_id
user_id
event_type
source
units
metadata
created_at


14.5 billing_events
id
business_id
subscription_id
event_type
provider
provider_event_id
amount
currency
status
metadata
created_at


14.6 feature_flags
id
business_id
feature_code
is_enabled
source
created_at
updated_at

Feature flags нужны для:
тестирования новых функций;
включения функций конкретным клиентам;
Enterprise exceptions;
beta access;
временных overrides.

15. AI USAGE CONTROL
AI Chat и Voice Input должны иметь отдельный контроль usage.
Причина:
каждый AI-запрос стоит денег;
voice input требует speech-to-text;
длинные запросы могут быть дорогими;
бесплатные пользователи не должны сжигать бюджет продукта.
AI usage events:
ai_chat_request
ai_cfo_analysis
voice_transcription
voice_intent_parsing
report_generation

Для каждого AI event желательно хранить:
model
input_tokens
output_tokens
cost_estimate
source
business_id
user_id
created_at


16. ОБНОВЛЕНИЕ SECURITY PRINCIPLES
В раздел Security Principles добавить:
13. Все функции проверяют subscription status.
14. Все функции проверяют plan limits.
15. AI usage должен иметь лимиты.
16. Voice input должен иметь лимиты.
17. После окончания trial платные функции блокируются, но данные не удаляются.
18. Backend является единственным местом проверки feature access.
19. Enterprise exceptions должны фиксироваться через feature_flags.
20. Все billing и subscription events должны сохраняться.


17. ОБНОВЛЕНИЕ PHASE 0
Phase 0 должен включать:
Users
Business
Business Members
Roles
Permissions
Plans
Subscriptions
7-Day Trial
Free Plan
Usage Limits
Feature Access
Basic Billing Logic
Backend Foundation
Database Foundation

Phase 0 считается завершённым, если система умеет:
создать User;
создать Business;
автоматически включить 7-Day Trial;
определить plan;
ограничить функции по plan;
считать usage;
после trial перевести Business на Free Plan;
показывать upgrade prompt.

18. ОБНОВЛЕНИЕ PHASE 1
Phase 1 теперь обязательно включает:
Free Plan
7-Day Full Trial
Starter / Business / Founder plan logic
Subscription Status
Usage Limits
Feature Access
Upgrade Prompts
Trial Expiration Logic
Team Access
Roles & Permissions
Accounts
Transactions
Invoices
Receivables
Payables
Payroll
Approval Flow
Tasks
Reminders
Telegram Interface
Voice Transaction Input
AI CFO v1
AI Chat Basic
Pulse

Без Free/Trial/Plan Logic Phase 1 нельзя считать полноценной.

19. ОБНОВЛЁННЫЙ FINAL ARCHITECTURE STATEMENT
Helm Finance — это financial operating system for business owners.
Core:
Business
Users
Business Members
Projects
Accounts
Transactions
Invoices
Receivables
Payables
Payroll
Approval Flow
AI CFO Engine
AI Processing Layer

Access & Commercial Core:
Plans
Subscriptions
Free Plan
7-Day Trial
Usage Limits
Feature Access
Billing Events
Upgrade Flow

Interfaces:
Telegram
Mobile App
Desktop App
AI Chat
WhatsApp Future

Infrastructure:
Railway / Supabase for MVP
Hetzner / PostgreSQL / Redis / Workers for scale

Главное:
Business остаётся главным финансовым объектом.
Subscription определяет, какие функции доступны этому Business.
Backend проверяет role, permissions, plan, trial status и usage limits перед каждым действием.
AI, Telegram, Mobile App и Desktop App не могут обходить эти правила.
