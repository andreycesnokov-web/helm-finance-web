# CFO AI — Financial Template Learning Map
## Helm Care Excel Spreadsheet Architecture Analysis

> **Purpose:** Document the financial logic, data structures, and business model encoded in Helm Care's existing Excel templates so that CFO AI can be extended to support the same workflows natively.
>
> **Scope:** Documentation and architecture mapping only. No code, no migrations, no backend changes.
>
> **Source files analysed:**
> - `Платежный календарь Helm-Care.xlsx` (Payment Calendar)
> - `HELM CARE P&L.xlsx` (Quarterly P&L Model)
> - `ДДС — Helm-Care 2026.xlsx` (Actual Cash Flow Statement — DDS)
>
> **Last updated:** 2026-06-10

---

## 1. Executive Summary

Helm Care operates a **vending-machine franchise network** in Indonesia — helmet-washing kiosks combined with DOOH (Digital Out-of-Home) advertising screens. The company is Indonesian-based, reports in both **IDR and USD** (converted at ~16,650 IDR/USD), spans **4 legal entities**, and is in an active growth phase (2026 onward).

Three financial templates currently exist outside CFO AI:

| Template | Purpose | Time granularity | Status |
|---|---|---|---|
| Платежный календарь | Cash flow planning & actual tracking | Daily / Weekly | Active (Jun 2026 data) |
| P&L Квартальный | Long-range revenue and profit model | Quarterly (2026–2031) | Projection model |
| ДДС — Helm-Care 2026 | Actual cash flow statement (multi-wallet, multi-entity, multi-currency) | Daily transactions → monthly summary | Active (Jan–May 2026 actual data) |

**Key insight:** CFO AI already handles ad-hoc transaction entry and basic reporting. These spreadsheets represent the *planning layer* (Payment Calendar), the *strategic layer* (P&L), and the *operational accounting layer* (DDS). The DDS file is the most structurally complete and closest to what CFO AI needs to become — it defines wallets, business directions, activity types, a 46-article category taxonomy, a counterparty model, transfer-pair logic, monthly closing rules, and multi-entity consolidation.

---

## 2. Payment Calendar Analysis (`Платежный календарь Helm-Care.xlsx`)

### 2.1 Sheet: `Платежный календарь простой` (Simple Daily Cash Calendar)

**Structure:** Rows = line items (expense/income categories). Columns = calendar dates (one column per day, monthly span).

**Row taxonomy:**

```
Opening Balance (Остаток на начало дня)
│
├── ↓ OUTFLOWS (Выплаты)
│   ├── A. Cost of Goods / COGS (Себестоимость)
│   │   ├── Production staff wages (Зарплата производственных сотрудников)
│   │   ├── Trimming (Срезка)
│   │   ├── Packaging (Упаковка)
│   │   ├── Cement (Цемент)
│   │   ├── Waste processing (Отработка)
│   │   ├── Pallets (Поддоны)
│   │   └── Aluminium sulphate (Сульфат алюминия)
│   │
│   ├── B. Administrative Expenses (Административные расходы)
│   │   ├── Office/warehouse/production rent (Аренда)
│   │   ├── Utilities (Коммунальные расходы)
│   │   ├── Employee expense reimbursements (Компенсация)
│   │   ├── Logistics (Логистика)
│   │   ├── Recruitment (Найм персонала)
│   │   ├── Equipment repairs (Ремонт оборудования)
│   │   ├── Comms / Internet / Postage / Software (Связь, Интернет, ПО)
│   │   ├── Owner/partner salary (Зарплата собственника/партнеров)
│   │   ├── Miscellaneous admin (Хозяйственные)
│   │   ├── Travel expenses (Командировочные)
│   │   ├── Admin staff salary (Зарплата административного персонала)
│   │   └── Refunds (Возвраты)
│   │
│   ├── C. Commercial / Marketing (Коммерческие/Маркетинговые расходы)
│   │   ├── Sales team salary (Зарплата отдел продаж)
│   │   ├── Online advertising (Реклама в интернете)
│   │   ├── Website maintenance & promotion (Обслуживание сайта)
│   │   └── Other marketing/advertising (Прочие на маркетинг)
│   │
│   ├── D. Taxes (Налоги)
│   │   └── Other budget payments (Прочие в бюджет)
│   │
│   └── E. Non-operating (Прочие доходы и расходы / Внереализационные)
│       ├── Bank service fees — RKO (Услуги банка)
│       └── Loan/credit interest (Проценты по кредитам)
│
├── ↑ INFLOWS (Поступления)
│   ├── From clients (Поступления от клиентов)
│   │   ├── Client 1
│   │   ├── Client 2
│   │   └── Client 3
│   └── Borrowed funds (Заемные средства)
│       ├── Investor 1
│       └── Bank
│
├── Net Daily Change (Изменения за день)
├── Closing Balance (Остаток на конец дня)
│   ├── of which: Cash (наличные)
│   └── of which: Non-cash / Bank (безнал)
```

> **Note:** The August 2017 instance of this sheet was a prior business (mushroom/agriculture — COGS categories: cement, pallets, aluminium sulphate). The *structure and taxonomy* are reusable. The category names for Helm Care's current vending/wash/ad business appear in the `Справочник` reference sheet (2026 data).

---

### 2.2 Sheet: `Платежный календарь` (Full Weekly Calendar)

**Structure:** 62 rows × 138 columns. Columns represent dates grouped by week, with a boolean "plan/fact" toggle per column pair. Row 0 = `Ответственные` (Responsible persons). This sheet powers a more advanced planning view with per-week responsibility assignment.

**Key additions vs. simple sheet:**
- `Ответственные` column — each payment line has an assigned owner
- Binary plan vs. fact marker per date column
- Wider date range covering multiple months

---

### 2.3 Sheet: `Плановые Реестр выбытий` (Planned Outflows Register)

**This is the most operationally current sheet** — contains real June 2026 scheduled payments.

