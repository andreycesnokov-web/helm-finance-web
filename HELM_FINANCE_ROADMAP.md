HELM FINANCE
PRODUCT ROADMAP V3.2
Версия: 3.2
Статус: Product & Development Roadmap
Назначение: план разработки Helm Finance / CFO AI по этапам

1. ГЛАВНАЯ ЦЕЛЬ ROADMAP
Roadmap нужен, чтобы команда понимала:
что строим сначала;
что не строим сейчас;
какие функции нужны первым клиентам;
какие функции нужны для продаж;
какие функции нужны для удержания пользователей;
какие функции относятся к будущим версиям.
Helm Finance не должен строиться как хаотичный набор функций.
Каждая фаза должна отвечать на вопрос:
приближает ли эта функция владельца бизнеса к быстрому пониманию денег, runway, долгов и следующих действий?

2. ГЛАВНЫЙ ПРОДУКТОВЫЙ ПРИНЦИП
Helm Finance должен помочь владельцу бизнеса за 30 секунд понять:
Сколько денег есть?
Кто должен нам?
Кому должны мы?
Когда закончится cash?
Хватит ли денег на зарплаты?
Какие платежи срочные?
Что нужно сделать сегодня?

Если функция не помогает ответить на эти вопросы — она не приоритет.

3. МОДЕЛЬ ДОСТУПА: FREE + 7-DAY TRIAL + PAID PLANS
Helm Finance должен иметь встроенную модель доступа с самого начала.
Это не просто billing-функция.
Это часть архитектуры продукта.
Система должна понимать:
plan
trial_status
trial_started_at
trial_ends_at
subscription_status
usage_limits
feature_access


4. FREE PLAN
Free Plan — бесплатная версия с минимальным функционалом.
Цель Free Plan:
дать пользователю попробовать продукт без риска;
показать ценность AI CFO;
создать привычку вносить расходы;
привести пользователя к upgrade;
использовать Free как лидогенерацию.
Free Plan не должен быть слишком сильным, иначе пользователь не будет платить.
Free Plan должен быть полезным, но ограниченным.

4.1 Free Plan Limits
Рекомендуемые ограничения:
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


4.2 Free Plan Features
Free Plan включает:
создание одного бизнеса;
один cash/bank account;
ручное создание income/expense;
Telegram input;
ограниченный voice input;
базовый Pulse;
базовые invoices;
basic AI CFO;
basic AI Chat;
просмотр истории операций.

4.3 Free Plan Purpose
Free Plan должен показать пользователю:
"Я могу быстро понимать деньги бизнеса без Excel."

Но пользователь должен почувствовать ограничения:
"Мне нужна команда."
"Мне нужен payroll."
"Мне нужен approval."
"Мне нужно больше AI-запросов."
"Мне нужно больше invoices."
"Мне нужен нормальный Radar."


5. 7-DAY FULL TRIAL
Каждый новый пользователь получает 7 дней полного доступа.
Trial должен открывать максимальный функционал текущей версии продукта.
На старте trial можно давать доступ уровня:
Founder Plan
или
Maximum Available Plan


5.1 Что входит в 7-Day Trial
Trial включает:
multi-business;
Team Access;
Payroll;
Approval Flow;
advanced invoices;
receivables;
payables;
AI CFO v1/v2;
AI Chat;
Radar;
Telegram voice input;
receipt upload;
reminders;
tasks;
reports;
export;
все доступные функции текущей версии.

5.2 Что происходит после Trial
После окончания 7 дней:
Если пользователь оплатил:
trial → paid plan

Если пользователь не оплатил:
trial → Free Plan

Данные пользователя не удаляются.
Но доступ к платным функциям блокируется.
Пример:
payroll остаётся в базе, но недоступен для редактирования;
team access замораживается;
advanced AI CFO скрывается;
invoices сверх лимита становятся read-only;
дополнительные users теряют доступ до upgrade.

5.3 Нужно ли просить карту на Trial
Для раннего MVP:
Trial без карты

