-- 001 — Reference data for a CLEAN installation (generated; do not edit by hand).
-- Rebuild: node scripts/install/build-reference-seed.mjs   ·   Check: --check
-- Source: the reference-data INSERTs of migrations 002_reference_foundation.sql, 005_saas_foundation.sql, 020_ai_accountant_foundation.sql, 054_onboarding_foundation.sql, 062_pnl_groups_industry_templates.sql (verbatim).
-- Contains system reference rows only: activity types, cashflow categories, business directions, legacy plan
-- limits, official tax sources and rules, onboarding flows/steps, industry P&L templates. No customer data.
-- Idempotent: every statement is guarded (ON CONFLICT / WHERE NOT EXISTS). Applied by scripts/install-v2.mjs.
BEGIN;
SET LOCAL search_path = public, extensions;
-- business_directions: system rows (user_id NULL) are seeded once
DO $seed$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.business_directions WHERE user_id IS NULL) THEN
  -- from migrations/002_reference_foundation.sql
  INSERT INTO business_directions (user_id, name, slug, is_system, sort_order)
  VALUES
    (NULL, 'Вендинговые автоматы', 'vending',   TRUE, 1),
    (NULL, 'Франшиза',             'franchise',  TRUE, 2),
    (NULL, 'Общее',                'general',    TRUE, 3)
  ON CONFLICT DO NOTHING;
 END IF;
END $seed$;

-- activity_types: system rows (user_id NULL) are seeded once
DO $seed$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.activity_types WHERE user_id IS NULL) THEN
  -- from migrations/002_reference_foundation.sql
  INSERT INTO activity_types (user_id, name, code, is_system, sort_order)
  VALUES
    (NULL, 'Операционная',        'operating',  TRUE, 1),
    (NULL, 'Инвестиционная',      'investing',  TRUE, 2),
    (NULL, 'Финансовая',          'financing',  TRUE, 3),
    (NULL, 'Техническая операция','technical',  TRUE, 4)
  ON CONFLICT DO NOTHING;
 END IF;
END $seed$;

