-- Migration 054 — Onboarding foundation
--
-- Two onboarding modes: a short QUICK SETUP shown after registration, and a manually
-- launched FULL PRODUCT TOUR that walks the product page by page. A third feature tour
-- covers AI Accountant company setup in detail.
--
-- FOUNDATION ONLY. No guided-tour UI, no AI call, no email, no Telegram. This migration
-- defines the content, records progress, and nothing else.
--
-- NO FINANCIAL EFFECT. Nothing here reads or writes transactions, wallets, debts,
-- incoming_payments, payment connections or credentials. Onboarding describes the product;
-- it never operates it on the user's behalf.
--
-- ⚠ GUIDANCE, NOT ADVICE. Step text explains where things are and what to fill in. It must
-- never state a tax obligation, a rate, a filing duty or a legal conclusion -- that is the
-- deterministic tax engine's job, under human review (D6). The Indonesian terms below
-- (NPWP, NIB, PKP, KBLI) are named so the user knows WHICH field to complete; nothing here
-- interprets them.
--
-- LOCALIZATION-READY, FALLBACK-FIRST. `title`/`description` hold English and remain the
-- compatibility path; the `*_i18n` JSONB columns hold per-locale overrides keyed by locale
-- code. A missing locale falls back to the English column, so a partially translated flow
-- always renders. This is NOT platform-wide i18n -- that is a separate milestone.
--
-- ADDITIVE and IDEMPOTENT. Six tables, indexes, triggers, and seed content guarded by
-- ON CONFLICT DO NOTHING. Re-running does not duplicate or overwrite seeds.

BEGIN;