Причина:
меньше трения;
проще тестировать первых клиентов;
больше регистраций;
лучше для рынка, где доверие к новому продукту ещё не сформировано.
Позже можно тестировать:
Trial with card

Но не на старте.

6. ПЛАТНЫЕ ТАРИФЫ
Тарифы являются гипотезой и могут быть изменены после первых клиентов.

6.1 Free
$0 / месяц

Для одного владельца, который хочет попробовать базовый контроль денег.

6.2 Starter
до 3 пользователей
$19 / месяц

Для малого бизнеса или solo-founder.
Включает:
1–2 Business;
Telegram input;
voice input;
transactions;
accounts;
invoices;
basic receivables;
basic AI CFO;
limited AI Chat;
basic Pulse.

6.3 Business
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
Radar basic.

6.4 Founder
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
priority support.

6.5 Enterprise
Custom pricing

Для крупных клиентов.
Включает:
unlimited users;
custom onboarding;
custom integrations;
dedicated infrastructure;
advanced permissions;
SLA;
custom AI workflows.

7. PHASE 0 — PRODUCT FOUNDATION
Цель Phase 0
Создать базовый фундамент продукта, без которого нельзя строить систему дальше.
Phase 0 — это не красивая версия для клиента.
Это технический и продуктовый фундамент.

7.1 Core Foundation
Нужно реализовать:
User model
Business model
Business Members
Roles
Permissions
Plans
Trial Status
Subscription Status
Usage Limits
Feature Flags
Basic Database Structure
Backend API Foundation


7.2 Почему Plans нужно делать сразу
Plans нельзя откладывать.
Причина:
Free Plan имеет ограничения;
Trial открывает максимум функций;
Paid plans дают разные лимиты;
permissions зависят от тарифа;
AI usage нужно ограничивать;
voice input стоит денег;
invoices и users нужно лимитировать.
Если не заложить это сразу, потом придётся переделывать продуктовую логику.

7.3 Результат Phase 0
В конце Phase 0 система должна уметь:
создать пользователя;
создать бизнес;
назначить owner;
определить plan;
включить 7-day trial;
после trial перевести пользователя на Free;
ограничивать функции по plan;
проверять permissions;
хранить базовые данные.

8. PHASE 1 — CORE MVP ДЛЯ ПЕРВЫХ КЛИЕНТОВ
Цель Phase 1
Показать первым клиентам главную ценность Helm Finance:
владелец бизнеса быстро понимает cash, долги, runway и финансовые риски.

8.1 Phase 1 Core Features
Phase 1 включает:
Business Setup
Free Plan
7-Day Full Trial
Starter / Business / Founder plan logic
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


8.2 Business Setup
Пользователь должен уметь:
создать бизнес;
указать название;
выбрать валюту;
выбрать timezone;
выбрать country;
добавить account;
добавить opening balance;
пригласить сотрудников.

8.3 Accounts
Нужно реализовать:
cash account;
bank account;
personal account;
payment gateway account;
opening balance;
current balance;
transaction history.
Главное правило:
Balance меняется только через confirmed transactions.


8.4 Transactions
Нужно реализовать:
income;
expense;
transfer;
payroll transaction;
invoice payment;
owner injection;
owner withdrawal;
correction.
Источники:
manual
telegram
voice
invoice
payroll

Статусы:
draft
pending_approval
confirmed
rejected
cancelled


8.5 Telegram Input
Telegram в Phase 1 — главный канал ввода.
Пользователь может:
написать расход текстом;
отправить расход голосом;
загрузить чек;
создать income;
создать invoice draft;
спросить AI CFO;
получить reminder;
подтвердить approval.

8.6 Voice Transaction Input
Пример:
"Запиши расход 300 тысяч за бензин, проект Helm Care, BCA."

Система должна:
принять голосовое;
преобразовать в текст;
распознать сумму, валюту, категорию, проект, account;
создать draft;
спросить подтверждение;
после подтверждения создать confirmed transaction;
записать audit trail.