-- cashflow_categories: system rows (user_id NULL) are seeded once
DO $seed$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.cashflow_categories WHERE user_id IS NULL) THEN
  -- from migrations/002_reference_foundation.sql
  INSERT INTO cashflow_categories (user_id, name, group_type, activity_type, sub_category, is_system, sort_order)
  VALUES
    (NULL, 'Перевод между счетами — поступление', 'inflow',  'technical', 'Получение перевода с нашего другого счёта или кошелька',  TRUE, 1),
    (NULL, 'Перевод между счетами — выбытие',     'outflow', 'technical', 'Перевод денег на другой наш счёт или кошелёк',           TRUE, 2)
  ON CONFLICT DO NOTHING;
  -- from migrations/002_reference_foundation.sql
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
  -- from migrations/002_reference_foundation.sql
  INSERT INTO cashflow_categories (user_id, name, group_type, activity_type, sub_category, is_system, sort_order)
  VALUES
    (NULL, 'Возвраты клиентам',    'outflow', 'operating', 'Возврат денег клиентам за ранее купленный товар',                    TRUE, 20),
    (NULL, 'Закупка товара',       'outflow', 'operating', 'Закупка товара для перепродажи на торговых точках',                  TRUE, 21),
    (NULL, 'Транспортные услуги',  'outflow', 'operating', 'Оплата транспортным компаниям за перевозку товаров и документов',    TRUE, 22),
    (NULL, 'Эквайринг',            'outflow', 'operating', 'Комиссии за приём безналичных платежей',                             TRUE, 23),
    (NULL, 'РКО',                  'outflow', 'operating', 'Абонентская плата за обслуживание счёта и комиссии за переводы',     TRUE, 24)
  ON CONFLICT DO NOTHING;
  -- from migrations/002_reference_foundation.sql
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
  -- from migrations/002_reference_foundation.sql
  INSERT INTO cashflow_categories (user_id, name, group_type, activity_type, sub_category, is_system, sort_order)
  VALUES
    (NULL, 'Командировочные расходы',  'outflow', 'operating', 'Билеты, проживание, суточные сотрудников',              TRUE, 40),
    (NULL, 'Представительские расходы','outflow', 'operating', 'Обеды с клиентами, подарки клиентам',                   TRUE, 41)
  ON CONFLICT DO NOTHING;
  -- from migrations/002_reference_foundation.sql
  INSERT INTO cashflow_categories (user_id, name, group_type, activity_type, sub_category, is_system, sort_order)
  VALUES
    (NULL, 'Оплата рекламных систем',   'outflow', 'operating', 'Покупка трафика: Meta Ads, Google Ads, Telegram и т.д.', TRUE, 50),
    (NULL, 'Маркетинговые подрядчики',  'outflow', 'operating', 'Агентства, дизайнеры, копирайтеры, SMM-подрядчики',     TRUE, 51)
  ON CONFLICT DO NOTHING;
  -- from migrations/002_reference_foundation.sql
  INSERT INTO cashflow_categories (user_id, name, group_type, activity_type, sub_category, is_system, sort_order)
  VALUES
    (NULL, 'Административные подрядчики', 'outflow', 'operating', 'Финансовый, юридический, бухгалтерский консалтинг', TRUE, 55)
  ON CONFLICT DO NOTHING;
  -- from migrations/002_reference_foundation.sql
  INSERT INTO cashflow_categories (user_id, name, group_type, activity_type, sub_category, is_system, sort_order)
  VALUES
    (NULL, 'Электронные подписки', 'outflow', 'operating', 'SaaS-сервисы: Zoom, Miro, Zoho, AWS, Hetzner и др.',  TRUE, 60),
    (NULL, 'Связь и интернет',     'outflow', 'operating', 'Мобильная связь, интернет, SIM-карты',                TRUE, 61)
  ON CONFLICT DO NOTHING;
  -- from migrations/002_reference_foundation.sql
  INSERT INTO cashflow_categories (user_id, name, group_type, activity_type, sub_category, is_system, sort_order)
  VALUES
    (NULL, 'Содержание вендинговых автоматов', 'outflow', 'operating', 'Расходники, фильтры, запчасти, мелкое обслуживание автоматов', TRUE, 70),
    (NULL, 'Аренда торговых точек',            'outflow', 'operating', 'Аренда и коммунальные расходы по торговым точкам',            TRUE, 71),
    (NULL, 'Аренда техники',                   'outflow', 'operating', 'Аренда грузового и прочего транспорта',                       TRUE, 72)
  ON CONFLICT DO NOTHING;
  -- from migrations/002_reference_foundation.sql
  INSERT INTO cashflow_categories (user_id, name, group_type, activity_type, sub_category, is_system, sort_order)
  VALUES
    (NULL, 'Содержание офиса',          'outflow', 'operating', 'Канцелярия, хоз. товары, вода, уборка офиса',      TRUE, 80),
    (NULL, 'Хоз. инвентарь',           'outflow', 'operating', 'Хозяйственный инвентарь',                           TRUE, 81),
    (NULL, 'Аренда офиса',              'outflow', 'operating', 'Аренда и коммунальные расходы по офису',            TRUE, 82),
    (NULL, 'Ремонт и содержание офиса', 'outflow', 'operating', 'Ремонт офиса и текущее содержание',                 TRUE, 83),
    (NULL, 'Оргтехника',                'outflow', 'operating', 'Ноутбуки, принтеры, мобильные телефоны',            TRUE, 84)
  ON CONFLICT DO NOTHING;
  -- from migrations/002_reference_foundation.sql
  INSERT INTO cashflow_categories (user_id, name, group_type, activity_type, sub_category, is_system, sort_order)
  VALUES
    (NULL, 'Покупка наличности', 'outflow', 'operating', 'Комиссии за снятие или конвертацию наличных денег', TRUE, 90),
    (NULL, 'Выплата франчайзи',  'outflow', 'operating', 'Платежи партнёрам-франчайзи по договору',          TRUE, 91)
  ON CONFLICT DO NOTHING;
  -- from migrations/002_reference_foundation.sql
  INSERT INTO cashflow_categories (user_id, name, group_type, activity_type, sub_category, is_system, sort_order)
  VALUES
    (NULL, 'Продажа ОС',                    'inflow', 'investing', 'Продажа мебели, техники, оборудования',           TRUE, 100),
    (NULL, 'Возврат кредитов и займов',     'inflow', 'investing', 'Нам вернули выданный кредит или займ',            TRUE, 101),
    (NULL, 'Прочие инвестиционные доходы',  'inflow', 'investing', 'Проценты на остаток по расчётному счёту',         TRUE, 102)
  ON CONFLICT DO NOTHING;
  -- from migrations/002_reference_foundation.sql
  INSERT INTO cashflow_categories (user_id, name, group_type, activity_type, sub_category, is_system, sort_order)
  VALUES
    (NULL, 'Покупка ОС',              'outflow', 'investing', 'Покупка оборудования, мебели, техники (дорогостоящая)', TRUE, 110),
    (NULL, 'Ремонт ОС',               'outflow', 'investing', 'Капитальный ремонт, увеличивающий срок службы актива',  TRUE, 111),
    (NULL, 'Выдача кредитов и займов','outflow', 'investing', 'Мы выдали кредит или займ другой стороне',              TRUE, 112)
  ON CONFLICT DO NOTHING;
  -- from migrations/002_reference_foundation.sql
  INSERT INTO cashflow_categories (user_id, name, group_type, activity_type, sub_category, is_system, sort_order)
  VALUES
    (NULL, 'Получение кредитов и займов', 'inflow', 'financing', 'Нам выдали кредит или займ',              TRUE, 120),
    (NULL, 'Вклад собственника',          'inflow', 'financing', 'Собственник вложил деньги в бизнес',     TRUE, 121)
  ON CONFLICT DO NOTHING;
  -- from migrations/002_reference_foundation.sql
  INSERT INTO cashflow_categories (user_id, name, group_type, activity_type, sub_category, is_system, sort_order)
  VALUES
    (NULL, 'Оплаты по кредитам и займам', 'outflow', 'financing', 'Выплата тела долга и процентов по кредитам', TRUE, 130),
    (NULL, 'Дивиденды',                   'outflow', 'financing', 'Выплата дивидендов собственникам',           TRUE, 131)
  ON CONFLICT DO NOTHING;
 END IF;
END $seed$;

-- from migrations/005_saas_foundation.sql
INSERT INTO plan_limits (
  plan,
  max_businesses, max_users, max_wallets,
  max_transactions_per_month, max_invoices_per_month,
  max_ai_questions_per_month, max_voice_inputs_per_month,
  payroll_enabled, team_access_enabled, approval_flow_enabled,
  advanced_radar_enabled, export_enabled, integrations_enabled
) VALUES
  
  ('free',        1,   1,    1,    30,    3,    10,   10,   false, false, false, false, false, false),
  
  ('starter',     2,   3,    5,   300,   30,   100,  100,  false, false, false, false, false, false),
  
  ('business',    3,  20,   20,  2000,  200,   500,  500,  true,  true,  true,  false, true,  false),
  
  ('founder',    10, 100,  100, 10000, 1000,  2000, 2000,  true,  true,  true,  true,  true,  true),
  
  ('enterprise', NULL, NULL, NULL, NULL, NULL, NULL, NULL,  true,  true,  true,  true,  true,  true)
ON CONFLICT (plan) DO NOTHING;

