HELM FINANCE
PRODUCT ROADMAP V4.0
CFO AI + AI ACCOUNTANT ECOSYSTEM ROADMAP
Одна экосистема: CFO AI Core + AI Accountant + Professional Partner Network + Telegram / Mobile / Web.
Контроль версии
Содержание
1. Цель и принципы roadmap
2. Текущее состояние продукта
3. Стратегические продуктовые треки
4. Phase 0 — Foundation
5. Phase 1 — CFO AI Core Beta
6. Phase 1.25 — Stability, Audit & Commercial Readiness
7. Phase 1.5 — Bank Import & Reconciliation
8. Phase 2 — Forecasting & Decision Intelligence
9. Phase 2.5 — AI Accountant Foundation: Indonesia
10. Phase 3 — Professional Review & Partner Portal
11. Phase 3.5 — Mobile/PWA & WhatsApp Premium
12. Phase 4 — Billing, SaaS Launch & Growth
13. Phase 5 — Filing Readiness, Enterprise & Jurisdiction Expansion
14. What we do not build now
15. Roadmap KPIs and release gates
16. Priority order
1. Цель и принципы roadmap
Сначала financial source of truth, затем автоматизация и прогнозы.
Сначала structured data import, затем налоговые расчёты.
Сначала Indonesia rule pack, затем новые юрисдикции.
Telegram и Mobile дополняют Web, но не создают отдельную бизнес-логику.
Human professional review является обязательным слоем для high-stakes compliance.
Commercial access и usage economics развиваются вместе с продуктом, а не после него.
2. Текущее состояние продукта
На июнь 2026 продукт находится на переходе от internal alpha к controlled business beta.
3. Стратегические продуктовые треки
4. Phase 0 — Foundation
Status: substantially complete
Users, Businesses, Business Members, roles and permissions.
Business-scoped data ownership.
Plans, subscriptions, trial, usage and feature access foundation.
Backend-first access checks and audit-ready channels.
5. Phase 1 — CFO AI Core Beta
Status: largely complete; beta hardening remains
Accounts, transactions, receivables, payables, payroll and partial payments.
Telegram onboarding, manager submissions and inline approvals.
Pulse, AI CFO, CFO Score, Decision Engine and payment simulations.
RU/EN/ID localisation and mobile-safe core pages.
6. Phase 1.25 — Stability, Audit & Commercial Readiness
Immediate
Full audit trail for create/edit/approve/pay/import actions.
Production QA suite for financial invariants and role permissions.
Trial expiration jobs, usage accuracy, billing provider integration and upgrade flows.
Role-specific frontend navigation and read-only downgrade behaviour.
Daily Pulse and compliance-ready notification scheduler.
7. Phase 1.5 — Bank Import & Reconciliation
Next major build
Document Center foundation and private file storage.
CSV/XLSX statement import; PDF after stable structured parsing.
Raw rows, preview, duplicate detection and batch rollback.
AI category/counterparty suggestions and review queue.
Matching to existing Telegram requests, debts, payroll and transactions.
Opening/closing balance reconciliation and discrepancy report.
8. Phase 2 — Forecasting & Decision Intelligence
After clean data flow
30/60/90-day cash forecast.
Recurring obligations and expected receipts.
Scenario planning: delayed client, new hire, purchase, owner withdrawal.
Payment priority V2 with business-critical categories.
Weekly/monthly AI CFO review and anomaly detection.
9. Phase 2.5 — AI Accountant Foundation: Indonesia
Premium add-on foundation
Tax & Compliance Profile.
Versioned Tax Rules Registry and Official Sources Layer.
Compliance Calendar and document checklist.
AI Accountant page and sourced explanations.
CFO AI integration: estimated vs confirmed tax obligations.
RU/EN/ID disclaimer and source verification policy.
10. Phase 3 — Professional Review & Partner Portal
Human-in-the-loop compliance
Professional profiles and manual license verification.
Business assignment and scoped access.
Review queue, change requests and document requests.
AI Draft → Professional Review → Owner Approval workflow.
Professional SLA, audit evidence and service billing foundation.
11. Phase 3.5 — Mobile/PWA & WhatsApp Premium
Channel expansion
CEO mobile cockpit: Pulse, approvals, risks and compliance deadlines.
Mobile document upload and professional comments.
Push notifications and PWA installability.
Official WhatsApp Cloud API add-on using common backend services.
No Telegram/WhatsApp-specific ledger logic.
12. Phase 4 — Billing, SaaS Launch & Growth
Commercial scale
Production checkout, invoices, renewals, dunning and downgrade flows.
Base plans + add-ons + professional service charges.
Usage-based AI/document/import limits and cost analytics.
Self-service onboarding, help center and in-product activation metrics.
Partner channel and first repeatable SMB sales playbook.
13. Phase 5 — Filing Readiness, Enterprise & Jurisdiction Expansion
Later
Draft reporting packages, filing checklist and proof storage.
Automated filing only after separate legal and integration approval.
Advanced permissions, SSO, multi-entity, API and dedicated infrastructure.
New country rule packs one jurisdiction at a time.
Regional professional partner networks and local source governance.
14. What we do not build now
15. Roadmap KPIs and release gates
16. Priority order
Beta hardening, audit trail and billing lifecycle.
Bank Statement Import & Reconciliation V1.
30/60/90-day Forecast and Decision Engine V2.
AI Accountant Foundation for Indonesia.
Professional Partner Portal and review workflow.
Mobile/PWA CEO cockpit and official WhatsApp add-on.
SaaS scale, enterprise and additional jurisdictions.