8.7 Invoices
Нужно реализовать:
создать invoice;
тип Receivable;
тип Payable;
статус draft;
статус sent;
статус paid;
статус overdue;
due date;
counterparty;
partial payment;
linked transaction.

8.8 Receivables
Нужно реализовать:
кто должен нам;
сколько должен;
когда должен оплатить;
сколько дней просрочки;
сумма overdue;
reminder;
влияние на runway.

8.9 Payables
Нужно реализовать:
кому мы должны;
сколько должны;
когда платить;
приоритет платежа;
влияние на runway.

8.10 Payroll
Нужно реализовать:
employee;
salary;
bonus;
commission;
pay day;
upcoming payroll;
payroll obligation;
payroll transaction;
payroll impact on runway.

8.11 Approval Flow
Нужно реализовать:
employee expense request;
manager/admin/owner approval;
approve;
reject;
comment;
audit trail.
Главное правило:
Сотрудник не может подтверждать собственный расход.


8.12 Pulse
Pulse — главный экран.
Показывает:
Available Cash
Runway
Receivables
Payables
Payroll Pressure
Overdue Invoices
Upcoming Payments
Cash Risk
AI CFO Recommendation
Next Best Action


8.13 AI CFO v1
AI CFO v1 должен отвечать:
Сколько денег есть?
Кто должен нам?
Кому должны мы?
Когда закончится cash?
Хватит ли денег на payroll?
Какие invoices overdue?
Какие риски сейчас?
Что сделать сегодня?


8.14 Phase 1 Success Criteria
Phase 1 считается успешной, если первый клиент может:
создать бизнес;
добавить account;
завести transactions;
завести invoices;
видеть receivables/payables;
добавить payroll;
создать expense через Telegram voice;
подтвердить expense;
увидеть runway;
получить AI CFO рекомендацию;
понять финансовое состояние за 30 секунд.

9. PHASE 1.5 — DATA, FILES & REPORTS
Цель Phase 1.5
Сделать продукт удобнее для реального использования и перехода из Excel / Google Sheets.

9.1 Features
Google Sheets Import
CSV Import
Google Drive
File Storage
Receipt Storage
Invoice PDF Upload
Export Reports
Basic Financial Reports
Mobile Push Notifications


9.2 Google Sheets Import
Пользователь должен уметь импортировать:
transactions;
invoices;
accounts;
payroll data;
receivables.

9.3 File Storage
Система должна хранить:
receipts;
invoice PDFs;
payroll documents;
contracts;
bank statements.

9.4 Reports
Нужно добавить:
cash report;
expense report;
receivables report;
payables report;
payroll report;
runway report.

10. PHASE 2 — FINANCIAL INTEGRATIONS
Цель Phase 2
Уменьшить ручной ввод и приблизить Helm Finance к полноценной финансовой системе.

10.1 Features
Wise Integration
Payment Gateway Integrations
Bank Statement Parsing
QuickBooks Integration
Xero Integration
Bank Sync
Auto Reconciliation
Recurring Expenses
Recurring Invoices


10.2 Bank Statement Parsing
Пользователь должен уметь загрузить bank statement.
Система должна:
распознать операции;
предложить категории;
найти совпадения с invoices;
предложить reconciliation;
создать draft transactions.

10.3 Auto Reconciliation
Система должна уметь:
находить оплату invoice;
предлагать match;
отмечать invoice partially paid / paid;
создавать transaction после confirmation.

11. PHASE 3 — WHATSAPP & ADVANCED AUTOMATION
Цель Phase 3
Добавить WhatsApp как массовый канал и усилить автоматизацию.

11.1 Features
WhatsApp Business Cloud API
WhatsApp Voice Input
Employee Expense via WhatsApp
Approval Notifications via WhatsApp
Supplier Reminders
Client Payment Reminders
Advanced Voice Input
Multi-Business Automation


11.2 WhatsApp Principle
Сотрудник может использовать обычный WhatsApp.
Но Helm Finance должен принимать сообщения через официальный WhatsApp Business номер и Cloud API.
Не использовать серые WhatsApp Web библиотеки в production.