-- from migrations/020_ai_accountant_foundation.sql
INSERT INTO official_sources (id, jurisdiction, authority, title, url, publication_date)
SELECT '11111111-1111-1111-1111-111111111111', 'ID', 'Direktorat Jenderal Pajak',
       'DJP — Pajak Pertambahan Nilai (PPN)', 'https://www.pajak.go.id/id/pajak-pertambahan-nilai-ppn', NULL
WHERE NOT EXISTS (SELECT 1 FROM official_sources WHERE id = '11111111-1111-1111-1111-111111111111');

-- from migrations/020_ai_accountant_foundation.sql
INSERT INTO official_sources (id, jurisdiction, authority, title, url, publication_date)
SELECT '22222222-2222-2222-2222-222222222222', 'ID', 'Direktorat Jenderal Pajak',
       'DJP — Pajak Penghasilan Badan (PPh Badan)', 'https://www.pajak.go.id/id/pajak-penghasilan-pph', NULL
WHERE NOT EXISTS (SELECT 1 FROM official_sources WHERE id = '22222222-2222-2222-2222-222222222222');

-- from migrations/020_ai_accountant_foundation.sql
INSERT INTO official_sources (id, jurisdiction, authority, title, url, publication_date)
SELECT '33333333-3333-3333-3333-333333333333', 'ID', 'Direktorat Jenderal Pajak',
       'DJP — PPh Pasal 21 (Pemotongan Gaji)', 'https://www.pajak.go.id/id/pph-pasal-21', NULL
WHERE NOT EXISTS (SELECT 1 FROM official_sources WHERE id = '33333333-3333-3333-3333-333333333333');

-- from migrations/020_ai_accountant_foundation.sql
INSERT INTO tax_rules (jurisdiction, country, obligation_type, rule_code, title, description, calculation_method, parameters, filing_frequency, payment_frequency, due_date_rule, applies_when, official_source_id, status)
SELECT 'ID','Indonesia','vat','ID_PPN_MONTHLY','PPN (VAT) — monthly return',
       'Value Added Tax on taxable supplies, reported monthly by a registered taxable enterprise (PKP).',
       'output_vat = 11% of taxable sales; payable = output_vat − creditable input_vat',
       '{"rate":0.11}'::jsonb,'monthly','monthly','end of following month',
       '{"vat_status":"pkp"}'::jsonb,'11111111-1111-1111-1111-111111111111','active'
WHERE NOT EXISTS (SELECT 1 FROM tax_rules WHERE rule_code = 'ID_PPN_MONTHLY');

-- from migrations/020_ai_accountant_foundation.sql
INSERT INTO tax_rules (jurisdiction, country, legal_entity_type, obligation_type, rule_code, title, description, calculation_method, parameters, filing_frequency, payment_frequency, due_date_rule, applies_when, official_source_id, status)
SELECT 'ID','Indonesia','PT','corporate_income_tax','ID_PPH_BADAN_ANNUAL','PPh Badan — annual corporate income tax',
       'Annual corporate income tax return for a limited company (PT).',
       'estimated = 22% of annual taxable profit (general rate; small-business facilities may apply)',
       '{"rate":0.22}'::jsonb,'annual','annual','4 months after financial year end',
       '{}'::jsonb,'22222222-2222-2222-2222-222222222222','active'
WHERE NOT EXISTS (SELECT 1 FROM tax_rules WHERE rule_code = 'ID_PPH_BADAN_ANNUAL');

-- from migrations/020_ai_accountant_foundation.sql
INSERT INTO tax_rules (jurisdiction, country, obligation_type, rule_code, title, description, calculation_method, parameters, filing_frequency, payment_frequency, due_date_rule, applies_when, official_source_id, status)
SELECT 'ID','Indonesia','payroll_tax','ID_PPH21_MONTHLY','PPh 21 — monthly payroll withholding',
       'Monthly withholding of employee income tax (PPh 21) by the employer.',
       'withholding computed per employee from gross salary using progressive PPh 21 schedule',
       '{}'::jsonb,'monthly','monthly','payment by the 10th, return by the 20th of the following month',
       '{"has_employees":true}'::jsonb,'33333333-3333-3333-3333-333333333333','active'
WHERE NOT EXISTS (SELECT 1 FROM tax_rules WHERE rule_code = 'ID_PPH21_MONTHLY');

-- from migrations/054_onboarding_foundation.sql
INSERT INTO onboarding_flows (flow_key, title, description, title_i18n, description_i18n, mode, audience, sort_order, metadata)
VALUES
  ('quick_business_setup',
   'Quick setup',
   'Get your workspace usable in a few minutes.',
   '{"ru":"Быстрая настройка","id":"Penyiapan cepat"}'::jsonb,
   '{"ru":"Подготовьте рабочее пространство за несколько минут.","id":"Siapkan ruang kerja Anda dalam beberapa menit."}'::jsonb,
   'quick_setup', 'business_owner', 10,
   '{"shown_after":"registration"}'::jsonb),

  ('full_business_tour',
   'Full product tour',
   'A page-by-page walkthrough of everything in your workspace.',
   '{"ru":"Полный тур по продукту","id":"Tur produk lengkap"}'::jsonb,
   '{"ru":"Пошаговый обзор всех разделов рабочего пространства.","id":"Panduan halaman demi halaman untuk seluruh ruang kerja Anda."}'::jsonb,
   'full_tour', 'all', 20,
   '{"launchable_manually":true}'::jsonb),

  ('ai_accountant_company_setup',
   'AI Accountant company setup',
   'Complete your company profile so the AI Accountant can work with real data.',
   '{"ru":"Настройка компании для AI-бухгалтера","id":"Penyiapan perusahaan AI Accountant"}'::jsonb,
   '{"ru":"Заполните профиль компании, чтобы AI-бухгалтер работал с реальными данными.","id":"Lengkapi profil perusahaan agar AI Accountant bekerja dengan data nyata."}'::jsonb,
   'feature_tour', 'business_owner', 30,
   '{"guidance_only":true,"not_tax_advice":true}'::jsonb)
