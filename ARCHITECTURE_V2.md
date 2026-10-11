# HELM FINANCE — ARCHITECTURE V2

**Дата:** 2026-06-09  
**Статус:** DESIGN — ожидает одобрения перед реализацией  
**Зависит от:** [PRODUCT_DIRECTION_V2.md](PRODUCT_DIRECTION_V2.md)  

Этот документ описывает целевую архитектуру системы после принятия решения о multi-business и внедрения AI CFO Engine. Никакой код не пишется до одобрения.

---

## Оглавление

1. Database Schema V2
2. Migration: user_id → business_id
3. Business Switching Model
4. API Architecture V2
5. CFO Context Engine
6. Runway Calculation Model
7. AI CFO Architecture
8. AI Chat Architecture
9. Desktop Navigation Architecture
10. Migration Risk Assessment

---

## 1. Database Schema V2

### Принцип организации данных

```
User (Telegram identity)
  └── owns many Businesses
        └── Business has all financial data
              ├── Transactions
              ├── Reminders
              ├── Debts
              ├── Invoices
              └── Payroll entries
```

Данные никогда не смешиваются между бизнесами. User — это только ключ аутентификации и связь с бизнесами.

---

### Table: `users` (без изменений)

```sql
-- Существующая таблица, не трогаем
CREATE TABLE users (
  id          BIGINT PRIMARY KEY,  -- Telegram user ID
  telegram_id BIGINT UNIQUE,
  first_name  TEXT,
  last_name   TEXT,
  username    TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

---

### Table: `businesses` (НОВАЯ)

```sql
CREATE TABLE businesses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     BIGINT NOT NULL REFERENCES users(id),
  name         TEXT NOT NULL,
  description  TEXT,
  
  -- Финансовые настройки
  primary_currency  TEXT NOT NULL DEFAULT 'IDR',
  fiscal_year_start INT NOT NULL DEFAULT 1,   -- месяц (1 = январь)
  timezone          TEXT NOT NULL DEFAULT 'Asia/Makassar',
  
  -- Display
  color        TEXT,    -- hex, для визуального различия в switcher
  emoji        TEXT,    -- '🏥' для Helm Care, '🤖' для AI Jetstone
  
  -- Состояние
  is_active    BOOLEAN NOT NULL DEFAULT true,
  is_archived  BOOLEAN NOT NULL DEFAULT false,
  
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX businesses_owner_id_idx ON businesses(owner_id);
```

---

### Table: `business_members` (НОВАЯ — для будущего Team features)

```sql
-- Заготовка для совместной работы. В V2 используется только для owner.
-- Позволяет добавлять accountants, team members в будущем без изменения схемы.
CREATE TABLE business_members (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id      BIGINT NOT NULL REFERENCES users(id),
  role         TEXT NOT NULL DEFAULT 'owner'
                 CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  invited_by   BIGINT REFERENCES users(id),
  joined_at    TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(business_id, user_id)
);

CREATE INDEX business_members_user_id_idx ON business_members(user_id);
CREATE INDEX business_members_business_id_idx ON business_members(business_id);
```

---

### Table: `transactions` (ИЗМЕНЕНИЕ — добавляем business_id)

```sql
-- Текущие колонки сохраняются. Добавляем business_id.
-- user_id сохраняется (кто создал) для аудита.

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id);

-- После backfill:
-- ALTER TABLE transactions ALTER COLUMN business_id SET NOT NULL;

CREATE INDEX transactions_business_id_idx ON transactions(business_id);
```

Все новые запросы используют `business_id`. `user_id` сохраняется как `created_by` для аудита.

---

### Table: `reminders` (ИЗМЕНЕНИЕ — добавляем business_id)

```sql
ALTER TABLE reminders
  ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id);

CREATE INDEX reminders_business_id_idx ON reminders(business_id);
```

---

### Table: `debts` (ИЗМЕНЕНИЕ — добавляем business_id)

```sql
ALTER TABLE debts
  ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id);

