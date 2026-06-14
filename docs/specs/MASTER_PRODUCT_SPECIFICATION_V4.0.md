HELM FINANCE
MASTER PRODUCT SPECIFICATION V4.0
PRODUCT, PRICING, ACCESS & AI ACCOUNTANT ADD-ONS
Одна экосистема: CFO AI Core + AI Accountant + Professional Partner Network + Telegram / Mobile / Web.
Контроль версии
Содержание
1. Product definition and positioning
2. Target customers and jobs-to-be-done
3. Ecosystem composition
4. Core product workflows
5. CFO AI Core functionality
6. AI Accountant functionality
7. Channel strategy
8. Roles and access
9. Plans, trial and subscription lifecycle
10. Pricing hypothesis
11. Plan limits and feature matrix
12. AI Accountant and channel add-ons
13. Usage, billing and upgrade logic
14. Downgrade and data preservation
15. Professional review and liability boundaries
16. Product analytics and KPIs
17. Non-goals
18. Acceptance criteria
1. Product definition and positioning
Основное обещание владельцу: за 30 секунд понять cash, runway, долги, ближайшие обязательства и следующее действие. Второе обещание add-on: понимать compliance deadlines, документы и draft-расчёты без ручного хаоса.
2. Target customers and jobs-to-be-done
3. Ecosystem composition
CFO AI Core — business setup, wallets, transactions, payroll, receivables/payables, approvals, Pulse and Decision Engine.
AI Accountant — tax profile, rules, official sources, compliance calendar, documents, imports and tax drafts.
Professional Partner Portal — verified professionals, business assignments, reviews, SLA and evidence.
Commercial Core — Free, 7-Day Trial, paid plans, add-ons, usage limits and billing.
Channels — Web/Desktop, Mobile/PWA, Telegram and premium WhatsApp.
4. Core product workflows
5. CFO AI Core functionality
6. AI Accountant functionality
7. Channel strategy
8. Roles and access
9. Plans, trial and subscription lifecycle
Free Plan — permanent entry tier with hard usage and feature limits.
7-Day Full Trial — maximum base-plan functionality without card for early launch.
Paid Base Plans — Starter, Business, Founder and Enterprise.
Premium Add-ons — AI Accountant, Professional Review, Full Service and WhatsApp.
Subscription belongs to Business, not only to User.
After trial, data remains; paid functions lock or become read-only.
10. Pricing hypothesis
Цены являются launch hypothesis. V4.0 учитывает решение повысить прежнюю гипотезу примерно на 30% и округлить до понятных глобальных цен.
Локальные price books могут выставляться в IDR и других валютах. Налоги, payment fees и app-store commissions учитываются в финальной unit economics; Business plans предпочтительно продавать через web billing.
11. Plan limits and feature matrix
12. AI Accountant and channel add-ons
Professional service pricing can vary by jurisdiction, transaction volume, entity type and filing complexity. Platform fee and professional fee must be displayed separately where required.
13. Usage, billing and upgrade logic
Every limited action creates a usage_event with business_id, user_id, source, units and metadata.
AI events should also store model, tokens and cost estimate.
Feature access checks membership, role, plan, trial, subscription, add-on and limit.
Limit reached returns structured upgrade_required response.
Trial reminders: 3 days, 1 day and expiration.
Billing provider webhooks create immutable billing_events.
Add-ons can have independent lifecycle and usage limits.
14. Downgrade and data preservation
15. Professional review and liability boundaries
Prepared by AI, Reviewed by Professional and Approved by Owner are separate states.
AI output includes sources, rule version, verification date and disclaimer.
Professional verification scope must match license and jurisdiction.
Owner gives final approval before payment or filing.
Automated filing is excluded from initial scope.
Disclaimer does not replace professional review for regulated actions.
16. Product analytics and KPIs
17. Non-goals
Full ERP, inventory, CRM or HR suite.
Unverified worldwide tax advice.
Automatic filing without explicit product/legal approval.
Banking custody or money transmission.
Grey WhatsApp automation.
AI replacing licensed professional responsibility.
Separate Accountant AI user base, billing or ledger.
18. Acceptance criteria

## Tables (flattened)