ON CONFLICT (flow_key) DO NOTHING;

-- from migrations/054_onboarding_foundation.sql
INSERT INTO onboarding_steps (flow_id, step_key, title, description, title_i18n, description_i18n,
                              instructions_i18n, page_path, product_area, action_type, required, skippable, sort_order, metadata)
SELECT f.id, v.step_key, v.title, v.description, v.title_i18n::jsonb, v.description_i18n::jsonb,
       v.instructions_i18n::jsonb, v.page_path, v.product_area, v.action_type, v.required, v.skippable, v.sort_order, v.metadata::jsonb
FROM onboarding_flows f CROSS JOIN (VALUES
  ('welcome_to_cfo_ai', 'Welcome to CFO AI',
   'A quick look at what this workspace does before you set it up.',
   '{"ru":"Добро пожаловать в CFO AI","id":"Selamat datang di CFO AI"}',
   '{"ru":"Коротко о том, что умеет это рабочее пространство.","id":"Sekilas tentang fungsi ruang kerja ini."}',
   '{}', '/business/pulse', 'general', 'read', false, true, 10, '{}'),

  ('create_or_confirm_workspace', 'Create or confirm your workspace',
   'Your business workspace keeps company money separate from personal money.',
   '{"ru":"Создайте или подтвердите рабочее пространство","id":"Buat atau konfirmasi ruang kerja"}',
   '{"ru":"Рабочее пространство компании отделяет деньги бизнеса от личных.","id":"Ruang kerja bisnis memisahkan uang perusahaan dari uang pribadi."}',
   '{}', '/business/settings', 'settings', 'create_workspace', true, false, 20, '{}'),

  ('complete_company_profile', 'Complete your company profile',
   'Add the legal name and basic company details used across reports and documents.',
   '{"ru":"Заполните профиль компании","id":"Lengkapi profil perusahaan"}',
   '{"ru":"Укажите юридическое название и основные данные компании.","id":"Tambahkan nama legal dan detail dasar perusahaan."}',
   '{}', '/business/settings', 'settings', 'complete_company_profile', true, false, 30, '{}'),

  ('ai_accountant_company_setup', 'Set up the AI Accountant',
   'Company type, NPWP, NIB, PKP status and KBLI, so accounting works on real company data.',
   '{"ru":"Настройте AI-бухгалтера","id":"Siapkan AI Accountant"}',
   '{"ru":"Тип компании, NPWP, NIB, статус PKP и KBLI — чтобы учёт опирался на реальные данные.","id":"Jenis perusahaan, NPWP, NIB, status PKP dan KBLI, agar akuntansi memakai data nyata."}',
   '{"en":"Have your company registration documents to hand. This records what your company IS; it does not calculate what you owe.","ru":"Подготовьте регистрационные документы компании. Здесь фиксируются данные о компании, а не расчёт налогов.","id":"Siapkan dokumen pendaftaran perusahaan. Ini mencatat data perusahaan, bukan menghitung pajak."}',
   '/business/ai-accountant', 'ai_accountant', 'complete_tax_profile', true, false, 40,
   '{"fields":["company_type","npwp","nib","pkp_status","kbli","tax_scheme"],"accountant_review_recommended":true,"guidance_only":true}'),

  ('add_first_wallet', 'Add your first account',
   'Add a bank account, cash box or payment gateway so balances have somewhere to live.',
   '{"ru":"Добавьте первый счёт","id":"Tambahkan akun pertama"}',
   '{"ru":"Добавьте банковский счёт, кассу или платёжный шлюз.","id":"Tambahkan rekening bank, kas, atau payment gateway."}',
   '{}', '/business/accounts', 'accounts', 'add_wallet', false, true, 50, '{}'),

  ('upload_first_document', 'Upload your first document',
   'Upload an invoice or receipt so the AI Accountant has something real to read.',
   '{"ru":"Загрузите первый документ","id":"Unggah dokumen pertama"}',
   '{"ru":"Загрузите счёт или чек, чтобы AI-бухгалтеру было с чем работать.","id":"Unggah faktur atau kuitansi sebagai bahan kerja AI Accountant."}',
   '{}', '/business/documents', 'documents', 'upload_document', false, true, 60, '{}'),

  ('view_first_pulse_report', 'See your first Pulse report',
   'Pulse is the daily picture of cash, runway and what needs attention.',
   '{"ru":"Посмотрите первый отчёт Pulse","id":"Lihat laporan Pulse pertama"}',
   '{"ru":"Pulse — ежедневная картина денег, запаса прочности и задач.","id":"Pulse adalah gambaran harian kas, runway, dan hal yang perlu perhatian."}',
   '{}', '/business/pulse', 'pulse', 'view_report', false, true, 70, '{}')
) AS v(step_key, title, description, title_i18n, description_i18n, instructions_i18n,
       page_path, product_area, action_type, required, skippable, sort_order, metadata)
WHERE f.flow_key = 'quick_business_setup'
ON CONFLICT (flow_id, step_key) DO NOTHING;

-- from migrations/054_onboarding_foundation.sql
INSERT INTO onboarding_steps (flow_id, step_key, title, description, title_i18n, description_i18n,
                              page_path, product_area, action_type, required, skippable, sort_order)
SELECT f.id, v.step_key, v.title, v.description, v.title_i18n::jsonb, v.description_i18n::jsonb,
       v.page_path, v.product_area, v.action_type, false, true, v.sort_order