## Tables (flattened)

Версия | 4.0
Статус | Product & Development Source of Truth
Дата | Июнь 2026
Назначение | Поэтапный план развития финансовой операционной системы, автоматизации данных, compliance и professional review.
Версия | Дата | Изменение | Статус
Product Roadmap V3.2 | До июня 2026 | Исходные документы по access, plans, trial и roadmap | Superseded
4.0 | Июнь 2026 | Объединение CFO AI и AI Accountant в единую продуктовую экосистему | Current Source of Truth
Главное изменение V4.0: AI Accountant не является отдельным приложением. Это платный модуль внутри общего Business Workspace, использующий те же данные, роли, биллинг, Telegram identity и audit trail.
Каждая фаза должна приближать владельца бизнеса к двум результатам: понимать деньги за 30 секунд и принимать более безопасные решения без ручного финансового хаоса.
Область | Статус | Комментарий
Business-scoped architecture | Готово | Финансы принадлежат business_id; роли и membership проверяются backend.
Wallets & Transactions | Работает | Нужен дальнейший reconciliation и two-legged transfers.
Payroll | Работает | Components, net payment and linked transaction.
Receivables / Payables | Работает | Partial payments, approvals, Telegram source and wallet selection.
Telegram team flow | Работает | Manager submit → Owner approve/reject → creator notification.
Decision Engine V1 | Работает | Approval vs payment and before/after simulation.
AI CFO / Pulse | Работает | Runway, score, risks and next actions; needs forecast depth.
Plans / Trial foundation | Частично готово | Access checks exist; production billing lifecycle remains.
Bank import | Не начато | Следующий главный data automation milestone.
AI Accountant | Specification | Foundation and Indonesia rule pack not yet implemented.
Трек | Результат
A. CFO AI Core | Reliable financial operations and CEO decision support.
B. Data Automation | Bank imports, documents, matching, reconciliation and less manual input.
C. AI Accountant | Compliance profile, rules, tax drafts and official sources.
D. Professional Network | Licensed review, partner portal and accountability.
E. Channels | Telegram operations, Mobile/PWA cockpit and WhatsApp premium.
F. Commercial Platform | Trial, billing, plans, add-ons, conversion and unit economics.
G. Enterprise & Scale | Advanced permissions, APIs, security, SLA and multi-entity.
Gate: business isolation, access checks, no data loss, build/deploy stable.
Gate: 3–5 real businesses complete a month of use without cash-impact errors.
Gate: controlled paid beta can be sold with support and traceability.
Gate: a client imports a full month without duplicate ledger entries and reconciles the wallet.
Gate: forecast explains assumptions and matches ledger outcomes within defined tolerance.
Gate: every displayed obligation is linked to an active rule and official source.
Gate: licensed partner reviews real client draft and owner sees complete evidence trail.
Gate: owner completes critical daily actions on phone; channel actions reconcile with Web.
Gate: stable MRR, measurable activation, conversion, retention and gross margin.
Gate: enterprise security review and jurisdiction-specific professional sign-off.
Не строим сейчас | Почему
Automatic government filing | High legal/security risk; requires official integration and human approval.
Support for many countries | Would dilute source governance; Indonesia first.
Open accountant marketplace | Start with curated partner programme and controlled quality.
Full ERP / inventory / HR / CRM | Outside core financial clarity and compliance value.
Native mobile before stable PWA | Would duplicate unstable UX and increase support cost.
Grey WhatsApp automation | Only official WhatsApp Business Cloud API.
Уровень | Ключевые метрики
Activation | Business setup, wallet, first transaction, Telegram connected, first approval.
Data quality | Import match rate, duplicate prevention, reconciliation discrepancy.
Decision value | AI CFO question usage, decision view rate, action completion.
Commercial | Trial activation, trial→paid, ARPU, add-on attach rate, gross margin.
Retention | Weekly active owners, monthly reconciled businesses, churn.
Compliance | Obligations with verified sources, on-time completion, professional review SLA.
Reliability | Cash-impact error rate, permission incidents, notification delivery and job success.
Final Roadmap Statement: CFO AI first creates reliable financial truth and decisions. AI Accountant then converts that truth into sourced compliance preparation and professional review. Automation follows data quality, not the other way around.