**Schema:**

| Column | Type | Description |
|---|---|---|
| `Контрагент` | string | Counterparty/vendor name |
| `Статья` | string (FK → Справочник) | Expense category |
| `Номер счета` | string | Invoice/account number |
| `Сумма план` | decimal (USD) | Planned amount |
| `Дата планируемой оплаты` | date | Planned payment date |
| `Комментарий` | string | Free-text note |
| `Год план` | integer | Year (derived) |
| `Месяц план` | integer | Month number (derived) |
| `Номер недели план` | integer (FK → Диапазон недель) | ISO week number |

**Sample data — June 2026 Week 23–24:**

| Category | Vendor | Amount (USD) |
|---|---|---|
| IT Services | Miro, Zoom, Zoho CRM, AWS, Google, Hetzner, Biznet, mailgun, Zadarma | 10–484 each |
| Internet | Indosat (59 SIM + 5 SIM) | 297 total |
| Equipment maintenance | Support dept fuel, spare parts, refurbishment | 278–1,643 |
| Transport | Motorcycle service compensation | 111 |
| Salaries | Tech dept (4,722), Commercial dept (14,789), Admin dept (6,226) | 25,737 total |
| Marketing | Meta Ads RU/EN, Telegram ads, business dinner, site production | 500–2,900 each |
| Platform rent | Cocomart, Circle K, Alfamaret, Ke&Me, Ithon, Ary's | 65–6,643 each |
| Outsourcing | Финансист (finance consultant) | 1,000 |
| Franchise payouts | Marina Linkova, Stanislav & Anastasia, Pavel Tatarenkov, 3× Indonesian partners | 65–646 each |

---

### 2.4 Sheet: `Плановый Реестр поступлений` (Planned Inflows Register)

Currently empty (header row only). Intended structure mirrors the outflows register.

> **Gap:** Helm Care has not yet filled this in — income planning is done implicitly via the P&L model.

---

### 2.5 Sheet: `Факт ДДС` (Actual Cash Flow)

**Schema:**

| Column | Type | Description |
|---|---|---|
| `Год` | integer | Year |
| `Мсц (цифрой)` | integer | Month (numeric) |
| `Дата` | date | Transaction date |
| `Сумма` | decimal (USD) | Amount |
| `Контрагент` | string | Counterparty |
| `Назначение платежа` | string | Payment purpose |
| `Статья` | string (FK → Справочник) | Category |
| `Платеж/поступл` | enum | "Платеж" / "Поступление" |

> **Note:** This is a simplified single-currency, single-wallet actual register. The full multi-entity, multi-currency actual register lives in the DDS file (Section 4 of this document).

---

### 2.6 Sheet: `Справочник` (Category Reference)

41 expense/income categories classified as `Поступление` or `Платеж`. Superseded by the more complete 46-article DDS taxonomy in `ДДС статьи`. See Section 4.5 for the full list.

---

### 2.7 Sheet: `Контрагенты` (Counterparties)

Empty (header only): `Контрагенты список` | `Группа`. The Регламент in the DDS file notes that counterparties can be maintained here or in the DDS Справочники column D.

---

### 2.8 Sheet: `Диапазон недель` (Week Ranges)

ISO week number lookup table for 2026: `Номер недели` | `С` (from) | `ПО` (to). 53 weeks, used as FK in registers.

---

## 3. P&L Model Analysis (`HELM CARE P&L.xlsx`)

### 3.1 Sheet: `P&L Квартальный` (Quarterly P&L, 2026–2031)

**Business model** — Helm Care has two revenue streams per machine type:

1. **Helmet washing** — pay-per-use vending (IDR 15,000 / 4 min, IDR 19,000 / 8 min)
2. **DOOH advertising** — digital screens on each machine, sold to advertisers by slot/month

And two ownership models:

1. **Own network** — company-owned machines, 100% revenue capture
2. **Franchise network** — sold to franchisees; company earns: paushalnyi взнос (upfront fee) + royalties + 10% ad revenue share

**P&L structure (sections A–F):**

#### A. Network Scale
| Metric | Q1 2026 | Q2 2026 | Q3 2026 | Q4 2026 |
|---|---|---|---|---|
| New franchise automats sold | 0 | 54 | 62 | 72 |
| Franchise network (cumulative) | 0 | 54 | 117 | 189 |
| New own-network automats | 55 | 663 | 100 | 100 |
| Own network (cumulative) | 55 | 718 | 818 | 918 |
| **Total fleet** | **55** | **772** | **935** | **1,107** |

#### B. Revenue (USD)
| Stream | Q1 2026 | Q2 2026 |
|---|---|---|
| Wash revenue — franchise | 0 | 25,151 |
| Wash revenue — own | 12,635 | 332,366 |
| DOOH ad — franchise (90% rev share) | 0 | 44,362 |
| DOOH ad — own (100%) | 29,700 | 651,370 |
| Paushalnyi взнос (franchise unit sales) | 0 | 203,750 |
| **TOTAL REVENUE** | **42,335** | **1,256,999** |

#### C–F. OPEX → Operating Profit → CAPEX → Net Profit

| Metric | Q1 2026 | Q2 2026 | Cumulative breakeven |
|---|---|---|---|
| Total OPEX | 127,666 | 427,573 | — |
| Operating profit | −85,330 | +825,583 | Q3 2026 |
| Net profit | −236,580 | −1,147,084 | Q3 2026 |
| **Cumulative net profit** | −236,580 | −1,383,665 | **Q3 2026 = +$126K** |

---

### 3.2 Sheet: `Допущения` (Key Model Assumptions)

