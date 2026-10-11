HELM FINANCE
MASTER PRODUCT SPECIFICATION V3.3 — PRICING & ACCESS UPDATE
Версия: 3.3
Статус: Product Source of Truth Update
Назначение: обновление разделов тарифов, бесплатного доступа и trial-логики для Helm Finance / CFO AI

1. ЧТО МЕНЯЕМ В MASTER SPEC
В Master Product Specification нужно добавить полноценную модель доступа:
Free Plan
7-Day Full Trial
Paid Plans
Usage Limits
Feature Access
Trial Expiration Logic
Upgrade Flow

Это важно заложить сразу, потому что тарифы влияют не только на оплату, но и на:
лимиты пользователей;
лимиты бизнесов;
лимиты транзакций;
лимиты AI-запросов;
лимиты голосовых сообщений;
доступ к payroll;
доступ к team access;
доступ к approval flow;
доступ к integrations;
доступ к reports;
billing logic;
onboarding;
conversion funnel.

2. ОБНОВЛЁННАЯ ЛОГИКА ДОСТУПА
Helm Finance должен иметь 3 уровня доступа:
1. Free Plan
2. 7-Day Full Trial
3. Paid Plans


3. FREE PLAN
Free Plan — постоянная бесплатная версия Helm Finance с минимальным функционалом.
Цель Free Plan:
дать пользователю попробовать продукт без риска;
показать базовую ценность AI CFO;
создать привычку вносить расходы;
привести пользователя к upgrade;
использовать бесплатную версию как канал привлечения клиентов.
Free Plan должен быть полезным, но ограниченным.
Он не должен заменять платный тариф.

3.1 Free Plan Limits
Рекомендуемые лимиты Free Plan:
1 Business
1 User
1 Account
до 30 transactions / месяц
до 3 invoices / месяц
до 10 AI Chat вопросов / месяц
до 10 voice inputs / месяц
basic Pulse
basic AI CFO summary
без Payroll
без Team Access
без Approval Flow
без Advanced Radar
без Integrations
без WhatsApp
без Export Reports


3.2 Free Plan Features
Free Plan включает:
создание одного бизнеса;
один пользователь;
один cash/bank account;
ручное создание income/expense;
Telegram input;
ограниченный voice input;
базовый Pulse;
базовые invoices;
basic AI CFO summary;
basic AI Chat;
история операций;
базовые receivables.

3.3 Free Plan Purpose
Free Plan должен дать пользователю ощущение:
"Я могу быстро понимать деньги бизнеса без Excel."

Но пользователь должен быстро увидеть, что для нормального бизнеса ему нужен upgrade:
"Мне нужна команда."
"Мне нужен payroll."
"Мне нужен approval flow."
"Мне нужно больше AI-запросов."
"Мне нужно больше invoices."
"Мне нужен нормальный Radar."
"Мне нужны отчёты."


4. 7-DAY FULL TRIAL
Каждый новый пользователь получает 7 дней полного доступа.
Trial открывает максимум доступного функционала текущей версии продукта.
На старте trial должен давать доступ уровня:
Founder Plan
или
Maximum Available Plan


4.1 Что входит в Trial
7-Day Full Trial включает:
multi-business;
Team Access;
Payroll;
Approval Flow;
advanced invoices;
receivables;
payables;
AI CFO;
AI Chat;
Radar;
Telegram voice input;
receipt upload;
reminders;
tasks;
reports;
export;
все функции текущей версии продукта.

4.2 Trial без карты
На старте MVP trial должен быть:
7 days full trial
without credit card

Причина:
меньше трения при регистрации;
проще привлекать первых пользователей;
выше конверсия в тест;
проще показывать продукт малому бизнесу;
меньше недоверия к новому сервису.
Позже можно тестировать вариант:
Trial with credit card

Но не на старте.

4.3 Что происходит после окончания Trial
После 7 дней:
Если пользователь оплатил тариф:
trial → paid plan

Если пользователь не оплатил:
trial → Free Plan

Данные пользователя не удаляются.
Но платные функции становятся недоступны или переходят в read-only.
Примеры:
Payroll остаётся в системе, но становится read-only.
Team Access блокируется.
Дополнительные пользователи теряют доступ.
Advanced AI CFO скрывается.
Advanced Radar скрывается.
Invoices сверх лимита становятся read-only.
Экспорт отчётов блокируется.
AI Chat возвращается к Free limits.

5. ПЛАТНЫЕ ТАРИФЫ
Тарифы являются рабочей гипотезой и могут быть изменены после тестирования первых клиентов.

5.1 Free
$0 / месяц

Для одного владельца бизнеса, который хочет попробовать базовый финансовый контроль.
Включает:
1 Business;
1 User;
1 Account;
до 30 transactions / месяц;
до 3 invoices / месяц;
basic Pulse;
basic AI CFO;
limited AI Chat;
limited voice input.

5.2 Starter
до 3 пользователей
$19 / месяц

Для solo-founder или маленькой команды.
Включает:
1–2 Business;
до 3 пользователей;
Telegram input;
voice input;
transactions;
accounts;
invoices;
basic receivables;
basic payables;
basic AI CFO;
limited AI Chat;
basic Pulse.

5.3 Business
до 20 пользователей
$49 / месяц