CREATE INDEX debts_business_id_idx ON debts(business_id);
```

---

### Table: `invoices` (НОВАЯ — из INVOICES_MODULE_SPEC.md + business_id)

```sql
CREATE TABLE invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID NOT NULL REFERENCES businesses(id),
  created_by      BIGINT NOT NULL REFERENCES users(id),
  
  type            TEXT NOT NULL CHECK (type IN ('receivable', 'payable')),
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('draft', 'pending', 'overdue', 'paid', 'cancelled')),
  invoice_number  TEXT,
  
  counterparty    TEXT NOT NULL,
  
  amount          NUMERIC NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'IDR',
  amount_idr      NUMERIC,
  
  issued_date     DATE,
  due_date        DATE,
  paid_date       DATE,
  
  description     TEXT,
  notes           TEXT,
  
  transaction_id  UUID,     -- ссылка на транзакцию при оплате
  reminder_id     UUID REFERENCES reminders(id),
  
  source_channel  TEXT DEFAULT 'web'
                    CHECK (source_channel IN ('web', 'telegram')),
  
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX invoices_business_id_idx ON invoices(business_id);
CREATE INDEX invoices_status_idx ON invoices(status);
CREATE INDEX invoices_due_date_idx ON invoices(due_date);
CREATE INDEX invoices_type_idx ON invoices(type);
```

---

### Table: `payroll_entries` (НОВАЯ — P3)

```sql
CREATE TABLE payroll_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID NOT NULL REFERENCES businesses(id),
  created_by      BIGINT NOT NULL REFERENCES users(id),
  
  -- Получатель
  name            TEXT NOT NULL,         -- имя сотрудника / подрядчика
  role            TEXT,                  -- должность
  type            TEXT NOT NULL DEFAULT 'employee'
                    CHECK (type IN ('employee', 'contractor', 'freelancer')),
  
  -- Выплата
  amount          NUMERIC NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'IDR',
  amount_idr      NUMERIC,
  
  -- Расписание
  frequency       TEXT NOT NULL DEFAULT 'monthly'
                    CHECK (frequency IN ('monthly', 'biweekly', 'weekly', 'one_time')),
  next_payment_date DATE NOT NULL,
  
  -- Состояние
  is_active       BOOLEAN NOT NULL DEFAULT true,
  
  -- Связь с транзакцией при выплате
  last_transaction_id UUID,
  
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX payroll_entries_business_id_idx ON payroll_entries(business_id);
CREATE INDEX payroll_entries_next_payment_date_idx ON payroll_entries(next_payment_date);
```

---

### Table: `cfo_snapshots` (НОВАЯ — кэш AI анализа)

```sql
-- Кэшированные AI рекомендации. Пересчитываются при изменении данных
-- или по TTL (5 минут). Предотвращают повторные вызовы Anthropic API.

CREATE TABLE cfo_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES businesses(id) UNIQUE,
  
  -- Финансовый snapshot (JSON)
  financial_data JSONB NOT NULL,   -- raw numbers для расчёта
  
  -- AI output (JSON)
  analysis      TEXT,              -- текст анализа
  recommendations JSONB,          -- массив action items
  runway_days   INT,               -- посчитанный runway
  risk_level    TEXT CHECK (risk_level IN ('healthy', 'attention', 'critical')),
  
  -- TTL
  generated_at  TIMESTAMPTZ DEFAULT now(),
  expires_at    TIMESTAMPTZ DEFAULT (now() + interval '5 minutes'),
  
  -- Метаданные запроса
  model_used    TEXT,
  prompt_tokens INT,
  
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX cfo_snapshots_business_id_idx ON cfo_snapshots(business_id);
CREATE INDEX cfo_snapshots_expires_at_idx ON cfo_snapshots(expires_at);
```

---

## 2. Migration: user_id → business_id

### Стратегия

Миграция выполняется в 4 шага (additive first, never destructive):

```
Шаг 1: Создать таблицы businesses, business_members
Шаг 2: Создать default business для каждого существующего пользователя
Шаг 3: Backfill business_id во всех таблицах данных
Шаг 4: Сделать business_id NOT NULL (после проверки)
Шаг 5 (deferred): Убрать user_id из запросов (оставить колонку как audit field)
```

### SQL миграции (migration 003)

```sql
-- === migrations/003_multi_business.sql ===

-- 1. Создаём таблицу бизнесов
CREATE TABLE IF NOT EXISTS businesses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          BIGINT NOT NULL REFERENCES users(id),
  name              TEXT NOT NULL,
  description       TEXT,
  primary_currency  TEXT NOT NULL DEFAULT 'IDR',
  fiscal_year_start INT NOT NULL DEFAULT 1,
  timezone          TEXT NOT NULL DEFAULT 'Asia/Makassar',
  color             TEXT,
  emoji             TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  is_archived       BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS businesses_owner_id_idx ON businesses(owner_id);

-- 2. Создаём таблицу участников бизнеса
CREATE TABLE IF NOT EXISTS business_members (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id      BIGINT NOT NULL REFERENCES users(id),
  role         TEXT NOT NULL DEFAULT 'owner'
                 CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  invited_by   BIGINT REFERENCES users(id),
  joined_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(business_id, user_id)
);