| Parameter | Value | Notes |
|---|---|---|
| USD/IDR rate | 16,650 | Fixed assumption |
| Avg wash price | IDR 17,000 = $1.02 USD | Blended 4min/8min |
| Annual price inflation | 3% | Per year |
| Max washes/day/machine | 12 | At 100% utilisation |
| Starting washes/day | 2.5 | Q1 2026 |
| Working days/month | 30 | |
| Machine OPEX/month | $125 USD | Rent + utilities + consumables + maintenance |
| Annual OPEX inflation | 5% | |
| DOOH slots/screen | 15 | Max |
| Starting ad utilisation | 15% | Q1 2026 |
| Target ad utilisation | 40% | |
| Social ad price | $80/slot/mo | Gov programs, 25% of slots |
| Standard ad price | $200/slot/mo | Local business, 55% of slots |
| Premium ad price | $350/slot/mo | Brands, 20% of slots |
| Renovation fund | 5%/yr of fleet value | |
| HQ OPEX/month | $35,050 | Team of ~20 (CEO, CFO, COO, Tech, Sales, Ops) |
| Annual HQ cost growth | 10% | |
| Franchise unit price | $3,750 starting | 5% annual increase |
| Franchise packages | Custom (10 units), Starter (51), Master (102) | |
| Indonesia corporate tax | 22% (PPh Badan) | |
| Machine depreciation | 5 years | |
| WACC | 15% | Discount rate |
| Investment round | $2,000,000 for 10% equity | Venture |
| Market: Indonesia vending | $435M (2024), CAGR 16% | |
| Motorcycles in Indonesia | 139.45M registered | Addressable market |

---

## 4. DDS Cash Flow Statement Analysis (`ДДС — Helm-Care 2026.xlsx`)

### 4.1 Overview

This is the most operationally complete financial document. It is an **actual cash flow statement (Отчёт о движении денежных средств)** covering January–May 2026 with data, June–December projected as zero (not yet filled).

**Architecture:**
- **25 sheets total** — 8 named wallet sheets (IDR + USD per entity), 8 numbered month sheets (5–12), 2 consolidated summary sheets, 1 main transaction register, 3 reference/setup sheets, 1 technical sheet, 1 regulation sheet
- **Multi-entity:** 4 legal entities with separate wallets
- **Multi-currency:** IDR and USD tracked in parallel, with exchange rate per transaction
- **Three activity types:** Operational, Investment, Financial (+ Technical transfers)
- **46 categorised articles** with sub-article descriptions

**Legal entities (4 companies):**

| Entity | Currency wallets | Role |
|---|---|---|
| PT Siberian BG | IDR + USD | Primary operating entity |
| Общий (General) | IDR + USD | Shared/general wallet |
| PT HCP | IDR + USD | Sub-entity |
| PT HCI | IDR + USD | Sub-entity |

---

### 4.2 Sheet: `ДДС месяц` (Main Transaction Register)

The core data entry sheet. **372 rows × 14 columns** with actual transactions Jan–May 2026.

**Full schema:**

| Column | Field name | Type | CFO AI mapping |
|---|---|---|---|
| A | `Месяц` | string | `month_name` |
| B | `Мсц (цифрой)` | integer | `month_number` |
| C | `Дата` | date | `transaction_date` |
| D | `Сумма IDR` | decimal (negative = outflow) | `amount_idr` |
| E | `Кошелек_IDR` | string (FK → wallets) | `wallet_idr_id` |
| F | `Сумма $` | decimal | `amount_usd` |
| G | `USD x IDR` | decimal | `exchange_rate` |
| H | `Кошелек_$` | string (FK → wallets) | `wallet_usd_id` |
| I | `Направление бизнеса` | enum (FK → Справочники) | `business_direction` |
| J | `Контрагент` | string (FK → counterparties) | `counterparty_id` |
| K | `Назначение платежа` | string | `payment_purpose` |
| L | `Статья` | string (FK → ДДС статьи) | `cashflow_article_id` |
| M | `Платеж/поступл` | enum: "Платеж" / "Поступление" | `direction` |
| N | `Вид д-ти` | enum (FK → Справочники) | `activity_type` |

> **Important:** Amounts in `Сумма IDR` use **sign convention** — outflows are negative, inflows are positive. Both IDR and USD amounts are recorded per transaction with the exchange rate used.

**Sample transactions (January 2026):**

| Date | Amount IDR | Wallet | Business direction | Description | Article | Activity |
|---|---|---|---|---|---|---|
| 2026-01-01 | −290,000 | PT Siberian BG_IDR | Общее | Production staff payroll | Зарплата производственного персонала | Операционная |
| 2026-01-15 | −167,500 | PT Siberian BG_IDR | Общее | Admin contractors | Административные подрядчики | Операционная |
| 2026-01-15 | −13,800,000 | Общий_IDR | Вендинговые автоматы | Disinfectant purchase 1000L | Содержание вендинговых автоматов | Операционная |
| 2026-01-16 | −58,625,000 | Общий_IDR | Общее | Business trip to China | Командировочные расходы | Операционная |
| 2026-01-16 | −143,856,000 | Общий_IDR | Вендинговые автоматы | Cirkl K rent 3 months | Оплата рекламных систем | Операционная |
| 2026-01-16 | −1,500,000 | Общий_IDR | Франшиза | Photographer Kuta (presentation) | Маркетинговые подрядчики | Операционная |

---

### 4.3 Wallet Sheets (`Общий_IDR`, `PT Siberian BG_IDR`, etc.)

Each of the 8 named wallet sheets (+ 8 numbered month variants) shows the **monthly cash flow statement by article** for that single wallet.

**Structure (per wallet, 211 rows × 13 columns):**