-- ── 1. Flows ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS onboarding_flows (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_key         TEXT        NOT NULL UNIQUE,
  title            TEXT        NOT NULL,                       -- English fallback
  description      TEXT        NULL,                           -- English fallback
  -- Per-locale overrides: {"ru": "...", "id": "..."}. Absent locale => English column.
  title_i18n       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  description_i18n JSONB       NOT NULL DEFAULT '{}'::jsonb,
  mode             TEXT        NOT NULL CHECK (mode IN ('quick_setup','full_tour','feature_tour')),
  audience         TEXT        NOT NULL DEFAULT 'business_owner'
    CHECK (audience IN ('business_owner','accountant','admin','personal_user','all')),
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  sort_order       INTEGER     NOT NULL DEFAULT 0,
  metadata         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS onboarding_flows_active_idx ON onboarding_flows (is_active, sort_order);
CREATE INDEX IF NOT EXISTS onboarding_flows_mode_idx   ON onboarding_flows (mode);

-- ── 2. Steps ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS onboarding_steps (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id           UUID        NOT NULL REFERENCES onboarding_flows(id) ON DELETE CASCADE,
  step_key          TEXT        NOT NULL,
  title             TEXT        NOT NULL,
  description       TEXT        NULL,
  title_i18n        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  description_i18n  JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- Longer "how to do this" copy, kept separate from description so a short list view and a
  -- detailed panel can draw on different text without one being a truncation of the other.
  instructions_i18n JSONB       NOT NULL DEFAULT '{}'::jsonb,
  page_path         TEXT        NULL,
  target_selector   TEXT        NULL,
  action_type       TEXT        NOT NULL DEFAULT 'read'
    CHECK (action_type IN ('read','visit_page','create_workspace','complete_company_profile',
                           'add_wallet','upload_document','review_document','create_invoice',
                           'create_receivable','create_payable','connect_payment_provider',
                           'invite_team_member','view_report','open_ai_accountant',
                           'complete_tax_profile','open_support','custom')),
  product_area      TEXT        NOT NULL DEFAULT 'general'
    CHECK (product_area IN ('general','pulse','radar','ai_cfo','ai_accountant','transactions',
                            'accounts','invoices','receivables','payables','funding','bank_import',
                            'incoming_payments','payment_connections','intercompany','payroll',
                            'approvals','team','documents','settings','support','admin')),
  required          BOOLEAN     NOT NULL DEFAULT false,
  skippable         BOOLEAN     NOT NULL DEFAULT true,
  sort_order        INTEGER     NOT NULL DEFAULT 0,
  metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (flow_id, step_key)
);
CREATE INDEX IF NOT EXISTS onboarding_steps_flow_idx ON onboarding_steps (flow_id, sort_order);
CREATE INDEX IF NOT EXISTS onboarding_steps_area_idx ON onboarding_steps (product_area);

-- ── 3. Flow progress ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS onboarding_progress (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- NULLABLE: onboarding must work before a workspace exists. Opening onboarding must never
  -- provision a business or start a trial as a side effect.
  business_id      UUID        NULL REFERENCES businesses(id) ON DELETE CASCADE,
  flow_id          UUID        NOT NULL REFERENCES onboarding_flows(id) ON DELETE CASCADE,
  status           TEXT        NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started','in_progress','completed','skipped','dismissed')),
  started_at       TIMESTAMPTZ NULL,
  completed_at     TIMESTAMPTZ NULL,
  dismissed_at     TIMESTAMPTZ NULL,
  current_step_id  UUID        NULL REFERENCES onboarding_steps(id) ON DELETE SET NULL,
  progress_percent NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (progress_percent >= 0 AND progress_percent <= 100),
  metadata         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One progress row per (user, business, flow). Two PARTIAL indexes rather than one plain
-- UNIQUE: Postgres treats NULLs as distinct, so a plain constraint would let a user with no
-- business start the same flow unlimited times.
CREATE UNIQUE INDEX IF NOT EXISTS onboarding_progress_scoped_uidx
  ON onboarding_progress (user_id, business_id, flow_id) WHERE business_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS onboarding_progress_nobiz_uidx
  ON onboarding_progress (user_id, flow_id) WHERE business_id IS NULL;
CREATE INDEX IF NOT EXISTS onboarding_progress_user_idx     ON onboarding_progress (user_id, status);
CREATE INDEX IF NOT EXISTS onboarding_progress_business_idx ON onboarding_progress (business_id, status);

-- ── 4. Step progress ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS onboarding_step_progress (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  progress_id       UUID        NOT NULL REFERENCES onboarding_progress(id) ON DELETE CASCADE,
  step_id           UUID        NOT NULL REFERENCES onboarding_steps(id) ON DELETE CASCADE,
  status            TEXT        NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started','viewed','completed','skipped')),
  first_viewed_at   TIMESTAMPTZ NULL,
  completed_at      TIMESTAMPTZ NULL,
  skipped_at        TIMESTAMPTZ NULL,
  completion_source TEXT        NULL
    CHECK (completion_source IS NULL OR completion_source IN ('user','system','admin','event')),
  metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (progress_id, step_id)
);
CREATE INDEX IF NOT EXISTS onboarding_step_progress_progress_idx
  ON onboarding_step_progress (progress_id, status);

-- ── 5. Events (analytics / audit trail) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS onboarding_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       BIGINT      NULL REFERENCES users(id) ON DELETE SET NULL,
  business_id   UUID        NULL REFERENCES businesses(id) ON DELETE CASCADE,
  flow_id       UUID        NULL REFERENCES onboarding_flows(id) ON DELETE CASCADE,
  step_id       UUID        NULL REFERENCES onboarding_steps(id) ON DELETE CASCADE,
  event_type    TEXT        NOT NULL CHECK (length(trim(event_type)) > 0),
  event_payload JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS onboarding_events_user_idx  ON onboarding_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS onboarding_events_flow_idx  ON onboarding_events (flow_id, event_type);
CREATE INDEX IF NOT EXISTS onboarding_events_created_idx ON onboarding_events (created_at DESC);

-- ── 6. Context snapshots (read-only picture of setup state at onboarding time) ───────────
CREATE TABLE IF NOT EXISTS onboarding_context_snapshots (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id UUID        NULL REFERENCES businesses(id) ON DELETE CASCADE,
  -- ⚠ Counts and booleans only. Never copy financial values, document contents or any
  -- credential into a snapshot: this table exists to answer "was a wallet set up yet?", not
  -- to mirror the business.
  snapshot    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS onboarding_snapshots_user_idx ON onboarding_context_snapshots (user_id, created_at DESC);

-- ── updated_at triggers ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_onboarding_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_onboarding_flows_updated_at ON onboarding_flows;
CREATE TRIGGER trg_onboarding_flows_updated_at BEFORE UPDATE ON onboarding_flows
  FOR EACH ROW EXECUTE FUNCTION fn_onboarding_touch_updated_at();
DROP TRIGGER IF EXISTS trg_onboarding_steps_updated_at ON onboarding_steps;
CREATE TRIGGER trg_onboarding_steps_updated_at BEFORE UPDATE ON onboarding_steps
  FOR EACH ROW EXECUTE FUNCTION fn_onboarding_touch_updated_at();
DROP TRIGGER IF EXISTS trg_onboarding_progress_updated_at ON onboarding_progress;
CREATE TRIGGER trg_onboarding_progress_updated_at BEFORE UPDATE ON onboarding_progress
  FOR EACH ROW EXECUTE FUNCTION fn_onboarding_touch_updated_at();
DROP TRIGGER IF EXISTS trg_onboarding_step_progress_updated_at ON onboarding_step_progress;
CREATE TRIGGER trg_onboarding_step_progress_updated_at BEFORE UPDATE ON onboarding_step_progress
  FOR EACH ROW EXECUTE FUNCTION fn_onboarding_touch_updated_at();

-- ═════════════════════════════════════════════════════════════════════════════════════════
-- SEED CONTENT
--
-- Guarded by ON CONFLICT DO NOTHING so re-running never duplicates or overwrites. Editing
-- seeded copy later is a content change, not a migration: a future migration or an admin
-- tool should UPDATE, because this file will not re-apply over existing rows.
--
-- ru/id translations are provided for flow titles and the highest-traffic steps. Untranslated
-- steps fall back to English, which is the whole point of the fallback-first model.
-- ═════════════════════════════════════════════════════════════════════════════════════════

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

-- ── A. quick_business_setup ──────────────────────────────────────────────────────────────
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

-- ── B. full_business_tour — one step per product area ────────────────────────────────────
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

-- ── C. ai_accountant_company_setup ───────────────────────────────────────────────────────
-- ⚠ Guidance only. Each step says WHICH field to complete and WHY it is asked for. None of
-- this states a tax obligation, a rate or a filing duty.
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

COMMIT;

-- ── Verification ──────────────────────────────────────────────────────────────────────────
SELECT f.flow_key, f.mode, count(s.id) AS steps
FROM onboarding_flows f LEFT JOIN onboarding_steps s ON s.flow_id = f.id
GROUP BY f.flow_key, f.mode ORDER BY f.flow_key;