FROM onboarding_flows f CROSS JOIN (VALUES
  ('tour_pulse', 'Pulse', 'Your daily financial picture: cash, runway, burn rate and what changed. Start here each morning.',
   '{"ru":"Pulse","id":"Pulse"}', '{"ru":"Ежедневная картина финансов: деньги, запас прочности, расходы.","id":"Gambaran keuangan harian: kas, runway, dan perubahan."}',
   '/business/pulse', 'pulse', 'visit_page', 10),
  ('tour_radar', 'Radar', 'Risks and deadlines the system spotted for you. Check it when Pulse shows something unusual.',
   '{"ru":"Radar","id":"Radar"}', '{"ru":"Риски и сроки, которые система заметила за вас.","id":"Risiko dan tenggat yang terdeteksi sistem."}',
   '/business/radar', 'radar', 'visit_page', 20),
  ('tour_ai_cfo', 'AI CFO', 'Ask questions about your numbers in plain language and get an explained answer.',
   '{"ru":"AI CFO","id":"AI CFO"}', '{"ru":"Задавайте вопросы о цифрах обычным языком.","id":"Ajukan pertanyaan tentang angka Anda dengan bahasa biasa."}',
   '/business/ai-cfo', 'ai_cfo', 'visit_page', 30),
  ('tour_ai_accountant', 'AI Accountant', 'Company profile, document intake and accounting readiness. Everything it drafts is reviewed by a human.',
   '{"ru":"AI-бухгалтер","id":"AI Accountant"}', '{"ru":"Профиль компании, документы и готовность к отчётности. Всё проверяет человек.","id":"Profil perusahaan, dokumen, dan kesiapan akuntansi. Semua ditinjau manusia."}',
   '/business/accountant', 'ai_accountant', 'open_ai_accountant', 40),
  ('tour_transactions', 'Transactions', 'Every movement of money in and out. This is the ledger the reports are built from.',
   '{"ru":"Транзакции","id":"Transaksi"}', '{"ru":"Все движения денег. На этом строятся отчёты.","id":"Semua pergerakan uang. Dasar dari laporan."}',
   '/business/transactions', 'transactions', 'visit_page', 50),
  ('tour_accounts', 'Accounts', 'Your bank accounts, cash boxes, e-wallets and payment gateways, with live balances.',
   '{"ru":"Счета","id":"Akun"}', '{"ru":"Банковские счета, кассы, кошельки и шлюзы с текущими остатками.","id":"Rekening bank, kas, e-wallet, dan gateway dengan saldo terkini."}',
   '/business/accounts', 'accounts', 'visit_page', 60),
  ('tour_invoices', 'Invoices', 'The document layer over what you are owed and what you owe.',
   '{"ru":"Счета на оплату","id":"Faktur"}', '{"ru":"Документы по вашим долгам и долгам перед вами.","id":"Lapisan dokumen untuk piutang dan utang."}',
   '/business/invoices', 'invoices', 'visit_page', 70),
  ('tour_receivables', 'Receivables', 'Money owed to you, with due dates and what is overdue.',
   '{"ru":"Дебиторка","id":"Piutang"}', '{"ru":"Деньги, которые должны вам, со сроками.","id":"Uang yang terutang kepada Anda, dengan jatuh tempo."}',
   '/business/receivables', 'receivables', 'visit_page', 80),
  ('tour_payables', 'Payables', 'Bills you owe. Approve and pay from here so nothing is missed.',
   '{"ru":"Кредиторка","id":"Utang"}', '{"ru":"Ваши счета к оплате. Согласуйте и оплатите здесь.","id":"Tagihan yang harus dibayar. Setujui dan bayar dari sini."}',
   '/business/payables', 'payables', 'visit_page', 90),
  ('tour_funding', 'Funding & Investors', 'Money put into the business by owners or investors, kept separate from revenue.',
   '{"ru":"Финансирование и инвесторы","id":"Pendanaan & Investor"}', '{"ru":"Вложения владельцев и инвесторов отдельно от выручки.","id":"Dana dari pemilik atau investor, terpisah dari pendapatan."}',
   '/business/funding-investors', 'funding', 'visit_page', 100),
  ('tour_bank_import', 'Bank Import', 'Upload a bank statement and review each line before it reaches the ledger.',
   '{"ru":"Импорт банка","id":"Impor Bank"}', '{"ru":"Загрузите выписку и проверьте каждую строку перед учётом.","id":"Unggah rekening koran dan tinjau tiap baris sebelum masuk buku besar."}',
   '/business/bank-import', 'bank_import', 'visit_page', 110),
  ('tour_incoming_payments', 'Incoming Payments', 'Money that actually arrived, from a gateway or a bank, kept as evidence before it becomes revenue.',
   '{"ru":"Входящие платежи","id":"Pembayaran Masuk"}', '{"ru":"Поступившие деньги как доказательство — до признания выручкой.","id":"Uang yang benar-benar masuk, sebagai bukti sebelum jadi pendapatan."}',
   '/business/incoming-payments', 'incoming_payments', 'visit_page', 120),
  ('tour_payment_connections', 'Payment Connections', 'Tell the system which payment providers you receive money through.',
   '{"ru":"Платёжные подключения","id":"Koneksi Pembayaran"}', '{"ru":"Укажите, через каких провайдеров вы принимаете платежи.","id":"Tentukan penyedia pembayaran yang Anda gunakan."}',
   '/business/payment-connections', 'payment_connections', 'connect_payment_provider', 130),
  ('tour_intercompany', 'Intercompany', 'Money moving between your own companies, tracked so it is never mistaken for revenue.',
   '{"ru":"Между компаниями","id":"Antar Perusahaan"}', '{"ru":"Переводы между вашими компаниями — не выручка.","id":"Perpindahan dana antar perusahaan Anda, bukan pendapatan."}',
   '/business/intercompany', 'intercompany', 'visit_page', 140),
  ('tour_payroll', 'Payroll', 'Employees and salary runs, and how they affect cash and obligations.',
   '{"ru":"Зарплата","id":"Penggajian"}', '{"ru":"Сотрудники и выплаты, их влияние на деньги.","id":"Karyawan dan penggajian serta dampaknya pada kas."}',
   '/business/payroll', 'payroll', 'visit_page', 150),
  ('tour_approvals', 'Approvals', 'Things waiting for a decision from you or your CFO.',
   '{"ru":"Согласования","id":"Persetujuan"}', '{"ru":"То, что ждёт вашего решения.","id":"Hal yang menunggu keputusan Anda."}',
   '/business/approvals', 'approvals', 'visit_page', 160),
  ('tour_team', 'Team', 'Invite people and choose what each role can see and do.',
   '{"ru":"Команда","id":"Tim"}', '{"ru":"Приглашайте людей и настраивайте права ролей.","id":"Undang orang dan atur hak setiap peran."}',
   '/business/team', 'team', 'invite_team_member', 170),
  ('tour_documents', 'Documents', 'Invoices, receipts and tax documents, with what the AI read from each.',
   '{"ru":"Документы","id":"Dokumen"}', '{"ru":"Счета, чеки и налоговые документы с распознанными данными.","id":"Faktur, kuitansi, dan dokumen pajak beserta hasil pembacaan AI."}',
   '/business/documents', 'documents', 'review_document', 180),
  ('tour_settings', 'Settings', 'Company details, currency and workspace preferences.',
   '{"ru":"Настройки","id":"Pengaturan"}', '{"ru":"Данные компании, валюта и настройки пространства.","id":"Detail perusahaan, mata uang, dan preferensi ruang kerja."}',
   '/business/settings', 'settings', 'visit_page', 190),
  ('tour_support', 'Support', 'Ask for help without leaving the product.',
   '{"ru":"Поддержка","id":"Dukungan"}', '{"ru":"Задайте вопрос, не выходя из продукта.","id":"Minta bantuan tanpa meninggalkan produk."}',
   '/business/support', 'support', 'open_support', 200)
) AS v(step_key, title, description, title_i18n, description_i18n, page_path, product_area, action_type, sort_order)
WHERE f.flow_key = 'full_business_tour'
ON CONFLICT (flow_id, step_key) DO NOTHING;