```
Row 0:   Wallet name (e.g. "Общий_IDR")
Row 1:   Month headers (1–12)
Row 2:   Opening balance (Денег на начало месяца)
│
├── OPERATIONAL ACTIVITY (Операционная деятельность)
│   ├── [All 37 operational articles, one row each]
│   └── Subtotal per month
│
├── INVESTMENT ACTIVITY (Инвестиционная деятельность) — rows 104–113
│   ├── Продажа ОС
│   ├── Покупка ОС
│   ├── Ремонт ОС
│   ├── Выдача кредитов и займов
│   ├── Возврат кредитов и займов
│   └── Прочие поступл. от фин. операций
│
├── FINANCIAL ACTIVITY (Финансовая деятельность) — rows 115–123
│   ├── Получение кредитов и займов
│   ├── Оплаты по кредитам и займам
│   ├── Вклады от собственников
│   └── Дивиденды
│
├── TECHNICAL OPERATIONS (Технические операции) — rows 206–208
│   ├── Поступление — Перевод между счетами
│   └── Выбытие — Перевод между счетами
│
Row 209: Net change for month (Изменение денег за месяц)
Row 210: Closing balance (Денег на конец месяца)
```

**Sample actuals (Общий_IDR wallet, IDR amounts):**

| Article | Jan 2026 | Feb 2026 | Mar 2026 | Apr 2026 | May 2026 |
|---|---|---|---|---|---|
| Opening balance | 0 | −1,490,352,000 | −1,853,908,000 | −1,446,098,000 | −1,665,115,000 |
| Vending machine sales | 0 | 20,864,000 | 37,651,500 | 18,398,000 | 9,867,000 |
| Franchise sales | 0 | 0 | 908,853,700 | 0 | 323,410,300 |
| Royalties | 0 | 0 | 88,425 | 0 | 0 |
| Production staff wages | −53,000,000 | −53,000,000 | 0 | 0 | −45,386,360 |
| Transport | −2,700,000 | −650,000 | −1,000,600 | −13,625,000 | −6,591,548 |

---

### 4.4 Sheets: `ДДС Сводный IDR` and `ДДС Сводный $`

**Consolidated monthly cash flow** across all wallets for each currency. 236 rows × 13 columns.

**Structure additions vs. single wallet sheet:**
- Header block: lists all 4 wallets with their opening balances
- Same article-by-article section as wallet sheets (aggregated)
- Footer block (rows 217–235):
  - Closing balance per wallet
  - **`Итого в локальных ДДС`** — sum of all local wallet closing balances
  - **`Проверка сходимости`** — reconciliation check: shows "ОК!" when consolidated total equals sum of wallet totals
  - **`Поступление — Перевод между счетами`** — total inter-wallet inflows
  - **`Выбытие — Перевод между счетами`** — total inter-wallet outflows
  - **`Сходимость переброса`** — transfer reconciliation: inflows must equal outflows (zero-sum check)

> **Key control:** The two reconciliation rows ("ОК!" checks) are the DDS file's built-in data quality gates — equivalent to a bank reconciliation.

---

### 4.5 Sheet: `Справочники` (Master Reference Tables)

Three lookup tables defined in one sheet:

**Business Directions (Направление бизнеса):**
- `Вендинговые автоматы` — vending machine operations
- `Франшиза` — franchise operations
- `Общее` — shared/general (not attributable to a specific direction)

**Activity Types (Вид деятельности):**
- `Операционная` — core business operations
- `Инвестиционная` — capital investments (asset purchase/sale)
- `Финансовая` — financing (loans, dividends, owner contributions)
- `Техническая операция` — internal transfers between wallets (cash-neutral)

**Groups (Группа):**
- `Поступление` — inflow
- `Выбытие` — outflow

---

### 4.6 Sheet: `ДДС статьи` (Complete Article Directory — 46 articles)

The master taxonomy of all cashflow categories. Each article has: name, group (inflow/outflow), activity type, and a sub-article description explaining exactly what belongs there.

**Technical operations (2 articles):**

| Article | Group | Activity | Description |
|---|---|---|---|
| Поступление — Перевод между счетами | Поступление | Техническая операция | Money received from our own account or wallet |
| Выбытие — Перевод между счетами | Выбытие | Техническая операция | Money sent to our own account or wallet |

**Operational inflows (6 articles):**

| Article | Description |
|---|---|
| Продажи в вендинговых автоматах | POS sales from vending machines (cash + card) |
| Продажи франшизы | Franchise sales inflows |
| Роялти | Royalty payments from franchisees |
| Паушальный взнос | Franchise entry fee (lump sum) |
| Возвраты от поставщиков | Supplier refunds on prior payments |
| Прочие поступления | Other operating income |

**Operational outflows (27 articles):**

| Group | Articles |
|---|---|
| COGS / Sales | Возвраты клиентам, Закупка товара, Транспортные услуги, Эквайринг, РКО |
| Personnel | Зарплата производственного персонала вендинговые автоматы, Зарплата административного персонала, Зарплата коммерческого персонала франшиза, Налоги на ФОТ, Обучение персонала, Расходы на персонал, Поиск и найм персонала |
| Travel / Representation | Командировочные расходы, Представительские расходы |
| Marketing | Оплата рекламных систем, Маркетинговые подрядчики |
| Admin / Professional services | Административные подрядчики |
| IT / Digital | Электронные подписки, Связь, интернет |
| Vending operations | Содержание вендинговых автоматов, Аренда торговых точек, Аренда техники |
| Office | Содержание офиса, Хоз. инвентарь, Аренда офиса, Ремонт и содержание офиса, Оргтехника |
| Cash management | Покупка наличности |

**Investment activity (5 articles):**

| Article | Group | Description |
|---|---|---|
| Продажа ОС | Поступление | Sale of fixed assets (furniture, equipment) |
| Покупка ОС | Выбытие | Purchase of fixed assets (>10k RUB equivalent) |
| Ремонт ОС | Выбытие | Capital repairs that increase asset value/lifetime |
| Выдача кредитов и займов | Выбытие | Loans issued by the company |
| Возврат кредитов и займов | Поступление | Loan repayments received by the company |
| Прочие поступл. от фин. операций | Поступление | Interest on account balances |

**Financial activity (4 articles):**