Для малого бизнеса с командой.
Включает:
Team Access;
Payroll;
Approval Flow;
Receivables;
Payables;
Tasks;
Reminders;
Telegram voice input;
AI CFO v1;
Radar basic;
basic reports.

5.4 Founder
до 100 пользователей
$99 / месяц

Для растущих компаний.
Включает:
multi-business;
advanced AI CFO;
advanced Radar;
advanced reports;
export;
integrations;
extended AI limits;
extended voice input;
priority support.

5.5 Enterprise
Custom pricing

Для крупных клиентов.
Включает:
unlimited users;
custom onboarding;
custom integrations;
dedicated infrastructure;
advanced permissions;
custom reports;
SLA;
enterprise support.

6. PLAN LIMITS TABLE
Система должна иметь техническую таблицу лимитов по тарифам.
Plan: Free
Businesses: 1
Users: 1
Accounts: 1
Transactions: 30 / month
Invoices: 3 / month
AI Chat: 10 / month
Voice Input: 10 / month
Payroll: no
Team Access: no
Approval Flow: no
Reports: no
Integrations: no

Plan: Starter
Businesses: 1–2
Users: up to 3
Accounts: limited
Transactions: limited / higher than Free
Invoices: limited / higher than Free
AI Chat: limited
Voice Input: limited
Payroll: no or limited
Team Access: basic
Approval Flow: no or basic
Reports: basic
Integrations: no

Plan: Business
Businesses: several
Users: up to 20
Accounts: extended
Transactions: extended
Invoices: extended
AI Chat: extended
Voice Input: extended
Payroll: yes
Team Access: yes
Approval Flow: yes
Reports: basic
Integrations: limited

Plan: Founder
Businesses: multiple
Users: up to 100
Accounts: extended
Transactions: high limit
Invoices: high limit
AI Chat: high limit
Voice Input: high limit
Payroll: yes
Team Access: yes
Approval Flow: yes
Reports: advanced
Integrations: yes

Plan: Enterprise
Custom limits
Custom access
Custom infrastructure
Custom integrations


7. SUBSCRIPTION STATUSES
В системе должны быть статусы подписки:
free
trial_active
trial_expired
active_paid
past_due
cancelled
suspended
enterprise


8. REQUIRED BILLING FIELDS
В Business или Subscription модели должны быть поля:
id
business_id
plan
trial_status
trial_started_at
trial_ends_at
subscription_status
subscription_started_at
subscription_ends_at
billing_provider
usage_limits
created_at
updated_at


9. FEATURE ACCESS RULE
Каждая функция должна проверять:
business_id
user_id
role
permissions
plan
trial_status
subscription_status
usage_limits

Пример:
Employee хочет создать expense через voice input.
Система проверяет:
Пользователь состоит в business?
У него есть роль Employee / Manager / Owner?
Разрешён ли voice input на текущем plan?
Не превышен ли monthly voice limit?
Нужен ли approval?


10. TRIAL ACTIVATION FLOW
Когда новый пользователь создаёт аккаунт:
1. User регистрируется
2. Создаёт первый Business
3. Система автоматически включает 7-Day Full Trial
4. Пользователь получает доступ ко всем функциям текущей версии
5. Система показывает дату окончания trial
6. За 2 дня до окончания trial отправляет reminder
7. После trial переводит Business на Free Plan, если оплаты нет


11. UPGRADE FLOW
Upgrade должен быть простым.
Пользователь видит ограничения:
Вы достигли лимита Free Plan.
Upgrade to Business Plan to continue.

Примеры upgrade triggers:
пользователь хочет добавить второго сотрудника;
пользователь хочет создать больше 30 transactions;
пользователь хочет использовать payroll;
пользователь хочет включить approval flow;
пользователь хочет больше AI Chat;
пользователь хочет экспортировать отчёт;
пользователь хочет больше invoices;
пользователь хочет advanced Radar.

12. КАК ЭТО ОБНОВЛЯЕТ PHASE 1
В Phase 1 обязательно включить:
Free Plan
7-Day Full Trial
Plan Limits
Feature Access
Usage Limits
Subscription Status
Upgrade Prompts
Trial Expiration Logic

Без этого MVP будет технически неполным.
Phase 1 теперь должна включать не только продуктовые модули, но и коммерческую основу.

13. ОБНОВЛЁННЫЙ PHASE 1 CORE PRODUCT
Phase 1 включает:
Business Setup
Free Plan
7-Day Full Trial
Starter / Business / Founder plan logic
Subscription Status
Usage Limits
Feature Access
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


14. ОБНОВЛЁННАЯ PRODUCT POSITIONING
Helm Finance позиционируется как:
AI CFO for business owners

С бесплатным входом:
Start for free.
Get full access for 7 days.
Upgrade when your business needs more control.

На русском:
Начните бесплатно.
Получите полный доступ на 7 дней.
Переходите на платный тариф, когда бизнесу нужен полный контроль финансов.


15. FINAL UPDATE STATEMENT
Free Plan и 7-Day Full Trial являются обязательной частью продукта.
Они нужны не только для маркетинга, но и для архитектуры:
plans
permissions
limits
billing
AI usage
voice usage
user access
feature access
upgrade flow

Главное правило:
Helm Finance должен давать ценность бесплатно, показывать максимум в trial и конвертировать в платный тариф через реальные ограничения, а не через давление.