-- from migrations/054_onboarding_foundation.sql
INSERT INTO onboarding_steps (flow_id, step_key, title, description, title_i18n, description_i18n,
                              instructions_i18n, page_path, product_area, action_type, required, skippable, sort_order, metadata)
SELECT f.id, v.step_key, v.title, v.description, v.title_i18n::jsonb, v.description_i18n::jsonb,
       v.instructions_i18n::jsonb, '/business/accountant', 'ai_accountant', v.action_type, v.required, v.skippable, v.sort_order, v.metadata::jsonb
FROM onboarding_flows f CROSS JOIN (VALUES
  ('understand_ai_accountant', 'What the AI Accountant does',
   'It reads your documents and drafts accounting entries. A human always reviews before anything is final.',
   '{"ru":"Что делает AI-бухгалтер","id":"Apa yang dilakukan AI Accountant"}',
   '{"ru":"Он читает документы и готовит черновики проводок. Финальное решение — за человеком.","id":"Ia membaca dokumen dan menyusun draf. Manusia selalu meninjau sebelum final."}',
   '{}', 'read', false, true, 10, '{"guidance_only":true}'),

  ('choose_company_type', 'Choose your company type',
   'PT, CV, perorangan or another form. This shapes which fields the rest of setup asks for.',
   '{"ru":"Выберите тип компании","id":"Pilih jenis perusahaan"}',
   '{"ru":"PT, CV, ИП или другая форма — от этого зависят следующие поля.","id":"PT, CV, perorangan atau bentuk lain. Ini menentukan kolom berikutnya."}',
   '{"en":"Use the form on your registration documents, not an informal description.","ru":"Используйте форму из регистрационных документов, а не бытовое описание.","id":"Gunakan bentuk pada dokumen pendaftaran, bukan deskripsi informal."}',
   'complete_company_profile', true, false, 20, '{"field":"company_type"}'),

  ('add_npwp', 'Add your NPWP',
   'Your tax identification number. It appears on tax documents produced from this workspace.',
   '{"ru":"Добавьте NPWP","id":"Tambahkan NPWP"}',
   '{"ru":"Налоговый номер компании. Он используется в налоговых документах.","id":"Nomor pokok wajib pajak. Muncul pada dokumen pajak."}',
   '{"en":"Copy it exactly as printed, including formatting.","ru":"Скопируйте точно как в документе, включая формат.","id":"Salin persis seperti tertulis, termasuk format."}',
   'complete_tax_profile', true, false, 30, '{"field":"npwp","document_needed":"NPWP card"}'),

  ('add_nib', 'Add your NIB',
   'Your business identification number from OSS.',
   '{"ru":"Добавьте NIB","id":"Tambahkan NIB"}',
   '{"ru":"Идентификационный номер бизнеса из OSS.","id":"Nomor Induk Berusaha dari OSS."}',
   '{}', 'complete_company_profile', false, true, 40, '{"field":"nib","document_needed":"NIB certificate"}'),

  ('add_pkp_status', 'Confirm your PKP status',
   'Whether your company is registered as a taxable entrepreneur. Record what your registration says.',
   '{"ru":"Подтвердите статус PKP","id":"Konfirmasi status PKP"}',
   '{"ru":"Зарегистрирована ли компания как PKP. Укажите то, что в регистрации.","id":"Apakah perusahaan terdaftar sebagai PKP. Catat sesuai registrasi."}',
   '{"en":"If you are unsure, ask your accountant before choosing. This records a fact about your registration; it does not decide your obligations.","ru":"Если не уверены — спросите бухгалтера. Здесь фиксируется факт регистрации, а не ваши обязательства.","id":"Jika ragu, tanyakan akuntan Anda. Ini mencatat fakta registrasi, bukan menentukan kewajiban."}',
   'complete_tax_profile', true, false, 50, '{"field":"pkp_status","accountant_review_recommended":true}'),

  ('add_kbli', 'Add your KBLI code',
   'The business activity classification on your registration.',
   '{"ru":"Добавьте код KBLI","id":"Tambahkan kode KBLI"}',
   '{"ru":"Классификация вида деятельности из регистрации.","id":"Klasifikasi bidang usaha pada registrasi Anda."}',
   '{}', 'complete_company_profile', false, true, 60, '{"field":"kbli"}'),

  ('confirm_tax_scheme', 'Confirm your tax scheme',
   'Record the scheme your company operates under, as agreed with your accountant.',
   '{"ru":"Подтвердите налоговый режим","id":"Konfirmasi skema pajak"}',
   '{"ru":"Укажите режим, согласованный с бухгалтером.","id":"Catat skema sesuai kesepakatan dengan akuntan Anda."}',
   '{"en":"This is a record of what your accountant has established, not a determination made here.","ru":"Это запись решения бухгалтера, а не расчёт в системе.","id":"Ini catatan dari akuntan Anda, bukan penentuan oleh sistem."}',
   'complete_tax_profile', true, false, 70, '{"field":"tax_scheme","accountant_review_recommended":true,"guidance_only":true}'),

  ('add_employees_payroll_context', 'Tell us about employees',
   'Whether you run payroll changes which documents and reports matter to you.',
   '{"ru":"Расскажите о сотрудниках","id":"Ceritakan tentang karyawan"}',
   '{"ru":"Наличие зарплаты влияет на нужные документы и отчёты.","id":"Ada tidaknya penggajian memengaruhi dokumen dan laporan."}',
   '{}', 'visit_page', false, true, 80, '{"product_area_hint":"payroll"}'),

  ('upload_company_documents', 'Upload your company documents',
   'Registration documents and tax cards, so they are on file when an accountant needs them.',
   '{"ru":"Загрузите документы компании","id":"Unggah dokumen perusahaan"}',
   '{"ru":"Регистрационные документы и налоговые карточки — чтобы были под рукой.","id":"Dokumen pendaftaran dan kartu pajak agar tersedia saat dibutuhkan."}',
   '{}', 'upload_document', false, true, 90, '{}'),

  ('upload_first_invoice_or_receipt', 'Upload a real invoice or receipt',
   'Give the AI Accountant an actual document to read.',
   '{"ru":"Загрузите реальный счёт или чек","id":"Unggah faktur atau kuitansi nyata"}',
   '{"ru":"Дайте AI-бухгалтеру настоящий документ для разбора.","id":"Beri AI Accountant dokumen nyata untuk dibaca."}',
   '{}', 'upload_document', false, true, 100, '{}'),

  ('review_ai_extraction', 'Review what the AI read',
   'Check the extracted amounts and dates against the document. Correct anything wrong before it is used.',
   '{"ru":"Проверьте распознанные данные","id":"Tinjau hasil pembacaan AI"}',
   '{"ru":"Сверьте суммы и даты с документом и исправьте ошибки.","id":"Cocokkan jumlah dan tanggal dengan dokumen, perbaiki bila salah."}',
   '{"en":"The AI proposes; you confirm. Nothing is treated as final until you accept it.","ru":"AI предлагает — вы подтверждаете. Ничего не считается окончательным без вас.","id":"AI mengusulkan; Anda mengonfirmasi. Tidak ada yang final tanpa persetujuan Anda."}',
   'review_document', true, false, 110, '{"human_review_required":true}'),

  ('check_accounting_readiness', 'Check your accounting readiness',
   'See what is still missing before a period can be handed to an accountant.',
   '{"ru":"Проверьте готовность учёта","id":"Periksa kesiapan akuntansi"}',
   '{"ru":"Посмотрите, чего не хватает для передачи периода бухгалтеру.","id":"Lihat apa yang masih kurang sebelum diserahkan ke akuntan."}',
   '{}', 'view_report', false, true, 120, '{}'),

  ('prepare_for_accountant_review', 'Prepare for accountant review',
   'Gather the period into something your accountant can actually work from.',
   '{"ru":"Подготовьте данные для бухгалтера","id":"Siapkan untuk tinjauan akuntan"}',
   '{"ru":"Соберите период так, чтобы бухгалтер мог с ним работать.","id":"Kumpulkan periode agar akuntan dapat menggunakannya."}',
   '{"en":"A human accountant makes the final call on everything in this flow.","ru":"Окончательное решение по всему в этом сценарии принимает бухгалтер.","id":"Akuntan manusia membuat keputusan akhir atas semua di alur ini."}',
   'view_report', false, true, 130, '{"accountant_review_recommended":true}')
) AS v(step_key, title, description, title_i18n, description_i18n, instructions_i18n,
       action_type, required, skippable, sort_order, metadata)