| Article | Group | Description |
|---|---|---|
| Получение кредитов и займов | Поступление | Loans received (debt borrowed) |
| Оплаты по кредитам и займам | Выбытие | Loan repayments made |
| Вклады от собственников | Выбытие | Owner capital contributions |
| Дивиденды | Выбытие | Dividend payments to owners |

---

### 4.7 Sheet: `ДДС настройки (для ввода сальдо)` (Opening Balance Setup)

**Purpose:** Configure the DDS model before first use — set the starting month and opening balances per wallet.

**Schema:**
```
Row 0:  Месяц начала — starting month number (currently: 1)
Row 1:  Header: Кошелек | Сумма на начало
Row 2+: One row per wallet with opening balance amount
```

**Wallets configured:**
- PT Siberian BG_IDR / PT Siberian BG_$
- Общий_IDR / Общий_$
- PT HCP_IDR / PT HCP_$
- PT HCI_IDR / PT HCI_$
- Slots 9–12 (reserved for additional wallets)

> **CFO AI mapping:** This sheet is the `onboarding account setup` flow — the wizard step where a new user enters their current balances. CFO AI's Onboarding wizard (TASK 26) already has this step but only supports a single account with a single balance. Multi-wallet support requires a future enhancement.

---

### 4.8 Sheet: `Регламент` (Process & Governance)

A full financial process document defining ownership, verification rules, risk management, and handover procedures.

