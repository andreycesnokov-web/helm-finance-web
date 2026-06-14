HELM FINANCE
AI ACCOUNTANT MODULE
SPECIFICATION V1.0
INDONESIA FOUNDATION, BANK IMPORT, COMPLIANCE & PROFESSIONAL REVIEW
Одна экосистема: CFO AI Core + AI Accountant + Professional Partner Network + Telegram / Mobile / Web.
Контроль версии
Содержание
1. Назначение и продуктовая граница
2. Позиционирование и коммерческая модель
3. Каналы: Desktop, Mobile и Telegram
4. Роли, доступ и ответственность
5. Архитектурные принципы
6. Functional Scope
7. Tax & Compliance Profile
8. Tax Rules Registry и Official Sources
9. Compliance Calendar
10. Document Center
11. Bank Statement Import & Reconciliation
12. AI Classification Review Queue
13. Deterministic Tax Draft Engine
14. Professional Partner Portal
15. Professional Review и Owner Approval
16. Интеграция с CFO AI и Decision Engine
17. Интеграция с Telegram Bot
18. Mobile / PWA companion
19. Data Model и API contracts
20. Security, privacy и audit trail
21. Plans, add-ons и entitlements
22. Implementation Roadmap
23. Acceptance Criteria и test matrix
24. Метрики, риски и ограничения
25. Claude Code execution protocol
26. Final Product Statement
1. Назначение и продуктовая граница
AI Accountant — премиальный модуль внутри Helm Finance / CFO AI Ecosystem. Он использует единый Business Workspace, единый финансовый ledger, единые роли, Telegram identity, тарифы и audit trail. Модуль не создаёт отдельный продукт, отдельную базу клиентов или отдельную финансовую систему.
1.1 Что модуль должен делать
определять применимые обязательства на основе налогового профиля и активных правил;
создавать календарь сроков и задач;
принимать документы и банковские выписки;
предлагать классификацию операций, контрагентов и налоговую обработку;
формировать детерминированные draft-расчёты;
показывать официальные источники и дату актуальности правила;
передавать спорные и критичные позиции лицензированному специалисту;
фиксировать professional review и Owner approval;
передавать подтверждённые обязательства в CFO AI cash forecast и Decision Engine.
1.2 Что модуль не должен обещать
гарантировать отсутствие налоговых штрафов;
выдавать AI Draft за официальную отчётность;
самостоятельно придумывать ставку, срок или применимость налога;
автоматически подавать декларацию в V1;
самостоятельно списывать деньги без подтверждения владельца;
заменять лицензированного бухгалтера или налогового консультанта.
2. Позиционирование и коммерческая модель
AI Accountant продаётся как add-on к Business, Founder и Enterprise. Клиент остаётся в одной экосистеме и включает дополнительный уровень автоматизации и профессиональной проверки для конкретного Business Workspace.
3. Каналы: Desktop, Mobile и Telegram
4. Роли, доступ и ответственность
4.1 Статусы ответственности
AI Draft не является официальным документом. Статус Professional Reviewed появляется только после действия проверенного специалиста. Статус Owner Approved подтверждает решение бизнеса, но не равен Filed или Paid.
5. Архитектурные принципы
6. Functional Scope
7. Tax & Compliance Profile
Tax Profile — business-scoped конфигурация, определяющая какие rules и calendar events применимы. Изменение критичных полей должно создавать audit event и, при наличии профессионального партнёра, отправляться на re-validation.
7.1 Profile validation
показывать completeness score;
не создавать tax obligation без минимально достаточного профиля;
помечать конфликтующие поля;
хранить дату и автора последнего подтверждения;
пересчитывать будущий календарь при изменении профиля, не переписывая закрытые периоды.
8. Tax Rules Registry и Official Sources
Tax Rules Registry — центральный реестр версионированных правил. Первая версия создаёт архитектуру и workflow, но не должна содержать непроверенные налоговые формулы.
9. Compliance Calendar
Calendar создаётся из Tax Profile + active rules. События должны быть повторяемыми, version-aware и business-scoped.
9.1 Типы событий
tax payment
tax return
annual filing
payroll obligation
VAT/PPN obligation
license renewal
document collection deadline
professional review deadline
10. Document Center
Document Center — единое хранилище финансовых и compliance-документов. Файл и его extracted metadata являются отдельными сущностями; загрузка документа не меняет ledger.
10.1 Document statuses
файлы хранятся в private storage;
доступ выдаётся signed URL с коротким сроком;
каждый download/view фиксируется для чувствительных документов;
удаление должно быть soft-delete с retention policy;
оригинал файла никогда не заменяется extracted version.
11. Bank Statement Import & Reconciliation
Bank import — ключевая функция снижения ручного ввода. V1 начинается с CSV/XLSX, потому что структурированные форматы дают более высокую точность и контролируемую дедупликацию. PDF добавляется после стабилизации import pipeline.
11.1 Дедупликация
Проверка должна использовать bank reference при наличии; иначе — wallet + date + amount + direction + normalized description hash. Повторная загрузка одной выписки не создаёт повторные транзакции.
11.2 Confirm import
до подтверждения строки не влияют на баланс;
подтверждение создаёт transactions только для approved rows;
matched rows связываются с существующими transaction/debt/payroll без дубля;
отмена batch не удаляет ранее существовавшие записи;
импорт должен быть идемпотентным и иметь rollback для текущего batch.
12. AI Classification Review Queue
Все предложения должны иметь confidence score, model/version и explanation. Низкая уверенность отправляет строку в review_required. Автоподтверждение разрешено только для заранее одобренных низкорисковых шаблонов конкретного бизнеса.
13. Deterministic Tax Draft Engine
Tax Draft Engine получает подтверждённые данные периода и активную версию правила. Он возвращает структурированный расчёт, который может быть объяснён AI, проверен специалистом и подтверждён Owner.
14. Professional Partner Portal
Первая версия — закрытая партнёрская сеть. Публичный marketplace не строится до появления доказанного спроса, SLA и проверенного процесса качества.
15. Professional Review и Owner Approval
15.1 Professional review
видит полный source trace и спорные строки;
может запросить документы или переклассификацию;
фиксирует комментарий, license identity и review timestamp;
не может менять исходную выписку или скрывать audit trail;
при изменении подтверждённых операций draft автоматически становится stale и требует re-review.
15.2 Owner approval
видит сумму, период, формулу, источники, missing documents и комментарий специалиста;
может approve, reject, ask details или return to accountant;
Owner approval не равен filing;
создание tax payment использует существующий CFO AI Decision Engine и wallet selection;
оплата создаёт одну транзакцию и связывается с obligation.
16. Интеграция с CFO AI и Decision Engine
AI Accountant передаёт в финансовый контекст только структурированные и статусные данные. CFO AI должен различать estimate, professionally reviewed liability и paid/settled obligation.
17. Интеграция с Telegram Bot
17.1 Telegram security
все bot-to-backend вызовы используют x-bot-secret;
telegram_id резолвится в user_id и membership;
файл привязывается только к активному business_id;
бот не принимает самостоятельное решение о permission;
в Telegram не отправляются полные налоговые данные другим сотрудникам.
18. Mobile / PWA companion
19. Data Model и API contracts
19.1 Основные таблицы
19.2 API groups
20. Security, privacy и audit trail
21. Plans, add-ons и entitlements
AI Accountant включается на уровне Business Subscription. Проверка доступа выполняется backend, независимо от Web, Mobile или Telegram.
21.1 Entitlement codes
ai_accountant_profile
ai_accountant_calendar
document_center
bank_import
tax_draft
professional_review
filing_assistance
partner_portal
22. Implementation Roadmap
23. Acceptance Criteria и test matrix
24. Метрики, риски и ограничения
24.1 Product metrics
24.2 Главные риски
25. Claude Code execution protocol
Каждая implementation task для Claude Code должна начинаться с аудита и завершаться проверяемым отчётом. Нельзя переписывать существующий working flow без доказанной причины.
Audit first: найти существующие tables, helpers, endpoints, roles, storage и i18n;
Reuse: единый business resolver, access checks, audit, upload и AI patterns;
No destructive migration: только additive/idempotent SQL;
No direct writes from AI: draft/review-first;
Backend source of truth: frontend и Telegram не решают permissions;
Build and tests: node check, frontend build, migration audit, regression scenarios;
Render product state: empty/loading/error/locked/trial/paid states;
Completion report: audit, changed files, schema, security, tests, limitations, commit.
26. Final Product Statement
AI Accountant не является отдельной бухгалтерской программой рядом с CFO AI. Это premium compliance layer внутри одной финансовой экосистемы.
CFO AI отвечает на вопрос: “Что происходит с деньгами и какое решение принять?”
AI Accountant отвечает на вопрос: “Какие обязательства применимы, какие документы и расчёты нужны, кем они проверены и что должен подтвердить Owner?”
Professional Partner Network добавляет доверие и ответственность, а Telegram/Mobile уменьшают трение в сборе документов и подтверждениях.