WHERE f.flow_key = 'ai_accountant_company_setup'
ON CONFLICT (flow_id, step_key) DO NOTHING;

-- from migrations/062_pnl_groups_industry_templates.sql
INSERT INTO public.industry_templates (kbli_prefix, category_name, pnl_group, note, sort_order) VALUES
  ('*', 'Перевод между счетами — поступление', 'transfer', NULL, 1),
  ('*', 'Перевод между счетами — выбытие', 'transfer', NULL, 2),
  ('*', 'Продажи в вендинговых автоматах', 'revenue', NULL, 3),
  ('*', 'Продажи франшизы', 'revenue', NULL, 4),
  ('*', 'Роялти', 'revenue', NULL, 5),
  ('*', 'Паушальный взнос', 'revenue', 'Q5: revenue in the invoice month; spreading over the term waits for the accountant.', 6),
  ('*', 'Реклама DOOH', 'revenue', NULL, 7),
  ('*', 'Прочие поступления', 'other_income', 'Q6: below operating profit.', 8),
  ('*', 'Возвраты от поставщиков', 'direct_cost', 'A refund reduces the cost it refunds.', 9),
  ('*', 'Возвраты клиентам', 'revenue', 'A refund reduces sales; it is not a cost.', 10),
  ('*', 'Закупка товара', 'direct_cost', NULL, 11),
  ('*', 'Транспортные услуги', 'direct_cost', 'Q4.', 12),
  ('*', 'Эквайринг', 'direct_cost', 'Paid per sale.', 13),
  ('*', 'РКО', 'operating_cost', NULL, 14),
  ('*', 'Зарплата производственного персонала', 'direct_cost', 'Q4: field and production staff.', 15),
  ('*', 'Зарплата административного персонала', 'operating_cost', NULL, 16),
  ('*', 'Зарплата коммерческого персонала', 'operating_cost', NULL, 17),
  ('*', 'Налоги на ФОТ', 'operating_cost', 'Q3/Q4: employer BPJS follows the wage it belongs to; field staff use their own direct_cost category.', 18),
  ('*', 'Обучение персонала', 'operating_cost', NULL, 19),
  ('*', 'Расходы на персонал', 'operating_cost', NULL, 20),
  ('*', 'Поиск и найм персонала', 'operating_cost', NULL, 21),
  ('*', 'Командировочные расходы', 'operating_cost', NULL, 22),
  ('*', 'Оплата рекламных систем', 'operating_cost', NULL, 23),
  ('*', 'Маркетинговые подрядчики', 'operating_cost', NULL, 24),
  ('*', 'Административные подрядчики', 'operating_cost', NULL, 25),
  ('*', 'Электронные подписки', 'operating_cost', NULL, 26),
  ('*', 'Связь и интернет', 'operating_cost', NULL, 27),
  ('*', 'Содержание вендинговых автоматов', 'direct_cost', NULL, 28),
  ('*', 'Аренда торговых точек', 'direct_cost', 'Q4: machine locations.', 29),
  ('*', 'Аренда техники', 'direct_cost', 'Q4: job equipment.', 30),
  ('*', 'Содержание офиса', 'operating_cost', NULL, 31),
  ('*', 'Хоз. инвентарь', 'operating_cost', 'Q4: cleaning chemicals used on jobs belong in a direct_cost category.', 32),
  ('*', 'Аренда офиса', 'operating_cost', NULL, 33),
  ('*', 'Ремонт и содержание офиса', 'operating_cost', NULL, 34),
  ('*', 'Оргтехника', 'operating_cost', 'Q2: one item over Rp 5,000,000 lasting more than a year is asset_purchase; the accountant confirms.', 35),
  ('*', 'Покупка наличности', 'transfer', 'Cash moves to the cash box; nothing is spent.', 36),
  ('*', 'Выплата франчайзи', 'direct_cost', NULL, 37),
  ('*', 'Продажа ОС', 'asset_purchase', 'Q7: the sale price reduces asset_purchase; the accountant works out the gain or loss.', 38),
  ('*', 'Возврат кредитов и займов', 'funding', NULL, 39),
  ('*', 'Прочие инвестиционные доходы', 'other_income', 'Q6.', 40),
  ('*', 'Покупка ОС', 'asset_purchase', NULL, 41),
  ('*', 'Ремонт ОС', 'operating_cost', 'Q2: a repair that does not extend the asset''s life.', 42),
  ('*', 'Получение кредитов и займов', 'funding', NULL, 43),
  ('*', 'Вклад собственника', 'funding', 'Never linked to Personal until the bridge is approved.', 44),
  ('*', 'Оплаты по кредитам и займам', 'funding', 'Q1: principal only; interest goes to a Loan interest category.', 45),
  ('*', 'Дивиденды', 'funding', NULL, 46),
  ('*', 'Loan interest', 'interest', 'Q1: only interest on loans the company owes; below EBITDA.', 47),
  ('*', 'Deposit and account interest', 'other_income', 'Clarification 2: shown net of the bank''s final tax.', 48),
  ('*', 'Corporate income tax (PPh 25/29)', 'tax', 'Q3: the company''s own tax only.', 49),
  ('*', 'Turnover tax (UMKM final)', 'tax', 'Clarification 3: labelled Turnover tax (0.5%) when the tax profile is UMKM final.', 50),
  ('81210', 'Cleaning service income', 'revenue', NULL, 100),
  ('81210', 'Cleaning supplies used on jobs', 'direct_cost', 'Chemicals, cloths, bags.', 101),
  ('81210', 'Subcontracted cleaners', 'direct_cost', NULL, 102),
  ('81210', 'Transport to client sites', 'direct_cost', NULL, 103),
  ('81210', 'Uniforms and safety equipment', 'direct_cost', NULL, 104),
  ('81210', 'Wages: field cleaners', 'direct_cost', 'Q4.', 105),
  ('81210', 'Payroll taxes and BPJS: field cleaners', 'direct_cost', 'Q4.', 106),
  ('81210', 'Cleaning machines', 'asset_purchase', 'Q2 threshold applies.', 107),
  ('81210', 'Machine servicing and spare parts', 'operating_cost', NULL, 108),
  ('47999', 'Vending sales (cash)', 'revenue', NULL, 200),
  ('47999', 'Vending sales (QRIS / card)', 'revenue', NULL, 201),
  ('47999', 'Stock for machines', 'direct_cost', NULL, 202),
  ('47999', 'Cash collection and machine refilling', 'direct_cost', NULL, 203),
  ('47999', 'Site rent and revenue share', 'direct_cost', 'Q4.', 204),
  ('47999', 'Gateway and QRIS fees', 'direct_cost', NULL, 205),
  ('47999', 'Vending machines', 'asset_purchase', 'Q2 threshold applies.', 206),
  ('47999', 'Machine repairs and parts', 'operating_cost', NULL, 207)
ON CONFLICT (kbli_prefix, category_name) DO NOTHING;
COMMIT;