Версия | 4.0
Статус | Product Source of Truth
Дата | Июнь 2026
Назначение | Единая продуктовая спецификация Helm Finance / CFO AI Ecosystem: пользователи, функции, доступ, trial, тарифы и premium add-ons.
Версия | Дата | Изменение | Статус
Master Product Specification V3.3 | До июня 2026 | Исходные документы по access, plans, trial и roadmap | Superseded
4.0 | Июнь 2026 | Объединение CFO AI и AI Accountant в единую продуктовую экосистему | Current Source of Truth
Главное изменение V4.0: AI Accountant не является отдельным приложением. Это платный модуль внутри общего Business Workspace, использующий те же данные, роли, биллинг, Telegram identity и audit trail.
Helm Finance is an AI financial operating system for business owners. CFO AI explains money and decisions; AI Accountant prepares compliance work with official sources and licensed professional review.
Слой | Ценность
CFO AI Core | Financial visibility, team workflow, approvals and decision support.
AI Accountant Compliance | Tax profile, calendar, source-based guidance and document checklist.
Professional Review | Licensed specialist validates drafts and requests corrections.
Full Service | Preparation and filing assistance with owner control.
Telegram / Mobile / WhatsApp | Convenient operational channels connected to the same backend.
Сегмент | Основная проблема | Главная ценность
Solo owner | Нет CFO; деньги в банках и таблицах. | Cash clarity, basic AI CFO and imports.
Small team business | Сотрудники создают расходы и обязательства в чатах. | Telegram submissions, approvals, payroll and accountability.
Growing company | Много счетов, проектов, людей и решений. | Forecast, Decision Engine, multi-business and reports.
Compliance-sensitive business | Сроки, документы, налоги и консультанты разрознены. | AI Accountant, official sources and professional review.
Professional firm | Много клиентов и ручной подготовки. | Partner Portal, review queue and structured evidence.
Workflow | Expected result
Team expense/payable | Manager submits in Telegram → pending → Owner approves/rejects → creator notified → Pay Now selects wallet.
Receivable | Create/approve expected payment → no cash change → Mark Received → wallet increases once.
Payroll | Employee + additions/deductions → net payment → one linked payroll transaction.
Decision check | Before payment: cash/wallet/runway before→after and risk explanation.
Bank import | Upload → preview → deduplicate → match → review → confirm → reconcile.
Compliance | Profile → applicable rule → calendar → draft → professional review → owner approval.
Module | Required capability
Business Setup | Name, country, currency, timezone, workspace and opening setup.
Accounts | Cash/bank/payment accounts, business/personal separation, balances and history.
Transactions | Income, expense, transfer, payroll, owner injection/withdrawal and correction.
Receivables / Payables | Due dates, partial payment, source, creator, approval and status.
Payroll | Employees, additions, deductions, net payment and payment history.
Team & Approvals | Roles, Telegram submissions, inline decisions and creator notifications.
Pulse / Radar | Cash, runway, obligations, risks, actions and trends.
AI CFO | Business questions, sourced context and deterministic Decision Engine explanations.
Module | V1–V2 capability
Tax Profile | Jurisdiction, entity type, regime, identifiers, year, VAT/PKP and payroll status.
Rules & Sources | Versioned rules with official authority, URL, dates and verification.
Compliance Calendar | Upcoming, due soon, overdue, review and filing states.
Document Center | Statements, receipts, notices, invoices, contracts and proofs.
Bank Import | CSV/XLSX first; preview, deduplication, matches and reconciliation.
Tax Draft Engine | Deterministic tax base, adjustments, rates, liability, assumptions and warnings.
Professional Review | Licensed review, change request, approval evidence and SLA.
Owner Approval | Approve/reject/ask details/create tax payable/mark filed.
AI Accountant is advisory and preparation software. AI Draft is not an official filing and must not be represented as professional advice until reviewed by an authorised specialist.
Канал | Функции
Desktop/Web | Full product, imports, rule/source review, reports, professional workspace and complex configuration.
Mobile/PWA | CEO cockpit, approvals, alerts, document upload, comments, deadlines and AI chat.
Telegram | Employee input, files, approvals, creator feedback, daily pulse and compliance reminders.
WhatsApp Premium | Official Cloud API channel for teams that operate in WhatsApp; same backend logic.
Роль | Finance | Compliance | Approval
Owner / CEO | Full | Full + partner assignment | All
Admin | Broad | Operational | Granted
CFO | Full financial | Oversight | Financial / compliance as granted
Accountant | Confirmed records | Draft/review support | No owner approval
Tax Consultant | Scoped financial evidence | Professional review | Professional sign-off only
Manager | Own/assigned operations | Document response | Submit only
Employee | Own submissions | Upload requested docs | None
Auditor | Read-only | Read-only evidence | None
Business Created
→ Trial Active for 7 days
→ Usage + Activation
→ Reminder
→ Paid Base Plan OR Free Downgrade
→ Optional Add-ons
План | Цена / месяц | Для кого | Ключевая ценность
Free | $0 | Один владелец, проба продукта | 1 business, basic cash control and limited AI.
Starter | $25 | Solo founder / micro team | Core finance, Telegram, limited team and AI.
Business | $65 | Small business with team | Payroll, approvals, payables/receivables and Decision Engine.
Founder | $129 | Growing multi-business company | Advanced AI, reports, integrations, extended limits and priority support.
Enterprise | Custom | Large or regulated organisations | Custom limits, security, integrations, SLA and infrastructure.
Feature | Free | Starter | Business | Founder | Enterprise
Businesses | 1 | 1–2 | Several | Multiple | Custom
Users | 1 | Up to 3 | Up to 20 | Up to 100 | Custom
Accounts | 1 | Limited | Extended | High | Custom
Transactions / month | 30 | Higher limit | Extended | High | Custom
AI questions | 10 | Limited | Extended | High | Custom
Voice inputs | 10 | Limited | Extended | High | Custom
Payroll | No | Optional limited | Yes | Yes | Yes
Team Access | No | Basic | Yes | Yes | Custom
Approval Flow | No | Basic/No | Yes | Yes | Custom
Decision Engine | Basic summary | Basic | Full V1 | Advanced | Custom
Reports / Export | No | Basic | Basic | Advanced | Custom
Integrations | No | No | Limited | Yes | Custom
AI Accountant | Add-on | Add-on | Add-on | Add-on | Custom
WhatsApp | No | Add-on | Add-on | Add-on | Custom
Add-on | Indicative price | Includes
AI Accountant Compliance | $29 / business / month | Tax profile, compliance calendar, sources, document checklist and AI explanations.
Professional Review | From $99 / month + service scope | Licensed review workflow, change requests and review evidence.
Full-Service Accounting | From $199 / month or custom | Preparation assistance, recurring review, filing support and priority SLA.
WhatsApp Channel | From $29 / month | Official channel, team input and notifications; message fees/fair-use apply.
Объект после downgrade | Поведение
Payroll | Data remains; editing/payment locks or becomes read-only.
Team members | Additional users lose operational access but records remain attributed.
Advanced AI / Radar | Locked; basic summaries remain according to Free.
Invoices/debts over limits | Existing records visible; new creation blocked.
AI Accountant | Calendar/drafts remain read-only; new calculations/reviews blocked.
Professional assignments | Historical review evidence remains; active service pauses according to terms.
Главное правило: downgrade никогда не удаляет финансовые, документальные или audit данные.
Стандартный дисклеймер: информация носит рекомендательный характер и не является юридической, налоговой или бухгалтерской консультацией. Перед платежом или подачей подтвердите расчёты у лицензированного специалиста.
Группа | Метрики
Activation | Business created, Telegram connected, first transaction, first approval, first AI question.
Core value | Weekly active owner, reconciled cash, decision views and completed actions.
Import | Statements uploaded, rows auto-matched, duplicate prevention and discrepancy.
Commercial | Trial→paid, ARPU, add-on attach rate, MRR, churn and gross margin.
Compliance | Profile complete, obligations generated, source coverage, on-time status and review SLA.
Support / Quality | Error rate, cash-impact incidents, permission failures and unresolved documents.
Area | Acceptance condition
Architecture | One Business Workspace and shared access/billing/audit layer.
Finance | Only confirmed transactions move cash; no duplicate impact.
Trial & Plans | Access and limits enforced backend-side; data preserved after downgrade.
AI | Deterministic calculations; AI does not invent arithmetic or tax rules.
Sources | Every active compliance rule has official source metadata.
Professional Review | AI Draft, professional review and owner approval are distinct.
Channels | Web/Mobile/Telegram/WhatsApp use the same backend services.
Security | Business isolation, scoped professional access and immutable audit events.
Commercial | Base plans and add-ons have clear entitlements and usage tracking.
Final Product Statement: Helm Finance gives value for free, demonstrates maximum value in a 7-day trial, monetises operational control through base plans, and increases ARPU through AI Accountant, professional review and premium communication channels.