## Tables (flattened)

Версия | 1.0
Статус | Module Source of Truth
Дата | Июнь 2026
Назначение | Подробная продуктовая и техническая спецификация AI Accountant как платного add-on внутри CFO AI Ecosystem.
Поле | Значение
Документ | HELM FINANCE — AI ACCOUNTANT MODULE SPECIFICATION
Версия | 1.0
Статус | Module Source of Truth
Родительские документы | System Architecture V4.0; Product Roadmap V4.0; Master Product Specification V4.0
Первая юрисдикция | Indonesia
Основной интерфейс | Desktop / Web App
Companion interfaces | Mobile / PWA и Telegram
Следующий дочерний документ | INDONESIA TAX RULE PACK V1.0
Этот документ определяет, что именно строится в AI Accountant, как модуль связан с CFO AI, какие данные являются источником истины, где требуется профессиональная проверка и какие функции не входят в первую версию.
Главная задача AI Accountant: превратить подтверждённые финансовые данные бизнеса в контролируемый compliance workflow — от документов и выписок до AI Draft, профессиональной проверки и подтверждения владельцем.
Пакет | Ценность | Рабочая цена
AI Accountant Compliance | Tax Profile, календарь, official sources, документы, AI Draft estimates | от $29 / business / month
Professional Review | Проверка лицензированным специалистом, комментарии, review status | от $99 / business / month или per filing
Full-Service Accounting | Подготовка пакета, review, filing assistance, повышенный SLA | от $199 / business / month
Bank Import & Reconciliation | Импорт выписок, дедупликация, matching, review queue | включён в Pro или отдельный usage add-on
AI Accountant повышает ARPU и retention, но не должен размывать CFO AI Core. Финансовый контроль остаётся основным продуктом; compliance и professional review — платное расширение.
Канал | Основная роль | Что входит
Desktop / Web | Полноценное рабочее место | Tax Profile, rules, calendar, documents, bank import, reconciliation, tax drafts, review queue, partner portal, owner approval, exports
Mobile / PWA | Контроль и подтверждение | Сроки, уведомления, загрузка файлов, missing documents, комментарии, review status, approve/reject, официальный источник
Telegram | Операционный канал | Получение документов, ответы на запросы, напоминания, owner alerts, быстрые подтверждения и deep links
Не переносить сложные таблицы и полный tax-workbench в мобильный интерфейс или Telegram. Desktop — источник полнофункциональной работы; мобильный и Telegram — companion channels.
Роль | Права в AI Accountant | Ограничения
Owner / CEO | Полный обзор, настройка профиля, назначение специалиста, owner approval, создание платежа | Не может скрытно менять профессиональное заключение
Admin / CFO | Операционное управление, review, документы, drafts, комментарии | Критичные профильные изменения требуют Owner approval
Accountant | Классификация, reconciliation, подготовка draft, запрос документов | Нет доступа к personal workspace и оплате без разрешения
Tax Consultant | Professional review, подтверждение правил/расчётов, compliance comments | Только назначенные бизнесы и разрешённые юрисдикции
Public Accountant / KAP | Audit readiness, официальная проверка в разрешённом объёме | Не используется для повседневной первички по умолчанию
Manager / Employee | Загрузка документов, ответы на запросы, создание заявок | Нет доступа к полным tax calculations и company cash
Auditor | Read-only доступ к выбранным периодам, audit trail и документам | Без редактирования и approvals
Prepared by AI | Professional Reviewed | Owner Approved | Ready to Pay / File
Принцип | Требование
One business source of truth | Все данные привязаны к business_id; personal wallets и personal transactions не попадают в business compliance.
Deterministic first | Формулы, сроки и применимость правил рассчитываются кодом и версиями правил; LLM не является источником арифметики.
AI explains, human approves | AI классифицирует и объясняет; профессионал проверяет; Owner подтверждает.
No silent writes | Документы, распознавание и импорт создают draft/review records, а не подтверждённые транзакции.
Versioned rules | Правило не перезаписывается задним числом; создаётся новая версия с effective dates.
Official source traceability | Каждый расчёт показывает rule_id, источник, дату проверки и версию.
Channel parity | Web, Mobile и Telegram используют одни backend endpoints и одинаковые permissions.
Auditability | Каждое изменение, review, approval, payment и filing status фиксируется.
Модуль | V1 | V1.5 / Future
Tax & Compliance Profile | Да | Дополнительные юрисдикционные поля
Tax Rules Registry | Да, Indonesia foundation | Автоматизированный update workflow
Official Sources Layer | Да, manual verification | Source monitoring / change detection
Compliance Calendar | Да | Complex multi-entity calendar
Document Center | Да | Advanced OCR и document graph
Bank Import | CSV/XLSX | PDF/OCR и direct bank feeds
AI Classification | Suggestions + confidence | Continuous learning per business
Tax Draft Engine | Framework + verified rule packs | Advanced declarations and filing connectors
Professional Portal | Closed partner network | Marketplace and payouts
Owner Approval | Да | Delegated signing / e-signature
Filing | Status + export package | Direct government integration
Группа | Поля
Юрисдикция | country, jurisdiction, tax_residency, reporting_currency, timezone
Юридическая форма | legal_entity_type, registration_number, tax_identifier, business_activity_codes
Налоговый режим | tax_regime, VAT/PPN/PKP status, filing_frequency, accounting_method
Отчётный период | financial_year_start, financial_year_end, fiscal_period configuration
Работники | has_employees, payroll_tax_status, BPJS/compliance flags where applicable
Ответственные | owner, internal accountant, professional_partner_id
Поле правила | Назначение
rule_code / obligation_type | Уникальный тип обязательства и логический ключ
jurisdiction / legal_entity_type / tax_regime | Условия применимости
calculation_method / parameters | Детерминированная формула и параметры
filing_frequency / due_date_rule | Расписание создания обязательств
effective_from / effective_to | Версионность по датам
official_authority / source_url | Официальный источник
last_verified_at / verified_by | Контроль актуальности
status | draft, under_review, active, deprecated, superseded
Активировать правило можно только после professional verification. Изменение действующего правила создаёт новую версию; закрытые периоды сохраняют использованную rule_version.
Статус | Смысл
upcoming | Срок впереди, работа не начата
due_soon | Срок входит в configured warning window
overdue | Срок прошёл, обязательство не закрыто
draft_ready | AI Draft сформирован
under_review | Профессиональная проверка
owner_approval_required | Нужно решение Owner
ready_to_file | Пакет готов к подаче
paid / filed | Фактическое завершение с подтверждающим документом
not_applicable | Осознанно исключено с причиной и аудиторским следом
Тип документа | Примеры связей
bank_statement | wallet, import batch, reconciliation period
invoice / supplier_bill | debt, counterparty, transaction
receipt | transaction, employee submission
payroll_document | employee, payroll period
tax_notice | tax obligation, calendar event
tax_payment_proof | tax payable, transaction, filing status
company_registration / license | tax profile, legal entity
contract / other | counterparty, project, compliance request
uploaded | extracting | review_required | confirmed | linked / archived
Upload | Detect format | Parse raw rows | Deduplicate | Match records | Review | Confirm import | Reconcile
Сущность | Назначение
bank_import_batches | Файл, кошелёк, период, статус, контрольные суммы
bank_import_rows | Исходная строка, нормализованная дата/сумма/направление/описание
bank_import_matches | Кандидаты на match с transaction, debt, payroll, transfer
bank_reconciliations | Opening/closing balance, system balance, difference, status
AI suggestion | Обязательные поля
Transaction classification | type, category, direction, scope, project
Counterparty | candidate_id, normalized_name, confidence
Tax treatment | rule candidate, deductibility, document requirement
Matching | invoice/debt/payroll/transfer candidate
Risk | duplicate, unusual amount, missing evidence, personal/business conflict
Confirmed ledger | Verified documents | Active rule version | Deterministic calculation | AI explanation | Professional review
Результат | Содержание
tax_base | Исходная база и включённые операции
adjustments | Корректировки с причинами и источниками
deductible / non-deductible | Разделение операций и evidence status
rate / parameters | Значения из rule version
estimated_liability | Рассчитанная сумма до профессиональной проверки
payments_already_made | Подтверждённые связанные платежи
remaining_amount | Ожидаемая сумма к оплате
warnings / assumptions | Недостающие данные, спорные позиции
source_trace | rule_id, version, official source, verified date
LLM не имеет права пересчитывать tax liability самостоятельно или противоречить результату движка. При отсутствии verified rule система показывает “Calculation unavailable — professional verification required”.
Функция | V1 поведение
Professional profile | Специализация, языки, юрисдикции, license metadata, SLA
License verification | Manual verification, статус и дата проверки
Business assignment | Только назначенные business_id и разрешённый scope
Review queue | Drafts, documents, conflicts, deadlines
Document requests | Запрос сотруднику/Owner через Web и Telegram
Review action | Approve, changes requested, comment, source validation
Client portfolio | Список назначенных клиентов без доступа к другим бизнесам
Audit | Каждое профессиональное действие и использованная лицензия
AI Draft | Review Requested | Under Professional Review | Professionally Reviewed | Owner Approval | Ready to Pay / File
Статус AI Accountant | Как учитывать в CFO AI
AI estimate | Potential obligation; не считать подтверждённым cash outflow
Professional reviewed | Confirmed future obligation в прогнозе
Owner approved | High-confidence planned cash outflow
Payment created | Pending/confirmed transaction по стандартной cash logic
Paid | Фактический cash impact и закрытие обязательства
Overdue filing | Compliance risk, но не выдумывать monetary penalty без rule
Пример CFO AI: “Через 9 дней ожидается налоговый платёж 18M IDR. Расчёт профессионально проверен, но ещё не подтверждён Owner. Оплата текущих payables сегодня снизит protected reserve ниже 30 дней.”
Сценарий | Поведение
Employee uploads receipt/PDF | Файл в Document Center, source_channel=telegram, review task; без автоматической транзакции
Bank statement upload | Создаётся import batch; пользователь получает ссылку на desktop review
Missing document request | Бот отправляет запрос конкретному участнику и deep link
Owner reminder | Due soon / overdue / review ready / approval required
Professional notification | Новый review request, новый документ, изменения периода
Owner approval | Краткое summary + View details; сложный расчёт открывается в Web
Mobile feature | Scope
Compliance home | Ближайшие сроки, риски, review status
Document upload | Фото/PDF, выбор бизнеса и типа документа
Tasks | Missing documents, clarification, Owner approval
Draft summary | Сумма, период, источник, review status
Professional comments | Чтение и ответ
Official source | Открыть источник и дату проверки
Deep link | Переход в desktop workbench для сложной работы
Таблица | Ключевые связи
tax_profiles | business_id, professional_partner_id, profile_status
tax_rules | jurisdiction, version, effective dates, source_id, status
official_sources | authority, url, publication date, verification
compliance_obligations | business_id, rule_id, period, due_date, statuses
documents | business_id, uploader, channel, links, review status
document_extractions | document_id, model, raw/normalized metadata, confidence
bank_import_batches | business_id, wallet_id, file, period, status
bank_import_rows | batch_id, normalized fields, duplicate status
bank_import_matches | row_id, entity type/id, confidence, decision
bank_reconciliations | wallet, period, statement/system balances
tax_drafts | obligation_id, rule_version, calculation snapshot, status
professional_partners | identity, license metadata, verification status
professional_assignments | partner_id, business_id, scope, dates
professional_reviews | draft_id, reviewer, decision, comments
audit_events | actor, business, entity, action, channel, before/after
API group | Примеры
/api/ai-accountant/profile | GET/PATCH profile; validation; completeness
/api/ai-accountant/rules | Admin/professional versioned registry
/api/ai-accountant/calendar | List, regenerate future events, status actions
/api/documents | Upload, metadata, link, signed download, review
/api/bank-imports | Create batch, parse, review, confirm, rollback
/api/ai-accountant/drafts | Generate, explain, request review, owner decision
/api/professional | Assignments, queue, review, document requests
/api/telegram/documents | Bot-safe upload metadata and task linkage
Все endpoints обязаны использовать auth → active business resolution → membership → role → plan/add-on entitlement → business logic → audit event.
Контроль | Требование
Business isolation | Каждый запрос и файл scoped по business_id
Personal separation | Professional partner не видит personal workspace Owner
File security | Private bucket, signed URLs, malware/type/size validation
Least privilege | Права выдаются по роли и назначению специалиста
Sensitive fields | Tax IDs и документы защищены, не логируются в открытом виде
Audit immutability | События не редактируются обычными пользователями
Rule provenance | Каждый draft хранит rule version и source trace
AI privacy | Минимизировать передачу документов в model provider; хранить model/version
Retention | Политики хранения и удаления по юрисдикции/договору
Incident handling | Логи, alerting, revoke access, partner suspension
Feature | Compliance | Professional Review | Full Service
Tax Profile / Calendar | Да | Да | Да
Official Sources | Да | Да | Да
Document Center | Лимит | Расширенный | Расширенный
Bank Imports | Лимит | Больше batch/rows | Высокий лимит
AI Draft | Estimate | Estimate + review | Full workflow
Licensed specialist | Нет | Да | Да
Owner Approval | Да | Да | Да
Filing assistance | Нет | Опционально | Да
SLA | Standard | Priority | Dedicated
Phase | Scope | Exit criteria
0 — Audit & foundation | Repo audit, storage, tenancy, roles, entitlements, architecture doc | No duplication; migration plan approved
1 — Compliance foundation | Tax Profile, Rules Registry, Official Sources, Calendar, disclaimer | Profile creates source-backed calendar
2 — Documents & Bank Import | Document Center, CSV/XLSX, raw rows, dedupe, review, reconciliation | Statement imports without duplicates
3 — AI Classification | Suggestions, confidence, review queue, matching | User confirms high-volume rows efficiently
4 — Tax Draft Engine | Verified rule execution, source trace, AI explanation | Draft reproducible and reviewable
5 — Partner Portal | Verification, assignments, review queue, comments | Closed partner can review assigned business
6 — Owner Approval & Payment | Owner decision, Decision Engine, tax payable, proof | End-to-end reviewed payment flow
7 — Filing readiness | Export package, checklist, status, proof storage | Ready-to-file package without auto filing
8 — Mobile/Telegram completion | Uploads, reminders, approvals, deep links | Companion workflows stable
9 — New jurisdictions | Separate verified rule packs and partner network | No copy/paste of Indonesia logic
Первая большая implementation task должна включать только Phase 0–1. Следующая самостоятельная задача — Bank Statement Import & Reconciliation V1.
Сценарий | Ожидаемый результат
Создание tax profile | business-scoped; audit; completeness; rules resolved
Неполный профиль | Нет выдуманных обязательств; показан missing data state
Изменение rule | Новая версия; старые drafts сохраняют previous version
Calendar generation | Только применимые active rules; no duplicates
Document upload | Private storage; no ledger impact; correct channel/uploader
Duplicate statement | Rows detected; no duplicate transactions
Import preview | No balance change before confirm
Import confirm | Only approved rows create/link transactions
Tax draft | Deterministic result + source trace + disclaimer
AI failure | Calculation remains available; explanation fallback
Professional review | Only assigned verified partner; audit recorded
Owner approval | Status change; no filing/payment unless explicit action
CFO AI integration | Estimates separated from confirmed liabilities
Telegram upload | Correct business/user; review task; no direct confirmed transaction
Plan restriction | Backend blocks feature and returns upgrade metadata
Personal separation | No personal wallet/documents in business compliance
Метрика | Целевой смысл
Import completion rate | Доля batch, завершённых без поддержки
Auto-match acceptance | Качество reconciliation suggestions
Manual input reduction | Снижение ручного ввода операций
Time to tax draft | Скорость подготовки периода
Missing document closure | Скорость сбора evidence
Professional review SLA | Время от request до reviewed
Owner approval time | Скорость принятия решения
Add-on conversion / retention | Коммерческая ценность модуля
Риск | Митигирование
Устаревшие правила | Versioning, last_verified_at, professional review, source monitoring
Ошибочная AI classification | Confidence, review queue, no silent writes
Дубли выписок | Idempotent batch, reference/hash dedupe
Юридическое ожидание “AI гарантирует” | Статусы AI Draft / Reviewed, disclaimer, owner approval
Утечка документов | Private storage, scoped access, audit, signed URLs
Слишком широкий MVP | Phase gates и строгий out-of-scope
Зависимость от одного специалиста | Partner pool, SLA, reassignment
Код считается готовым только после реального end-to-end теста: document/statement → review → confirmed data → draft → professional review → Owner approval → payment/file status.
CFO AI Core | AI Accountant | Professional Review | Owner Control
Главное правило экосистемы: AI подготавливает и объясняет; детерминированный движок рассчитывает; лицензированный специалист проверяет; владелец подтверждает.