**Document purpose:**
> *"Собрать полную и актуальную информацию о том, сколько денег сейчас у компании, по каким статьям происходит отток и приток денег. Взять под контроль и научиться управлять денежными потоками компании."*
>
> (Collect complete and current information about the company's cash: how much exists, where it flows in and out. Take control and learn to manage cash flows.)

**Responsible parties:**
- Primary owner: responsible for timely collection, verification, and correct reporting
- Data entry team: individual contributors per data source

**Risk management:**
| Risk | Mitigation |
|---|---|
| Responsible person on vacation | Transfer duties; deadline extended |
| Responsible person sick | Transfer duties; deadline extended |
| Technical failure | Monthly backup after presentation to client workspace |
| Responsible person resigns | Handover in working state with current data; date documented |
| Reporting deadline missed | Inform responsible staff; get deadline agreement |

**Daily verification rules (data quality checks):**
1. Wallet balances = actual bank/cash balances
2. Wallet balances in `ДДС месяц` = wallet balances in `ДДС Сводный`
3. Rows 229 and 232 in `ДДС Сводный` show **"ОК!" or 0** — reconciliation passed

**Critical process rule — transfer recording:**
> *"Технические операции (перекладывание денег из одного кошелька в другой) оформлять двумя записями: одна сумма с плюсом по статье 'Поступление — Перевод между счетами' в кошельке, куда переводим деньги, такая же сумма с минусом по статье 'Выбытие — Перевод между счетами' в кошельке, откуда переводятся деньги."*
>
> (Transfers between wallets must be recorded as TWO entries: one positive inflow + one negative outflow of the same amount, using the transfer articles.)

**Sheet-by-sheet workflow described:**
1. **Settings** — configure wallets and opening balances before first use
2. **Справочники** — set up business directions and reference data
3. **ДДС статьи** — configure cashflow articles (add new when needed)
4. **Wallet sheets** — auto-populated from ДДС месяц (no manual entry)
5. **ДДС Сводный** — configure wallet list; runs reconciliation automatically
6. **ДДС месяц** — the only manual data entry sheet; enter date, amount, wallet, direction, counterparty, purpose, article

---

## 5. Transfer Model — Critical Design Insight

The DDS file explicitly defines how transfers between wallets/accounts must be handled. This is the **most important architectural decision** for CFO AI's multi-account model.

### Current CFO AI approach (Phase 1):
```
Transaction type = "transfer"
description = "Transfer → BCA"   ← destination encoded in text
```
This approach cannot:
- Track which specific wallet sent vs. received
- Reconcile that total inflows = total outflows for transfers
- Aggregate balances correctly per wallet

### DDS approach (what Helm Care actually uses):
```
Row 1: amount = +X, wallet = BCA, article = "Поступление — Перевод между счетами"
Row 2: amount = -X, wallet = Mandiri, article = "Выбытие — Перевод между счетами"
```
The sum of all transfer inflows must equal the sum of all transfer outflows — verified by `Сходимость переброса` in `ДДС Сводный`.

### Recommended future CFO AI data model:

**UX layer** (what the user sees and enters):
```
User enters ONE transfer:
  From: Mandiri  →  To: BCA  |  Amount: Rp 5,000,000
```

**Data layer** (what the system stores):
```sql
transfers table:
  id, from_wallet_id, to_wallet_id, amount, exchange_rate, date, note

-- OR paired transactions:
transactions row 1: wallet_id = BCA,     amount = +5,000,000, transfer_pair_id = X
transactions row 2: wallet_id = Mandiri, amount = -5,000,000, transfer_pair_id = X
```

The `transfer_pair_id` links the two rows and enables automatic reconciliation.

---

## 6. Updated Concept → CFO AI Entity Mapping

| Excel Concept | Source Sheet | CFO AI Current Entity | Current Status | Gap |
|---|---|---|---|---|
| Daily transaction | Факт ДДС / ДДС месяц | `transactions` table | ✅ Exists | Missing: `counterparty_id`, `cashflow_article_id`, `business_direction`, `activity_type`, `wallet_id`, dual-currency fields |
| Expense/income category (Статья) | Справочник / ДДС статьи | `transactions.category` (free text) | ⚠️ Partial | No reference table; no inflow/outflow type on category |
| Article sub-description | ДДС статьи col D | — | ❌ Missing | No sub-article / category description |
| Business direction | Справочники | — | ❌ Missing | No business_direction field anywhere |
| Activity type (Op/Inv/Fin) | Справочники | — | ❌ Missing | No activity_type classification |
| Counterparty (Контрагент) | Контрагенты / ДДС месяц | — | ❌ Missing | No counterparties entity |
| Wallet / Account | Wallet sheets | `transactions.source` (free text) | ⚠️ Partial | No actual wallets table; no opening balances; no monthly summary |
| Wallet opening balance | ДДС настройки | — | ⚠️ Partial | Onboarding wizard has single account balance only |
| Multi-currency amounts | ДДС месяц (IDR + USD columns) | `transactions.amount` (IDR only) | ⚠️ Partial | Single amount field; no original currency / exchange rate |
| Exchange rate per transaction | ДДС месяц col G `USD x IDR` | — | ❌ Missing | No exchange rate field |
| Transfer between wallets | ДДС месяц (transfer articles) | `transactions.type = 'transfer'` | ⚠️ Partial | No `transfer_pair_id`; destination encoded in description text |
| Monthly cash summary per wallet | Wallet sheets (by article) | — | ❌ Missing | No monthly rollup per wallet |
| Consolidated multi-wallet summary | ДДС Сводный IDR / $ | — | ❌ Missing | No cross-wallet consolidated view |
| Transfer reconciliation | ДДС Сводный row 235 | — | ❌ Missing | No reconciliation check |
| Planned payment | Плановые Реестр выбытий | `reminders` (partial) | ⚠️ Partial | Reminders have no amount, no article, no counterparty |
| Planned income | Плановый Реестр поступлений | — | ❌ Missing | No planned income register |
| Weekly date grouping | Диапазон недель | — | ❌ Missing | No ISO week lookup or week-based views |
| Revenue stream (wash vs. ad) | P&L rows 1.1–1.5 | `transactions.source` | ⚠️ Partial | No structured revenue stream classification |
| Network scale (franchise vs. own) | P&L section A | — | ❌ Missing | No fleet/location count |
| Machine OPEX per location | P&L / Assumptions | `transactions` (ad hoc) | ⚠️ Partial | No per-location OPEX tracking |
| Quarterly P&L | P&L Квартальный | `/pulse` dashboard | ⚠️ Partial | Pulse shows totals but no P&L structure; no quarterly view |
| Monthly close checklist | Регламент | — | ❌ Missing | No monthly close workflow or verification tasks |
| Data quality checks | Регламент / ДДС Сводный | — | ❌ Missing | No balance reconciliation or data completeness checks |
| Model assumptions | Допущения | — | ❌ Missing | No structured assumptions store |
| Franchise partner | P&L / Planov. Register | — | ❌ Missing | No franchise partner entity |

---

## 7. Proposed Target Data Model

> **These are proposed future entities. Do NOT create migrations now.**

### 7.1 `cashflow_categories` (was: `cashflow_categories`)
```
id              uuid PK
name            text          -- e.g. "Зарплата административного персонала"
sub_description text          -- explains what belongs here (from ДДС статьи col D)
direction       enum          -- 'inflow' | 'outflow'
activity_type   enum          -- 'operational' | 'investment' | 'financial' | 'technical'
group_name      text          -- e.g. "Personnel", "IT / Digital", "Location Rent"
is_transfer     boolean       -- true for the two transfer articles
is_active       boolean
```
**Source:** `ДДС статьи` sheet (46 articles)

---

### 7.2 `counterparties`
```
id              uuid PK
user_id         uuid FK users
name            text          -- e.g. "Google", "PT Siberian BG", "Marina Linkova"
group           enum          -- 'vendor' | 'employee' | 'franchisee' | 'client' | 'bank' | 'owner'
notes           text
is_active       boolean
```
**Source:** `Контрагенты` sheet / `ДДС месяц` column J

---

### 7.3 `wallets`
```
id              uuid PK
user_id         uuid FK users
name            text          -- e.g. "Общий_IDR", "PT Siberian BG_$"
entity_name     text          -- e.g. "PT Siberian BG", "Общий"
currency        text          -- 'IDR' | 'USD' | 'EUR' etc.
is_active       boolean
sort_order      integer
```
**Source:** `ДДС настройки` sheet / wallet sheet names

---

### 7.4 `wallet_balances`
```
id              uuid PK
wallet_id       uuid FK wallets
year            integer
month           integer
opening_balance numeric
closing_balance numeric
computed_at     timestamptz
```
**Source:** Rows 2 and 210 of each wallet sheet (auto-computed from transactions)

---

### 7.5 `cashflow_transactions` (extended `transactions`)
```
id                    uuid PK
user_id               uuid FK users
wallet_id             uuid FK wallets
transaction_date      date
amount_original       numeric      -- signed: negative = outflow
currency_original     text
exchange_rate         numeric      -- to base currency (IDR)
amount_base           numeric      -- amount in IDR (= amount_original × exchange_rate)
direction             enum         -- 'inflow' | 'outflow'
category_id           uuid FK cashflow_categories
counterparty_id       uuid FK counterparties (nullable)
business_direction    enum         -- 'vending' | 'franchise' | 'general'
activity_type         enum         -- 'operational' | 'investment' | 'financial' | 'technical'
payment_purpose       text
transfer_pair_id      uuid (nullable, self-reference for paired transfer rows)
month_number          integer      -- derived
year                  integer      -- derived
created_at            timestamptz
```
**Source:** `ДДС месяц` sheet — all 14 columns

---

### 7.6 `transfer_pairs`
```
id                uuid PK
user_id           uuid FK users
from_wallet_id    uuid FK wallets
to_wallet_id      uuid FK wallets
amount            numeric
currency          text
exchange_rate     numeric (nullable — if cross-currency)
transfer_date     date
note              text
outflow_tx_id     uuid FK cashflow_transactions
inflow_tx_id      uuid FK cashflow_transactions
created_at        timestamptz
```
**Source:** Регламент transfer rule + `ДДС Сводный` reconciliation rows

---

### 7.7 `business_directions`
```
id      uuid PK
name    text    -- 'Вендинговые автоматы' | 'Франшиза' | 'Общее'
slug    text    -- 'vending' | 'franchise' | 'general'
```
**Source:** `Справочники` sheet column A

---

### 7.8 `activity_types`
```
id      uuid PK
name    text    -- 'Операционная' | 'Инвестиционная' | 'Финансовая' | 'Техническая операция'
slug    text    -- 'operational' | 'investment' | 'financial' | 'technical'
```
**Source:** `Справочники` sheet column B

---

### 7.9 `currency_rates`
```
id          uuid PK
from_ccy    text    -- 'USD'
to_ccy      text    -- 'IDR'
rate        numeric
rate_date   date
source      text    -- 'manual' | 'api'
```
**Source:** `ДДС месяц` column G `USD x IDR`

---

### 7.10 `dds_monthly_summaries`
```
id                    uuid PK
user_id               uuid FK users
wallet_id             uuid FK wallets
year                  integer
month                 integer
opening_balance_idr   numeric
operational_net_idr   numeric
investment_net_idr    numeric
financial_net_idr     numeric
technical_net_idr     numeric
closing_balance_idr   numeric
reconciliation_ok     boolean
computed_at           timestamptz
```
**Source:** Auto-computed from `cashflow_transactions` grouped by wallet + month

---

### 7.11 `planned_cashflows`
```
id                  uuid PK
user_id             uuid FK users
type                enum            -- 'inflow' | 'outflow'
counterparty_id     uuid FK counterparties (nullable)
category_id         uuid FK cashflow_categories (nullable)
wallet_id           uuid FK wallets (nullable)
invoice_number      text
amount              numeric
currency            text
planned_date        date
comment             text
year                integer
month               integer
week_number         integer
is_executed         boolean
executed_tx_id      uuid FK cashflow_transactions (nullable)
```
**Source:** `Плановые Реестр выбытий` + `Плановый Реестр поступлений`

---

### 7.12 `locations` (vending machine placements)
```
id                  uuid PK
user_id             uuid FK users
name                text            -- e.g. "Cocomart Seminyak"
counterparty_id     uuid FK counterparties
business_direction  text            -- 'vending' | 'franchise'
machine_count       integer
monthly_rent_usd    numeric
go_live_date        date
is_active           boolean
```

---

### 7.13 `franchise_partners`
```
id                  uuid PK
user_id             uuid FK users
partner_name        text
package             enum            -- 'custom' | 'starter' | 'master'
units_purchased     integer
contract_date       date
royalty_rate        numeric
revenue_share_rate  numeric
```

---

### 7.14 `monthly_close_checklists`
```
id              uuid PK
user_id         uuid FK users
year            integer
month           integer
task_name       text
is_completed    boolean
completed_at    timestamptz
completed_by    text
notes           text
```
**Source:** `Регламент` sheet — process checklist items

---

## 8. Product Modules Required

| Module | Description | Source template | Priority |
|---|---|---|---|
| **Category Management** | Structured 46-article category list with activity type, group, sub-description | ДДС статьи | 🔴 Critical |
| **Business Direction Tags** | Per-transaction tagging: Vending / Franchise / General | Справочники | 🔴 Critical |
| **Counterparty Registry** | Vendors, employees, franchisees, clients, banks | Контрагенты | 🔴 Critical |
| **Multi-Wallet Support** | Real wallet/account entities with opening balances | ДДС настройки | 🔴 Critical |
| **Multi-Currency Transactions** | IDR + USD amounts, exchange rate per transaction | ДДС месяц | 🟠 High |
| **Transfer Pair Model** | User enters 1 transfer → system creates 2 paired transactions | Регламент | 🟠 High |
| **Planned Payments Register** | Scheduled future outflows with category, counterparty, date | Плановые Реестр выбытий | 🟠 High |
| **Planned Income Register** | Scheduled future inflows | Плановый Реестр поступлений | 🟠 High |
| **Monthly DDS Summary** | Per-wallet monthly cashflow by article (Operational/Investment/Financial) | Wallet sheets | 🟠 High |
| **Consolidated Cash View** | Cross-wallet, cross-entity aggregated monthly statement | ДДС Сводный | 🟠 High |
| **Balance Reconciliation** | Daily check: wallet balance = bank balance; transfer in = transfer out | Регламент / ДДС Сводный | 🟠 High |
| **Cash Calendar** | Daily/weekly view of planned vs. actual cash | Платежный календарь | 🟡 Medium |
| **Activity Type Classification** | Operational / Investment / Financial classification per transaction | Справочники | 🟡 Medium |
| **Plan vs. Actual Matching** | Link planned payment to executed transaction | Registers | 🟡 Medium |
| **Location Tracker** | Vending machine placements with rent, machine count, landlord | P&L | 🟡 Medium |
| **Franchise Partner Module** | Partner registry, royalty tracking, payout scheduling | P&L / Registers | 🟡 Medium |
| **P&L Statement** | Structured P&L: Revenue → GP → OPEX → EBIT → Net Profit | P&L Квартальный | 🟡 Medium |
| **Monthly Close Checklist** | Guided month-end closing with verification tasks | Регламент | 🟡 Medium |
| **CAPEX Tracking** | Fixed asset purchase/sale/repair with depreciation | ДДС статьи (Инвест.) | 🟢 Low |
| **Model Assumptions Store** | Key business parameters (USD/IDR, OPEX/machine, etc.) | Допущения | 🟢 Low |
| **Quarterly Report** | Aggregate P&L by quarter | P&L Квартальный | 🟢 Low |

---

## 9. Implementation Phases

### Phase A — Foundation: Categories, Directions, Counterparties
*Prerequisite for everything else.*

- Create `cashflow_categories` seeded with 46 articles from `ДДС статьи`
- Create `business_directions` (3 values) and `activity_types` (4 values)
- Create `counterparties` table
- Add `category_id`, `counterparty_id`, `business_direction`, `activity_type` to transactions
- Update Add page: category dropdown (grouped) + counterparty autocomplete + direction select
- Update Transactions list: filter by category, direction, activity type

**Unlocks:** Structured actual DDS register equivalent in CFO AI

---

### Phase B — Wallets & Multi-Currency
*Multi-entity cash tracking.*

- Create `wallets` table (one per entity × currency combination)
- Create `currency_rates` table (manual entry to start)
- Extend transactions: `wallet_id`, `amount_original`, `currency_original`, `exchange_rate`, `amount_base`
- Onboarding: multi-wallet setup with opening balances per wallet
- Wallet selector on Add transaction page
- Wallet balance display on Pulse/dashboard

**Unlocks:** Multi-entity, multi-currency cash tracking like `ДДС месяц`

---

### Phase C — Transfer Pair Model
*Correct inter-wallet transfer handling.*

- Create `transfer_pairs` table
- Add transaction UI: transfer type creates two paired rows automatically
- `transfer_pair_id` FK on transactions
- Reconciliation check: sum(transfer inflows) = sum(transfer outflows) per period
- Replace current "Transfer → BCA" description hack

**Unlocks:** `Регламент` transfer rule; `Сходимость переброса` reconciliation

---

### Phase D — Planning Layer
*Scheduled payments and income.*

- Create `planned_cashflows` table
- New page: `/plan` — add/edit/view planned outflows and inflows
- Weekly grouping (ISO week number, using `Диапазон недель` logic)
- Plan vs. actual matching
- Cash calendar view (daily/weekly)

**Unlocks:** `Плановые Реестр выбытий` + `Плановый Реестр поступлений` equivalents

---

### Phase E — Monthly Summaries & Reporting
*DDS consolidated view and P&L.*

- `dds_monthly_summaries` auto-computed on transaction save
- Monthly DDS view per wallet: Operational / Investment / Financial sections
- Consolidated cross-wallet summary with reconciliation check ("ОК!")
- Monthly close checklist from `Регламент` process
- Structured P&L statement (Revenue → OPEX → Net Profit)

**Unlocks:** `ДДС Сводный` + `Регламент` monthly closing workflow

---

## 10. Current System Gaps (Complete List)

### 🔴 Critical — block Phase A:
1. **No category reference table** — `transactions.category` is free text; cannot filter, aggregate, or reconcile
2. **No business direction** — Вендинговые автоматы vs Франшиза vs Общее is not tracked anywhere
3. **No activity type** — Operational vs Investment vs Financial classification missing
4. **No counterparty entity** — vendors, franchisees, employees are unnamed in CFO AI

### 🟠 High — block Phase B/C:
5. **No real wallet/account table** — `transactions.source` is free text; no opening balances, no balance computation per wallet
6. **No multi-currency support** — single `amount` field in IDR only; no original currency, no exchange rate stored
7. **No transfer pair logic** — transfers use description text hack; no reconciliation possible; inflow and outflow rows not linked
8. **No planned payment entity** — `reminders` exist but have no amount, no category, no counterparty

### 🟡 Medium — block Phase D/E:
9. **No monthly DDS summary** — no aggregated monthly view by article per wallet
10. **No cross-wallet consolidation** — no way to see total cash across all wallets/entities
11. **No balance reconciliation** — no verification that wallet balances match real bank balances
12. **No monthly close workflow** — no checklist, no ownership, no deadline tracking
13. **No P&L statement** — Pulse shows period totals but not structured P&L
14. **No location/site entity** — vending machine placements not tracked
15. **No franchise partner entity** — franchise payouts unstructured

### 🟢 Low — block Phase E:
16. **No CAPEX / fixed asset tracking** — no distinction between CAPEX and OPEX spending
17. **No model assumptions store** — business parameters hardcoded in P&L spreadsheet
18. **No multi-entity / business_id model** — single-tenant; cannot separate PT Siberian BG from PT HCP

---

## 11. Recommended Next Engineering Task: TASK 28

**TASK 28 — Cashflow Categories, Business Directions & Counterparties Foundation**

Build the foundation layer that all subsequent phases depend on. This is the minimum viable change that makes CFO AI's transaction data structured enough to aggregate, filter, and eventually import DDS data.

### What to build:

**1. Backend — new reference tables (additive only, no existing schema changes):**
- `cashflow_categories` — seeded with 46 articles from `ДДС статьи`; fields: `name`, `sub_description`, `direction` (inflow/outflow), `activity_type`, `group_name`, `is_transfer`, `is_active`
- `business_directions` — seeded: Вендинговые автоматы, Франшиза, Общее
- `counterparties` — user-managed; fields: `name`, `group`, `notes`

**2. Backend — extend transactions (add nullable columns only):**
- `category_id` → FK `cashflow_categories` (nullable)
- `counterparty_id` → FK `counterparties` (nullable)
- `business_direction` → text / enum (nullable)
- `activity_type` → text / enum (nullable)

**3. Backend — new API endpoints:**
- `GET /api/categories` — return categories grouped by activity_type + direction
- `GET /api/counterparties` — return user's counterparty list
- `POST /api/counterparties` — create new counterparty

**4. Frontend — Add page:**
- Replace free-text category with grouped `<select>` using category reference
- Add counterparty autocomplete (create-inline if not found)
- Add business direction radio/select
- Backward compatible: old transactions without `category_id` still display

**5. Frontend — Transactions list:**
- Category badge on each transaction row (colour by activity type)
- Filter by category group, business direction

**Why this first:**
- Every other Phase (B–E) requires structured categories and directions
- Zero risk to existing data — all new columns nullable, backward compatible
- Unblocks: DDS import, monthly summaries, P&L aggregation, budget comparison
- Small enough to ship in one task

---

*Document created: 2026-06-10 | Updated: 2026-06-10*
*Source files: Helm Care internal financial templates (3 files)*
*CFO AI project: helm-finance-web*