12. PHASE 4 — ADVANCED AI CFO
Цель Phase 4
Сделать AI CFO не просто аналитиком, а полноценным финансовым советником для владельца бизнеса.

12.1 Features
Advanced Forecasting
Scenario Planning
Hiring Decision Analysis
Budget Recommendations
Cash Gap Prevention
Expense Anomaly Detection
Revenue Trend Analysis
Profitability by Project
AI Monthly Financial Review
AI Weekly Board Report


12.2 Scenario Planning
Примеры вопросов:
Можно ли нанять сотрудника за $700 в месяц?
Что будет, если клиент не оплатит invoice?
Можно ли купить оборудование сейчас?
На сколько месяцев хватит cash?
Какой проект сжигает больше всего денег?


13. PHASE 5 — ENTERPRISE & SCALE
Цель Phase 5
Подготовить продукт к большим клиентам и масштабированию.

13.1 Features
Advanced Permissions
Custom Roles
Multi-Entity Structure
Department Budgets
Advanced Audit Trail
SLA
Dedicated Infrastructure
Custom Integrations
API for Enterprise Clients
Advanced Security
Data Export
Admin Console


14. WHAT WE DO NOT BUILD NOW
Чтобы не превратить MVP в болото, эти функции не строим на старте:
Full tax accounting
Full ERP
Complex inventory
Banking license features
Crypto trading
Full HR system
Complex CRM
Marketplace
Advanced procurement
Custom enterprise workflows

Они могут появиться позже, но не должны мешать запуску Phase 1.

15. PRODUCT PRIORITY RULE
Приоритет функции определяется по 4 вопросам:
1. Помогает ли это owner быстрее понимать деньги?
2. Помогает ли это принять финансовое решение?
3. Уменьшает ли это ручной ввод?
4. Помогает ли это продать продукт первым клиентам?

Если ответ "нет" — функция откладывается.

16. ROADMAP SUMMARY
Phase 0 — Foundation
Users
Business
Roles
Permissions
Plans
Trial
Limits
Backend foundation
Database foundation


Phase 1 — Core MVP
Telegram
Transactions
Accounts
Invoices
Receivables
Payables
Payroll
Approval Flow
Pulse
AI CFO v1
AI Chat Basic
Free Plan
7-Day Trial


Phase 1.5 — Data & Reports
Google Sheets
CSV Import
Google Drive
File Storage
Reports
Export
Mobile Push


Phase 2 — Integrations
Wise
Bank Sync
Payment Gateways
QuickBooks
Xero
Bank Statement Parsing
Auto Reconciliation


Phase 3 — WhatsApp
WhatsApp Cloud API
WhatsApp Voice Input
Employee Expenses
Client Reminders
Supplier Reminders


Phase 4 — Advanced AI CFO
Forecasting
Scenario Planning
Hiring Decisions
Budget Advice
Cash Gap Prevention
Anomaly Detection
Weekly / Monthly AI Reports


Phase 5 — Enterprise
Advanced Permissions
Custom Roles
Multi-Entity
Dedicated Infrastructure
Enterprise API
SLA
Advanced Security


17. FINAL ROADMAP STATEMENT
Helm Finance должен развиваться не как обычный expense tracker, а как AI CFO operating system.
Сначала нужно доказать базовую ценность:
Owner понимает финансы за 30 секунд.

Потом усилить продукт:
меньше ручного ввода;
больше автоматизации;
лучше прогнозы;
глубже AI-рекомендации;
больше каналов ввода;
сильнее интеграции.

Главный порядок развития:
1. Финансовое ядро
2. Telegram input
3. AI CFO
4. Free + Trial + Paid Plans
5. Reports & Imports
6. Integrations
7. WhatsApp
8. Advanced AI
9. Enterprise

Главное правило:
не строить лишнее до тех пор, пока Phase 1 не докажет, что владелец бизнеса реально получает ясность, контроль и следующие действия.