CREATE INDEX IF NOT EXISTS business_members_user_id_idx ON business_members(user_id);

-- 3. Создаём default business для каждого существующего пользователя
INSERT INTO businesses (owner_id, name, primary_currency, emoji)
SELECT 
  id,
  COALESCE(first_name || '''s Business', 'My Business'),
  'IDR',
  '🏢'
FROM users
ON CONFLICT DO NOTHING;

-- 4. Добавляем owner как member
INSERT INTO business_members (business_id, user_id, role)
SELECT b.id, b.owner_id, 'owner'
FROM businesses b
ON CONFLICT DO NOTHING;

-- 5. Добавляем business_id в таблицы данных (nullable пока)
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id);

ALTER TABLE reminders
  ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id);

ALTER TABLE debts
  ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id);

-- 6. Backfill: связываем существующие записи с default business пользователя
UPDATE transactions t
SET business_id = b.id
FROM businesses b
WHERE b.owner_id = t.user_id
  AND t.business_id IS NULL;

UPDATE reminders r
SET business_id = b.id
FROM businesses b
WHERE b.owner_id = r.user_id
  AND r.business_id IS NULL;

UPDATE debts d
SET business_id = b.id
FROM businesses b
WHERE b.owner_id = d.user_id
  AND d.business_id IS NULL;

-- 7. Индексы
CREATE INDEX IF NOT EXISTS transactions_business_id_idx ON transactions(business_id);
CREATE INDEX IF NOT EXISTS reminders_business_id_idx ON reminders(business_id);
CREATE INDEX IF NOT EXISTS debts_business_id_idx ON debts(business_id);

-- 8. NOT NULL constraint добавляется ОТДЕЛЬНО после проверки данных
-- НЕ включать в эту миграцию — выполнить вручную после верификации:
-- ALTER TABLE transactions ALTER COLUMN business_id SET NOT NULL;
-- ALTER TABLE reminders    ALTER COLUMN business_id SET NOT NULL;
-- ALTER TABLE debts        ALTER COLUMN business_id SET NOT NULL;
```

---

## 3. Business Switching Model

### Сессия пользователя

JWT токен хранит:
```json
{
  "userId": 1057134807,
  "currentBusinessId": "uuid-of-active-business",
  "iat": ...,
  "exp": ...
}
```

При переключении бизнеса: новый JWT выдаётся с новым `currentBusinessId`. Или: `currentBusinessId` хранится в localStorage и передаётся как заголовок `X-Business-Id`.

**Рекомендация:** `X-Business-Id` header. Это не требует перевыпуска JWT при каждом переключении и упрощает multi-business запросы.

### API middleware

```javascript
// middleware/businessContext.js
async function businessContext(req, res, next) {
  const businessId = req.headers['x-business-id'];
  
  if (!businessId) {
    return res.status(400).json({ error: 'X-Business-Id header required' });
  }
  
  // Проверяем, что user является членом этого бизнеса
  const { data, error } = await supabase
    .from('business_members')
    .select('role')
    .eq('business_id', businessId)
    .eq('user_id', req.user.userId)
    .single();
  
  if (error || !data) {
    return res.status(403).json({ error: 'Access denied to this business' });
  }
  
  req.businessId = businessId;
  req.businessRole = data.role;
  next();
}
```

### Business Switcher UI (sidebar)

```
┌──────────────────────────────┐
│ ⬡ HELM FINANCE               │
│ ─────────────────────────── │
│ 🏥 Helm Care          ▾      │  ← текущий бизнес
│ ─────────────────────────── │
│   🤖 AI Jetstone             │  ← dropdown
│   🏪 Marketplace             │
│   + Add business             │
└──────────────────────────────┘
```

Выбор бизнеса → обновляет `X-Business-Id` → перезапрашивает все данные.

---

## 4. API Architecture V2

### Принципы

1. Все финансовые endpoints требуют `auth` + `businessContext` middleware
2. Telegram Bot использует `business_id` из профиля пользователя (default или selected)
3. Нет публичных endpoints кроме `/api/auth/*`

### Endpoint map

```
AUTH
  POST /api/auth/telegram              ← login via Telegram widget
  POST /api/auth/refresh               ← refresh JWT

BUSINESSES
  GET  /api/businesses                 ← list user's businesses
  POST /api/businesses                 ← create new business
  GET  /api/businesses/:id             ← get one business
  PATCH /api/businesses/:id            ← update business settings
  GET  /api/businesses/:id/members     ← list members (future)

CFO ENGINE
  GET  /api/cfo/context                ← unified CFO context (snapshot + AI)
  GET  /api/cfo/runway                 ← runway calculation only (fast, no AI)
  POST /api/cfo/chat                   ← AI Chat message

TRANSACTIONS
  GET  /api/transactions               ← list with filters
  POST /api/parse                      ← parse text → transactions preview
  POST /api/transactions/batch         ← save parsed transactions
  PATCH /api/transactions/:id          ← edit single transaction
  DELETE /api/transactions/:id         ← delete transaction

ACCOUNTS (virtual)
  GET  /api/accounts                   ← virtual accounts from sources
  POST /api/accounts/adjust            ← balance adjustment transaction

INVOICES
  GET  /api/invoices                   ← list with filters
  POST /api/invoices                   ← create invoice
  GET  /api/invoices/:id               ← get single invoice
  PATCH /api/invoices/:id              ← update invoice
  PATCH /api/invoices/:id/pay          ← mark as paid
  DELETE /api/invoices/:id             ← delete (draft only)
  POST /api/invoices/:id/reminder      ← create reminder from invoice

PAYROLL
  GET  /api/payroll                    ← list payroll entries
  POST /api/payroll                    ← create payroll entry
  GET  /api/payroll/:id                ← get single entry
  PATCH /api/payroll/:id               ← update entry
  PATCH /api/payroll/:id/pay           ← record payment
  DELETE /api/payroll/:id              ← delete entry
  GET  /api/payroll/upcoming           ← upcoming payments (next 30 days)

REMINDERS
  GET  /api/reminders                  ← list reminders
  POST /api/reminders                  ← create reminder
  PATCH /api/reminders/:id/done        ← mark done
  PATCH /api/reminders/:id/snooze      ← snooze (already built)

DEBTS
  GET  /api/debts                      ← list debts
  POST /api/debts                      ← create debt
  PATCH /api/debts/:id/settle          ← mark settled

PULSE (aggregated, legacy — мигрирует в /cfo/context)
  GET  /api/pulse                      ← current: используется Pulse page
```

---

## 5. CFO Context Engine

### Концепция

CFO Context Engine — единый агрегатор финансового состояния бизнеса. Не просто данные — финансовое состояние + рекомендации.

### Структура ответа `GET /api/cfo/context`

```typescript
interface CFOContext {
  // === ФИНАНСОВАЯ ПОЗИЦИЯ ===
  cash: {
    total_idr: number;          // сумма всех счетов
    by_account: Account[];      // разбивка по источникам
    as_of: string;              // timestamp расчёта
  };
  
  // === RUNWAY ===
  runway: {
    days: number;               // основной показатель
    days_adjusted: number;      // с учётом receivables/payables/payroll
    burn_rate_daily: number;    // IDR/день, средняя за 30 дней
    burn_rate_monthly: number;
    cash_out_date: string;      // ISO date, когда закончится кэш
    cash_out_date_adjusted: string;
    risk_level: 'healthy' | 'attention' | 'critical';
    // healthy: > 60 дней
    // attention: 14–60 дней  
    // critical: < 14 дней
  };
  
  // === ЭТОТ МЕСЯЦ ===
  this_month: {
    income: number;
    expenses: number;
    net: number;
    vs_last_month: {
      income_delta_pct: number;
      expenses_delta_pct: number;
    };
  };
  
  // === ДЕБИТОРКА (RECEIVABLES) ===
  receivables: {
    total: number;              // сумма всех открытых receivable invoices
    overdue: number;            // просроченные
    due_this_week: number;      // до конца недели
    count: number;
    count_overdue: number;
    items: Invoice[];           // топ 3 по сумме
  };
  
  // === КРЕДИТОРКА (PAYABLES) ===
  payables: {
    total: number;
    overdue: number;
    due_this_week: number;
    count: number;
    count_overdue: number;
    items: Invoice[];
  };
  
  // === PAYROLL ===
  payroll: {
    total_monthly: number;      // общий ежемесячный payroll
    next_payment_date: string;
    next_payment_amount: number;
    upcoming_30d: number;       // выплаты в следующие 30 дней
    entries_count: number;
  };
  
  // === AI CFO ===
  ai: {
    analysis: string;           // текст, 2–4 предложения
    risk_summary: string;       // одно предложение о главном риске
    recommendations: Recommendation[];
    generated_at: string;
    is_cached: boolean;
  };
  
  // === СЕГОДНЯ ===
  today_focus: TodayFocusItem[];
}

interface Recommendation {
  id: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  type: 'collect_receivable' | 'pay_invoice' | 'issue_invoice' | 
        'prepare_payroll' | 'warning' | 'opportunity';
  title: string;               // "Собрать дебиторку"
  description: string;         // "Helm Care должен Rp 5M, просрочено 3 дня"
  amount?: number;
  currency?: string;
  due_date?: string;
  action_label?: string;       // "Открыть инвойс"
  action_url?: string;         // "/invoices/uuid"
}

interface TodayFocusItem {
  id: string;
  type: 'reminder' | 'invoice_due' | 'invoice_overdue' | 'payroll' | 'debt';
  priority: 'critical' | 'high' | 'normal';
  title: string;
  subtitle: string;
  amount?: number;
  due_date?: string;
  is_overdue: boolean;
  actions: Action[];
}
```

### Логика генерации `today_focus`

```
today_focus = [
  ...reminders где due_date <= сегодня И snoozed_until < сегодня (или null),
  ...invoices где type='payable' И due_date <= сегодня+3 И status='pending',
  ...invoices где type='receivable' И status='overdue',
  ...payroll где next_payment_date <= сегодня+5,
  ...debts где due_date <= сегодня+3 И is_settled=false
]
.sort(by priority: overdue first, then by due_date asc)
.slice(0, 10)  // максимум 10 items
```

---

## 6. Runway Calculation Model

### Формулы

```
БАЗОВЫЙ RUNWAY (текущий кэш / burn rate):
runway_basic = cash_total / daily_burn_rate

СКОРРЕКТИРОВАННЫЙ RUNWAY (более точный):
runway_adjusted = (
  cash_total
  + expected_receivables_30d     // receivable invoices due в 30 дней
  - expected_payables_30d        // payable invoices due в 30 дней
  - expected_payroll_30d         // payroll выплаты в 30 дней
) / daily_burn_rate

DAILY BURN RATE:
daily_burn_rate = total_expenses_last_30d / 30
(только expense транзакции, исключая opening balance и adjustments)

RISK LEVELS:
runway_adjusted >= 60 дней  → 'healthy'   (зелёный)
runway_adjusted 14–59 дней  → 'attention' (янтарный)
runway_adjusted < 14 дней   → 'critical'  (красный)
```

### Server-side implementation

```javascript
// services/runwayService.js

async function calculateRunway(businessId) {
  const now = new Date();
  const thirtyDaysAgo = new Date(now - 30 * 86400000);
  const thirtyDaysAhead = new Date(now.getTime() + 30 * 86400000);

  // 1. Текущий кэш (сумма всех транзакций)
  const { data: txAll } = await supabase
    .from('transactions')
    .select('type, amount_idr')
    .eq('business_id', businessId)
    .not('type', 'eq', 'adjustment'); // исключаем корректировки

  const cashTotal = txAll.reduce((sum, t) =>
    sum + (t.type === 'income' ? +t.amount_idr : -t.amount_idr), 0
  );

  // 2. Burn rate (расходы за последние 30 дней)
  const { data: txLast30 } = await supabase
    .from('transactions')
    .select('type, amount_idr')
    .eq('business_id', businessId)
    .eq('type', 'expense')
    .gte('created_at', thirtyDaysAgo.toISOString());

  const totalExpenses30d = txLast30.reduce((sum, t) => sum + +t.amount_idr, 0);
  const dailyBurnRate = totalExpenses30d / 30;

  // 3. Ожидаемые поступления (receivables due в 30 дней)
  const { data: receivables } = await supabase
    .from('invoices')
    .select('amount_idr')
    .eq('business_id', businessId)
    .eq('type', 'receivable')
    .in('status', ['pending', 'overdue'])
    .lte('due_date', thirtyDaysAhead.toISOString().slice(0, 10));

  const expectedReceivables = receivables.reduce((s, i) => s + +i.amount_idr, 0);

  // 4. Ожидаемые выплаты по инвойсам (payables due в 30 дней)
  const { data: payables } = await supabase
    .from('invoices')
    .select('amount_idr')
    .eq('business_id', businessId)
    .eq('type', 'payable')
    .in('status', ['pending', 'overdue'])
    .lte('due_date', thirtyDaysAhead.toISOString().slice(0, 10));

  const expectedPayables = payables.reduce((s, i) => s + +i.amount_idr, 0);

  // 5. Ожидаемый payroll (следующие 30 дней)
  const { data: payrollEntries } = await supabase
    .from('payroll_entries')
    .select('amount_idr')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .lte('next_payment_date', thirtyDaysAhead.toISOString().slice(0, 10));

  const expectedPayroll = payrollEntries.reduce((s, p) => s + +p.amount_idr, 0);

  // 6. Расчёт
  const runwayBasic = dailyBurnRate > 0 ? cashTotal / dailyBurnRate : Infinity;
  const adjustedCash = cashTotal + expectedReceivables - expectedPayables - expectedPayroll;
  const runwayAdjusted = dailyBurnRate > 0 ? adjustedCash / dailyBurnRate : Infinity;

  const riskLevel = runwayAdjusted >= 60 ? 'healthy'
                  : runwayAdjusted >= 14 ? 'attention'
                  : 'critical';

  const cashOutDate = dailyBurnRate > 0
    ? new Date(now.getTime() + runwayBasic * 86400000).toISOString().slice(0, 10)
    : null;

  const cashOutDateAdjusted = dailyBurnRate > 0
    ? new Date(now.getTime() + runwayAdjusted * 86400000).toISOString().slice(0, 10)
    : null;

  return {
    days: Math.max(0, Math.round(runwayBasic)),
    days_adjusted: Math.max(0, Math.round(runwayAdjusted)),
    burn_rate_daily: Math.round(dailyBurnRate),
    burn_rate_monthly: Math.round(dailyBurnRate * 30),
    cash_out_date: cashOutDate,
    cash_out_date_adjusted: cashOutDateAdjusted,
    risk_level: riskLevel,
    components: {
      cash_total: Math.round(cashTotal),
      expected_receivables: Math.round(expectedReceivables),
      expected_payables: Math.round(expectedPayables),
      expected_payroll: Math.round(expectedPayroll),
      adjusted_cash: Math.round(adjustedCash),
    }
  };
}
```

---

## 7. AI CFO Architecture

### Принцип работы

AI CFO — это слой интерпретации над финансовыми данными. Он не хранит состояние. Он получает snapshot финансов и генерирует текстовый анализ + structured recommendations.

### Prompt Engineering

```javascript
// services/cfoService.js

function buildCFOPrompt(financialData) {
  const {
    cash, runway, this_month, receivables, payables, payroll
  } = financialData;

  return `You are Helm CFO, a financial advisor for a small business owner.

CURRENT FINANCIAL POSITION (as of today):
- Cash available: ${formatIDR(cash.total_idr)}
- Monthly burn rate: ${formatIDR(runway.burn_rate_monthly)}
- Runway (basic): ${runway.days} days
- Runway (adjusted with receivables/payables/payroll): ${runway.days_adjusted} days
- Risk level: ${runway.risk_level}

THIS MONTH:
- Income: ${formatIDR(this_month.income)}
- Expenses: ${formatIDR(this_month.expenses)}
- Net: ${formatIDR(this_month.net)}

RECEIVABLES (money owed TO business):
- Total open: ${formatIDR(receivables.total)} (${receivables.count} invoices)
- Overdue: ${formatIDR(receivables.overdue)} (${receivables.count_overdue} invoices)
- Top receivables: ${receivables.items.map(i => 
    `${i.counterparty}: ${formatIDR(i.amount_idr)}, due ${i.due_date}`
  ).join('; ')}

PAYABLES (money business owes):
- Total open: ${formatIDR(payables.total)} (${payables.count} invoices)
- Overdue: ${formatIDR(payables.overdue)} (${payables.count_overdue} invoices)

PAYROLL:
- Monthly total: ${formatIDR(payroll.total_monthly)}
- Next payment: ${formatIDR(payroll.next_payment_amount)} on ${payroll.next_payment_date}
- Next 30 days: ${formatIDR(payroll.upcoming_30d)}

TASK:
1. Write a 2–4 sentence analysis in Russian. Be direct and specific. 
   Mention the most important financial issue first.
2. List 2–5 specific recommended actions. Each action must have:
   - type (one of: collect_receivable, pay_invoice, issue_invoice, prepare_payroll, warning, opportunity)
   - title (short, action-oriented, in Russian)
   - description (specific, with counterparty name and amount where relevant)
   - priority (critical/high/medium/low)
   - amount_idr if relevant
   - due_date if relevant

Respond ONLY with JSON:
{
  "analysis": "...",
  "risk_summary": "...",
  "recommendations": [
    {
      "type": "...",
      "priority": "...",
      "title": "...",
      "description": "...",
      "amount_idr": 0,
      "due_date": "YYYY-MM-DD"
    }
  ]
}`;
}
```

### Кэширование AI ответов

```javascript
async function getCFOContext(businessId) {
  // 1. Проверяем кэш
  const { data: cached } = await supabase
    .from('cfo_snapshots')
    .select('*')
    .eq('business_id', businessId)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (cached) {
    return { ...cached.financial_data, ai: { ...cached, is_cached: true } };
  }

  // 2. Считаем финансовые данные
  const financialData = await aggregateFinancialData(businessId);
  
  // 3. Вызываем AI
  const aiResponse = await callAnthropicCFO(financialData);
  
  // 4. Сохраняем в кэш
  await supabase.from('cfo_snapshots').upsert({
    business_id: businessId,
    financial_data: financialData,
    analysis: aiResponse.analysis,
    recommendations: aiResponse.recommendations,
    runway_days: financialData.runway.days_adjusted,
    risk_level: financialData.runway.risk_level,
    generated_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    model_used: 'claude-sonnet-4-6'
  }, { onConflict: 'business_id' });

  return { ...financialData, ai: { ...aiResponse, is_cached: false } };
}
```

---

## 8. AI Chat Architecture

### Endpoint

```
POST /api/cfo/chat
Body: { message: string, conversation_history: Message[] }
Auth: required + businessContext
Returns: { reply: string, actions?: Action[] }
```

### System prompt

```javascript
function buildChatSystemPrompt(businessId, financialContext) {
  return `You are Helm CFO, a personal financial director for a small business.

You have access to the following current financial data for this business:
${JSON.stringify(financialContext, null, 2)}

Answer questions directly and specifically. Always:
- Use exact numbers from the data, not approximations
- Recommend specific actions when relevant
- Answer in the same language the user writes in (Russian or English)
- If asked about data you don't have (e.g. detailed employee list), say so clearly
- Never make up data that isn't in the financial context

If the user asks to DO something (create a transaction, create an invoice),
respond with a structured action in your JSON response using the "actions" field.`;
}
```

### История диалога

История хранится в памяти клиента (не в БД для V2). Передаётся с каждым запросом. Максимум 10 последних сообщений для контекста.

Для V3: опциональное сохранение в таблице `chat_sessions`.

---

## 9. Desktop Navigation Architecture

### React Router structure

```javascript
// App.jsx routes
<Routes>
  <Route path="/login" element={<Login />} />
  
  <Route element={<AppShell />}>  {/* 3-column shell */}
    <Route path="/"              element={<Pulse />} />
    <Route path="/transactions"  element={<Transactions />} />
    <Route path="/accounts"      element={<Accounts />} />
    <Route path="/invoices"      element={<Invoices />} />
    <Route path="/invoices/:id"  element={<InvoiceDetail />} />
    <Route path="/payroll"       element={<Payroll />} />
    <Route path="/radar"         element={<Radar />} />
    <Route path="/cfo"           element={<AIChat />} />
    <Route path="/settings"      element={<Settings />} />
  </Route>
</Routes>
```

### Navigation groups

```javascript
const NAV_GROUPS = [
  {
    label: 'CORE',
    items: [
      { path: '/',             label: 'Pulse',        icon: 'Activity' },
      { path: '/transactions', label: 'Transactions', icon: 'ArrowLeftRight' },
      { path: '/accounts',     label: 'Accounts',     icon: 'Wallet' },
    ]
  },
  {
    label: 'FINANCE',
    items: [
      { path: '/invoices',  label: 'Invoices', icon: 'FileText',  badge: 'overdue_count' },
      { path: '/payroll',   label: 'Payroll',  icon: 'Users',     badge: 'upcoming_count' },
    ]
  },
  {
    label: 'INTELLIGENCE',
    items: [
      { path: '/radar', label: 'Radar',  icon: 'ScanLine' },
      { path: '/cfo',   label: 'AI CFO', icon: 'Sparkles', highlight: true },
    ]
  }
];
```

### Business Context в React

```javascript
// context/BusinessContext.jsx
const BusinessContext = createContext();

function BusinessProvider({ children }) {
  const [businesses, setBusinesses] = useState([]);
  const [currentBusiness, setCurrentBusiness] = useState(null);

  // Загружаем из localStorage при старте
  // Обновляем X-Business-Id header при переключении
  
  const switchBusiness = useCallback((businessId) => {
    const business = businesses.find(b => b.id === businessId);
    setCurrentBusiness(business);
    localStorage.setItem('helm_current_business', businessId);
    // Все API запросы после этого будут с новым businessId
  }, [businesses]);

  return (
    <BusinessContext.Provider value={{ businesses, currentBusiness, switchBusiness }}>
      {children}
    </BusinessContext.Provider>
  );
}
```

---

## 10. Migration Risk Assessment

### user_id → business_id: оценка объёма и рисков

#### Объём изменений

| Категория | Файлы / таблицы | Оценка сложности |
|-----------|-----------------|-----------------|
| Supabase schema | 3 таблицы (transactions, reminders, debts) + 2 новые | MEDIUM |
| Backfill данных | 14 транзакций, 0 reminders, 1 debt — у 1 пользователя | LOW (малый объём) |
| server/index.js | ~15 endpoint'ов: добавить businessContext middleware | MEDIUM |
| client: Auth context | 1 файл, добавить BusinessContext | MEDIUM |
| client: API calls | Все fetch/supabase вызовы добавить X-Business-Id | MEDIUM |
| Telegram Bot | 3 файла: добавить default business_id в запросы | LOW |

**Итого: ~3–4 дня разработки** для полной миграции при текущем объёме данных.

#### Риски

| Риск | Вероятность | Влияние | Митигация |
|------|-------------|---------|-----------|
| Данные не смапятся (backfill ошибка) | НИЗКАЯ | ВЫСОКОЕ | Проверить количество строк до и после миграции |
| Забыли обновить endpoint | СРЕДНЯЯ | ВЫСОКОЕ | Создать тест-чеклист всех API путей |
| Bot не получает правильный business_id | СРЕДНЯЯ | ВЫСОКОЕ | Хранить `default_business_id` в users таблице |
| Существующие JWT не содержат businessId | ВЫСОКАЯ | НИЗКОЕ | Header X-Business-Id, а не JWT payload |
| RLS политики Supabase ломаются | СРЕДНЯЯ | ВЫСОКОЕ | Тестировать RLS после добавления business_id |
| Дублирование данных при ошибке backfill | НИЗКАЯ | ВЫСОКОЕ | ON CONFLICT DO NOTHING в INSERT |

#### Можно ли выполнить без потери данных?

**Да.** При условии:

1. Шаги 1–6 (CREATE + backfill) — additive, безопасны
2. Шаг 8 (NOT NULL constraint) — выполняется только после верификации
3. Обратная совместимость: API принимает `user_id` ещё 1 версию после миграции
4. Rollback план: если что-то сломалось на шагах 1–6 — просто удаляем добавленные колонки и таблицы

#### Что меняется в API

| Endpoint | Текущий запрос | После миграции |
|----------|---------------|----------------|
| GET /api/pulse | `.eq('user_id', userId)` | `.eq('business_id', businessId)` |
| GET /api/transactions | `.eq('user_id', userId)` | `.eq('business_id', businessId)` |
| POST /api/transactions/batch | `user_id: userId` | `business_id: businessId, created_by: userId` |
| GET /api/reminders | `.eq('user_id', userId)` | `.eq('business_id', businessId)` |
| GET /api/debts | `.eq('user_id', userId)` | `.eq('business_id', businessId)` |
| Все новые endpoints | — | `.eq('business_id', businessId)` |

#### Что меняется в Supabase RLS

Текущие RLS политики: `user_id = auth.uid()` — но мы используем Supabase с service role key (bypasses RLS). Миграция RLS не требуется для current architecture. Замечание: если в будущем перейдём на RLS без service role — политики нужно будет обновить на `business_id in (select business_id from business_members where user_id = auth.uid())`.

#### Рекомендация по порядку действий

```
1. Запустить migration 003 в Supabase Dashboard (additive steps только)
2. Верифицировать backfill (проверить количество строк)
3. Добавить businesses endpoint в server/index.js
4. Добавить BusinessContext в React
5. Обновить все API вызовы (добавить X-Business-Id header)
6. Обновить server middleware (добавить businessContext)
7. Обновить все server queries (user_id → business_id)
8. Тестирование полного цикла
9. Выполнить NOT NULL constraint
10. Обновить Telegram Bot
```

---

## Зависимости между компонентами

```
                    ┌─────────────────┐
                    │   Supabase DB    │
                    │  businesses      │
                    │  transactions    │
                    │  invoices        │
                    │  payroll_entries │
                    │  cfo_snapshots   │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Express Server  │
                    │  businessContext │
                    │  runwayService   │
                    │  cfoService      │
                    └────────┬────────┘
                    ┌────────┴────────┐
          ┌─────────▼──────┐  ┌───────▼────────┐
          │   React Web App │  │  Telegram Bot   │
          │  BusinessContext│  │  default biz_id │
          │  CFO Engine UI  │  │  parse + save   │
          └─────────────────┘  └────────────────┘
```

---

## Следующий шаг

После одобрения этого документа:

1. Выполнить `migrations/003_multi_business.sql` в Supabase Dashboard
2. Начать Desktop V2 реализацию согласно `DESKTOP_V2_PLAN.md`
3. Приоритет реализации: Shell → Design System → Pulse → CFO Context API → Invoices
