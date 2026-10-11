-- Helm Finance — Reference Foundation Migration
-- Date: 2026-06-10
-- Safe to re-run: all statements use IF NOT EXISTS / ON CONFLICT DO NOTHING
-- No data loss: additive only — no DROP, no ALTER COLUMN TYPE, no data removal
--
-- Phase 1: reference data is user_id-scoped.
-- Future: migrate to business_id-scoped model.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. CASHFLOW CATEGORIES (DDS Articles)
-- Source: ДДС статьи sheet, docs/CFO_AI_FINANCIAL_TEMPLATE_LEARNING_MAP.md §4.6
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cashflow_categories (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       BIGINT      NULL,        -- NULL = system/global record
  name          TEXT        NOT NULL,
  group_type    TEXT        NOT NULL,    -- 'inflow' | 'outflow'
  activity_type TEXT        NULL,        -- 'operating' | 'investing' | 'financing' | 'technical'
  sub_category  TEXT        NULL,        -- sub-article description from ДДС статьи col D
  description   TEXT        NULL,        -- extended notes
  is_system     BOOLEAN     NOT NULL DEFAULT FALSE,
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  sort_order    INT         NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. COUNTERPARTIES
-- Source: Контрагенты sheet + ДДС месяц column J
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS counterparties (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    BIGINT      NOT NULL,    -- Phase 1: user-scoped. Future: business_id-scoped.
  name       TEXT        NOT NULL,
  group_name TEXT        NULL,
  type       TEXT        NULL,        -- 'client' | 'supplier' | 'employee' | 'franchisee' | 'partner' | 'bank' | 'owner' | 'other'
  email      TEXT        NULL,
  phone      TEXT        NULL,
  notes      TEXT        NULL,
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. BUSINESS DIRECTIONS
-- Source: Справочники sheet column A
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_directions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    BIGINT      NULL,        -- NULL = system/global record
  name       TEXT        NOT NULL,
  slug       TEXT        NULL,        -- machine-readable code
  is_system  BOOLEAN     NOT NULL DEFAULT FALSE,
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  sort_order INT         NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. ACTIVITY TYPES
-- Source: Справочники sheet column B
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_types (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    BIGINT      NULL,        -- NULL = system/global record
  name       TEXT        NOT NULL,
  code       TEXT        NULL,        -- 'operating' | 'investing' | 'financing' | 'technical'
  is_system  BOOLEAN     NOT NULL DEFAULT FALSE,
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  sort_order INT         NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. ADD NULLABLE REFERENCE COLUMNS TO TRANSACTIONS
-- Keep existing: category TEXT, source TEXT, scope TEXT, type TEXT, etc.
-- All new columns nullable — zero impact on existing rows.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS cashflow_category_id  UUID NULL,
  ADD COLUMN IF NOT EXISTS counterparty_id       UUID NULL,
  ADD COLUMN IF NOT EXISTS counterparty_name     TEXT NULL,
  ADD COLUMN IF NOT EXISTS business_direction_id UUID NULL,
  ADD COLUMN IF NOT EXISTS activity_type_id      UUID NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. SEED SYSTEM BUSINESS DIRECTIONS (3 directions from Helm Care Справочники)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO business_directions (user_id, name, slug, is_system, sort_order)
VALUES
  (NULL, 'Вендинговые автоматы', 'vending',   TRUE, 1),
  (NULL, 'Франшиза',             'franchise',  TRUE, 2),
  (NULL, 'Общее',                'general',    TRUE, 3)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. SEED SYSTEM ACTIVITY TYPES (4 types from Helm Care Справочники)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO activity_types (user_id, name, code, is_system, sort_order)
VALUES
  (NULL, 'Операционная',        'operating',  TRUE, 1),
  (NULL, 'Инвестиционная',      'investing',  TRUE, 2),
  (NULL, 'Финансовая',          'financing',  TRUE, 3),
  (NULL, 'Техническая операция','technical',  TRUE, 4)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. SEED SYSTEM CASHFLOW CATEGORIES
-- Source: ДДС статьи (46 articles) + Learning Map §4.6
-- group_type: 'inflow' | 'outflow'
-- activity_type: 'operating' | 'investing' | 'financing' | 'technical'
-- ─────────────────────────────────────────────────────────────────────────────

-- Technical (transfers between accounts — cash neutral)
INSERT INTO cashflow_categories (user_id, name, group_type, activity_type, sub_category, is_system, sort_order)
VALUES
  (NULL, 'Перевод между счетами — поступление', 'inflow',  'technical', 'Получение перевода с нашего другого счёта или кошелька',  TRUE, 1),
  (NULL, 'Перевод между счетами — выбытие',     'outflow', 'technical', 'Перевод денег на другой наш счёт или кошелёк',           TRUE, 2)
ON CONFLICT DO NOTHING;

-- Operating — Inflows
INSERT INTO cashflow_categories (user_id, name, group_type, activity_type, sub_category, is_system, sort_order)
VALUES
  (NULL, 'Продажи в вендинговых автоматах', 'inflow', 'operating', 'Поступления от продаж на торговых точках, по кассе и безналу', TRUE, 10),
  (NULL, 'Продажи франшизы',                'inflow', 'operating', 'Поступления от продаж франшизных пакетов',                    TRUE, 11),
  (NULL, 'Роялти',                          'inflow', 'operating', 'Регулярные платежи от франчайзи по ставке роялти',            TRUE, 12),
  (NULL, 'Паушальный взнос',                'inflow', 'operating', 'Единовременный взнос за право на франшизу',                   TRUE, 13),
  (NULL, 'Реклама DOOH',                    'inflow', 'operating', 'Поступления от рекламодателей за DOOH-слоты',                 TRUE, 14),
  (NULL, 'Прочие поступления',              'inflow', 'operating', 'Прочие операционные поступления',                            TRUE, 15),
  (NULL, 'Возвраты от поставщиков',         'inflow', 'operating', 'Поставщики вернули деньги за ранее оплаченные товары',       TRUE, 16)
ON CONFLICT DO NOTHING;

-- Operating — Outflows: COGS / Sales
INSERT INTO cashflow_categories (user_id, name, group_type, activity_type, sub_category, is_system, sort_order)
VALUES
  (NULL, 'Возвраты клиентам',    'outflow', 'operating', 'Возврат денег клиентам за ранее купленный товар',                    TRUE, 20),
  (NULL, 'Закупка товара',       'outflow', 'operating', 'Закупка товара для перепродажи на торговых точках',                  TRUE, 21),
  (NULL, 'Транспортные услуги',  'outflow', 'operating', 'Оплата транспортным компаниям за перевозку товаров и документов',    TRUE, 22),
  (NULL, 'Эквайринг',            'outflow', 'operating', 'Комиссии за приём безналичных платежей',                             TRUE, 23),
  (NULL, 'РКО',                  'outflow', 'operating', 'Абонентская плата за обслуживание счёта и комиссии за переводы',     TRUE, 24)
ON CONFLICT DO NOTHING;

-- Operating — Outflows: Personnel
INSERT INTO cashflow_categories (user_id, name, group_type, activity_type, sub_category, is_system, sort_order)
VALUES
  (NULL, 'Зарплата производственного персонала', 'outflow', 'operating', 'Зарплата, бонусы и премии производственных сотрудников', TRUE, 30),
  (NULL, 'Зарплата административного персонала', 'outflow', 'operating', 'Зарплата бухгалтера, директора, управляющих, юриста и т.д.', TRUE, 31),
  (NULL, 'Зарплата коммерческого персонала',     'outflow', 'operating', 'Зарплата продавцов, маркетолога, SMM, директолога',       TRUE, 32),
  (NULL, 'Налоги на ФОТ',                        'outflow', 'operating', 'НДФЛ, ПФР, ФОМС — налоги с фонда оплаты труда',          TRUE, 33),
  (NULL, 'Обучение персонала',                   'outflow', 'operating', 'Компенсация курсов, обучение сотрудников',                TRUE, 34),
  (NULL, 'Расходы на персонал',                  'outflow', 'operating', 'Корпоративы, подарки сотрудникам и прочее',               TRUE, 35),
  (NULL, 'Поиск и найм персонала',               'outflow', 'operating', 'Оплата рекрутеров, hh.ru и других площадок',              TRUE, 36)
ON CONFLICT DO NOTHING;

-- Operating — Outflows: Travel & Representation
INSERT INTO cashflow_categories (user_id, name, group_type, activity_type, sub_category, is_system, sort_order)
VALUES
  (NULL, 'Командировочные расходы',  'outflow', 'operating', 'Билеты, проживание, суточные сотрудников',              TRUE, 40),
  (NULL, 'Представительские расходы','outflow', 'operating', 'Обеды с клиентами, подарки клиентам',                   TRUE, 41)
ON CONFLICT DO NOTHING;

-- Operating — Outflows: Marketing
INSERT INTO cashflow_categories (user_id, name, group_type, activity_type, sub_category, is_system, sort_order)
VALUES
  (NULL, 'Оплата рекламных систем',   'outflow', 'operating', 'Покупка трафика: Meta Ads, Google Ads, Telegram и т.д.', TRUE, 50),
  (NULL, 'Маркетинговые подрядчики',  'outflow', 'operating', 'Агентства, дизайнеры, копирайтеры, SMM-подрядчики',     TRUE, 51)
ON CONFLICT DO NOTHING;

-- Operating — Outflows: Admin / Professional Services
INSERT INTO cashflow_categories (user_id, name, group_type, activity_type, sub_category, is_system, sort_order)
VALUES
  (NULL, 'Административные подрядчики', 'outflow', 'operating', 'Финансовый, юридический, бухгалтерский консалтинг', TRUE, 55)
ON CONFLICT DO NOTHING;

-- Operating — Outflows: IT / Digital
INSERT INTO cashflow_categories (user_id, name, group_type, activity_type, sub_category, is_system, sort_order)
VALUES
  (NULL, 'Электронные подписки', 'outflow', 'operating', 'SaaS-сервисы: Zoom, Miro, Zoho, AWS, Hetzner и др.',  TRUE, 60),
  (NULL, 'Связь и интернет',     'outflow', 'operating', 'Мобильная связь, интернет, SIM-карты',                TRUE, 61)
ON CONFLICT DO NOTHING;

-- Operating — Outflows: Vending & Locations
INSERT INTO cashflow_categories (user_id, name, group_type, activity_type, sub_category, is_system, sort_order)
VALUES
  (NULL, 'Содержание вендинговых автоматов', 'outflow', 'operating', 'Расходники, фильтры, запчасти, мелкое обслуживание автоматов', TRUE, 70),
  (NULL, 'Аренда торговых точек',            'outflow', 'operating', 'Аренда и коммунальные расходы по торговым точкам',            TRUE, 71),
  (NULL, 'Аренда техники',                   'outflow', 'operating', 'Аренда грузового и прочего транспорта',                       TRUE, 72)
ON CONFLICT DO NOTHING;

-- Operating — Outflows: Office
INSERT INTO cashflow_categories (user_id, name, group_type, activity_type, sub_category, is_system, sort_order)
VALUES
  (NULL, 'Содержание офиса',          'outflow', 'operating', 'Канцелярия, хоз. товары, вода, уборка офиса',      TRUE, 80),
  (NULL, 'Хоз. инвентарь',           'outflow', 'operating', 'Хозяйственный инвентарь',                           TRUE, 81),
  (NULL, 'Аренда офиса',              'outflow', 'operating', 'Аренда и коммунальные расходы по офису',            TRUE, 82),
  (NULL, 'Ремонт и содержание офиса', 'outflow', 'operating', 'Ремонт офиса и текущее содержание',                 TRUE, 83),
  (NULL, 'Оргтехника',                'outflow', 'operating', 'Ноутбуки, принтеры, мобильные телефоны',            TRUE, 84)
ON CONFLICT DO NOTHING;

-- Operating — Outflows: Other
INSERT INTO cashflow_categories (user_id, name, group_type, activity_type, sub_category, is_system, sort_order)
VALUES
  (NULL, 'Покупка наличности', 'outflow', 'operating', 'Комиссии за снятие или конвертацию наличных денег', TRUE, 90),
  (NULL, 'Выплата франчайзи',  'outflow', 'operating', 'Платежи партнёрам-франчайзи по договору',          TRUE, 91)
ON CONFLICT DO NOTHING;

-- Investing — Inflows
INSERT INTO cashflow_categories (user_id, name, group_type, activity_type, sub_category, is_system, sort_order)
VALUES
  (NULL, 'Продажа ОС',                    'inflow', 'investing', 'Продажа мебели, техники, оборудования',           TRUE, 100),
  (NULL, 'Возврат кредитов и займов',     'inflow', 'investing', 'Нам вернули выданный кредит или займ',            TRUE, 101),
  (NULL, 'Прочие инвестиционные доходы',  'inflow', 'investing', 'Проценты на остаток по расчётному счёту',         TRUE, 102)
ON CONFLICT DO NOTHING;

-- Investing — Outflows
INSERT INTO cashflow_categories (user_id, name, group_type, activity_type, sub_category, is_system, sort_order)
VALUES
  (NULL, 'Покупка ОС',              'outflow', 'investing', 'Покупка оборудования, мебели, техники (дорогостоящая)', TRUE, 110),
  (NULL, 'Ремонт ОС',               'outflow', 'investing', 'Капитальный ремонт, увеличивающий срок службы актива',  TRUE, 111),
  (NULL, 'Выдача кредитов и займов','outflow', 'investing', 'Мы выдали кредит или займ другой стороне',              TRUE, 112)
ON CONFLICT DO NOTHING;

-- Financing — Inflows
INSERT INTO cashflow_categories (user_id, name, group_type, activity_type, sub_category, is_system, sort_order)
VALUES
  (NULL, 'Получение кредитов и займов', 'inflow', 'financing', 'Нам выдали кредит или займ',              TRUE, 120),
  (NULL, 'Вклад собственника',          'inflow', 'financing', 'Собственник вложил деньги в бизнес',     TRUE, 121)
ON CONFLICT DO NOTHING;

-- Financing — Outflows
INSERT INTO cashflow_categories (user_id, name, group_type, activity_type, sub_category, is_system, sort_order)
VALUES
  (NULL, 'Оплаты по кредитам и займам', 'outflow', 'financing', 'Выплата тела долга и процентов по кредитам', TRUE, 130),
  (NULL, 'Дивиденды',                   'outflow', 'financing', 'Выплата дивидендов собственникам',           TRUE, 131)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICATION QUERY — run to confirm tables and columns exist
-- ─────────────────────────────────────────────────────────────────────────────
SELECT table_name, COUNT(*) AS rows
FROM (
  SELECT 'cashflow_categories' AS table_name FROM cashflow_categories
  UNION ALL
  SELECT 'business_directions' FROM business_directions
  UNION ALL
  SELECT 'activity_types' FROM activity_types
) t
GROUP BY table_name
ORDER BY table_name;
