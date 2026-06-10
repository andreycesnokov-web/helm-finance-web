# CFO AI — Financial Template Learning Map
## Helm Care Excel Spreadsheet Architecture Analysis

> **Purpose:** Document the financial logic, data structures, and business model encoded in Helm Care's existing Excel templates so that CFO AI can be extended to support the same workflows natively.
>
> **Scope:** Documentation and architecture mapping only. No code, no migrations, no backend changes.
>
> **Source files analysed:**
> - `Платежный календарь Helm-Care.xlsx` (Payment Calendar)
> - `HELM CARE P&L.xlsx` (Quarterly P&L Model)

---

## 1. Executive Summary

Helm Care operates a **vending-machine franchise network** in Indonesia — helmet-washing kiosks combined with DOOH (Digital Out-of-Home) advertising screens. The company is Indonesian-based, reports in **USD** (converted from IDR at ~16,650 IDR/USD), and is in an active growth phase (2026 onward).

Two financial templates currently exist outside CFO AI:

| Template | Purpose | Time granularity | Status |
|---|---|---|---|
| Платежный календарь | Cash flow planning & actual tracking | Daily / Weekly | Active (Jun 2026 data) |
| P&L Квартальный | Long-range revenue and profit model | Quarterly (2026–2031) | Projection model |

**Key insight:** CFO AI already handles ad-hoc transaction entry and basic reporting. These spreadsheets represent the *planning layer* — scheduled future payments, category budgets, a counterparty registry, and a 5-year strategic model. This gap is the primary focus of this document.

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

**Structure:** 62 rows × 138 columns. Columns represent dates grouped by week, with a boolean "plan/fact" toggle per column pair (columns labeled `True` / unnamed). Row 0 = `Ответственные` (Responsible persons). This sheet powers a more advanced planning view with per-week responsibility assignment.

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

Currently empty (header row only). Intended structure mirrors the outflows register:

```
Контрагент | Статья | ... | Сумма план | Дата | Комментарий | Год | Месяц | Неделя
```

> **Gap:** Helm Care has not yet filled this in — income planning is done implicitly via the P&L model.

---

### 2.5 Sheet: `Факт ДДС` (Actual Cash Flow — Statement of Cash Flows)

**Schema:**

| Column | Type | Description |
|---|---|---|
| `Год` | integer | Year |
| `Мсц (цифрой)` | integer | Month (numeric) |
| `Дата` | date | Transaction date |
| `Сумма` | decimal (USD) | Amount |
| `Контрагент` | string | Counterparty |
| `Назначение платежа` | string | Payment purpose/description |
| `Статья` | string (FK → Справочник) | Category |
| `Платеж/поступл` | enum: "Платеж" / "Поступление" | Outflow / Inflow |

**Current data:** 1 transaction — Google, 2026-06-04, USD 221.82, category "прочие информационные услуги (сервисы)", type: Платеж.

> **CFO AI mapping:** This sheet is the closest equivalent to CFO AI's `transactions` table — but it adds `Контрагент` (counterparty), a numerical month column, and a typed Статья (category from reference).

---

### 2.6 Sheet: `Справочник` (Category Reference / Directory)

The master list of 41 expense and income categories, each classified as `Поступление` (inflow) or `Платеж` (outflow):

**Inflow categories (Поступление):**
- Поступления мойки (Wash revenue)
- Поступления реклама (Ad revenue)
- *(1 unnamed)*

**Outflow categories (Платеж) — 38 categories:**

| Group | Categories |
|---|---|
| Vending operations | Вендинговые автоматы, Вспомогательные материалы, Обслуживание оборудования, Ремонт оборудования |
| Personnel | Заработная плата, Отчисления с ФОТ, НДФЛ, Обучение сотрудников, Подбор персонала, Прочие расходы на персонал |
| Location / Rent | Аренда площадки, Коммунальные расходы автоматы, ГСМ (fuel), Прочие транспортные расходы |
| Office / Admin | Аренда (office), Коммунальные расходы, Охрана помещений, Ремонт помещений, Телефон, Интернет, Обучение, Подбор, Прочие расходы на персонал, Хозяйственные, Канцелярские, Содержание оргтехники, Поддержка ПО, Аутсорсинг, Прочие информационные услуги (сервисы) |
| Finance | РКО (bank charges), Инкассация, Прочие расходы на ден. обращение |
| Travel / Representation | Командировки, Представительские расходы |
| Legal / Compliance | Юридическое сопровождение |
| Franchise | Выплата франчайзи |
| Marketing | Реклама и продвижение |

---

### 2.7 Sheet: `Контрагенты` (Counterparties)

Empty (header only): `Контрагенты список` | `Группа`

> **Gap:** Counterparty master list not yet populated. The planned outflows register shows real counterparty names inline.

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
| Metric | Q1 2026 | Q2 2026 | Q3 2026 | Q4 2026 | FY 2027 → |
|---|---|---|---|---|---|
| New franchise automats sold | 0 | 54 | 62 | 72 | growing |
| Franchise network (cumulative) | 0 | 54 | 117 | 189 | 366+ |
| New own-network automats | 55 | 663 | 100 | 100 | 150/qtr |
| Own network (cumulative) | 55 | 718 | 818 | 918 | 1,218+ |
| **Total fleet** | **55** | **772** | **935** | **1,107** | **1,584+** |

#### B. Revenue (USD)
| Stream | Q1 2026 | Q2 2026 | FY 2027 (est.) |
|---|---|---|---|
| Wash revenue — franchise | 0 | 25,151 | growing |
| Wash revenue — own | 12,635 | 332,366 | ~5.8M/yr |
| DOOH ad — franchise (90% rev share) | 0 | 44,362 | growing |
| DOOH ad — own (100%) | 29,700 | 651,370 | ~17M/yr |
| Paushalnyi взнос (franchise unit sales) | 0 | 203,750 | growing |
| **TOTAL REVENUE** | **42,335** | **1,256,999** | **~$30M+/yr** |

#### C. OPEX
| Item | Q1 2026 | Q2 2026 |
|---|---|---|
| Machine OPEX — franchise | 0 | 20,630 |
| Machine OPEX — own | 20,625 | 272,616 |
| Renovation fund (5%/yr fleet) | 1,891 | 26,549 |
| Management / HQ costs | 105,150 | 107,779 |
| **TOTAL OPEX** | **127,666** | **427,573** |

#### D. Operating Profit → E. CAPEX → F. Net Profit
| Metric | Q1 2026 | Q2 2026 | Cumulative breakeven |
|---|---|---|---|
| Operating profit | −85,330 | +825,583 | Q3 2026 |
| Net profit | −236,580 | −1,147,084 | Q3 2026 |
| Cumulative net profit | −236,580 | −1,383,665 | **Q3 2026 = +$126K** |

---

### 3.2 Sheet: `Допущения` (Key Model Assumptions)

**Critical numbers underpinning the model:**

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

## 4. Concept → CFO AI Entity Mapping

| Excel Concept | Excel Location | CFO AI Current Entity | Current Status | Gap |
|---|---|---|---|---|
| Daily transaction (Факт ДДС) | Факт ДДС sheet | `transactions` table | ✅ Exists | Missing: `counterparty_id`, typed `category` (FK to list) |
| Expense category (Статья) | Справочник sheet | `transactions.category` (free text) | ⚠️ Partial | No reference table; no inflow/outflow type on category |
| Counterparty (Контрагент) | Контрагенты sheet | — | ❌ Missing | No counterparties entity at all |
| Planned payment (Плановые Реестр выбытий) | Плановые Реестр выбытий | `reminders` table (partial) | ⚠️ Partial | Reminders have no amount, no category, no counterparty; not linked to cash flow |
| Planned income (Плановый Реестр поступлений) | Плановый Реестр поступлений | — | ❌ Missing | No planned income register |
| Week reference (Диапазон недель) | Диапазон недель sheet | — | ❌ Missing | No ISO week lookup; weeks not used in transactions |
| Opening/closing balance per day | Платежный календарь простой | `accounts` (virtual, via transactions) | ⚠️ Partial | Balance is derived from transactions; no explicit daily snapshot |
| Revenue stream (wash vs. ad) | P&L sheet, rows 1.1–1.5 | `transactions.source` (free text) | ⚠️ Partial | No structured revenue stream classification |
| Network scale (franchise vs. own) | P&L section A | — | ❌ Missing | No franchise/location entity; no fleet count |
| OPEX per machine | P&L section C / Assumptions | `transactions.category` | ⚠️ Partial | No per-location OPEX tracking |
| HQ management costs | P&L section C row 2.4 | `transactions` (ad hoc) | ⚠️ Partial | No HQ vs. location cost separation |
| CAPEX — machine purchase | P&L section E | `transactions` (manual) | ⚠️ Partial | No CAPEX flag; no asset registry |
| Quarterly P&L | P&L Квартальный | `/pulse` dashboard | ⚠️ Partial | Pulse shows period totals but no P&L statement; no quarterly view |
| Model assumptions | Допущения sheet | — | ❌ Missing | No structured assumptions store in system |
| Franchise payout | Плановые Реестр выбытий (Выплата франчайзи) | `transactions` (manual) | ⚠️ Partial | No franchise partner entity; payments are unstructured |
| Royalty income | P&L row 3.1 | — | ❌ Missing | No royalty revenue type or calculation |

---

## 5. Proposed Target Data Model

> **These are proposed future entities. Do NOT create migrations now.**

### 5.1 `cashflow_categories`
```
id            uuid PK
name          text          -- e.g. "заработная плата"
direction     enum          -- 'inflow' | 'outflow'
group         text          -- e.g. "Personnel", "IT Services", "Location Rent"
parent_id     uuid FK self  -- for hierarchical categories
is_active     boolean
```

### 5.2 `counterparties`
```
id            uuid PK
user_id       uuid FK users
name          text          -- e.g. "Google", "Zoho CRM", "Marina Linkova"
group         text          -- e.g. "Vendor", "Employee", "Franchisee", "Client"
notes         text
```

### 5.3 `planned_cashflows`
```
id                  uuid PK
user_id             uuid FK users
type                enum        -- 'inflow' | 'outflow'
counterparty_id     uuid FK counterparties (nullable)
category_id         uuid FK cashflow_categories (nullable)
invoice_number      text
amount              numeric
currency            text
planned_date        date
comment             text
year                integer     -- derived
month               integer     -- derived
week_number         integer     -- derived (ISO week)
is_executed         boolean     -- false = planned, true = matched to actual transaction
executed_tx_id      uuid FK transactions (nullable)
```

### 5.4 `locations` (vending machine locations)
```
id                  uuid PK
user_id             uuid FK users
name                text          -- e.g. "Cocomart Seminyak"
counterparty_id     uuid FK counterparties  -- the landlord/placement partner
machine_count       integer
monthly_rent_usd    numeric
go_live_date        date
is_active           boolean
```

### 5.5 `franchise_partners`
```
id                  uuid PK
user_id             uuid FK users  -- the franchisor (Helm Care)
partner_name        text
package             enum          -- 'custom' | 'starter' | 'master'
units_purchased     integer
contract_date       date
royalty_rate        numeric       -- e.g. 0.15
revenue_share_rate  numeric       -- e.g. 0.10 (for ad revenue)
```

### 5.6 `model_assumptions` (optional, for P&L forecasting)
```
id              uuid PK
user_id         uuid FK users
key             text    -- e.g. "usd_idr_rate", "opex_per_machine_usd"
value           text
category        text    -- "operations" | "franchise" | "financial" | "market"
updated_at      timestamptz
```

---

## 6. Product Modules Required

Based on the gap analysis, the following product modules are needed to bring CFO AI to parity with these Excel templates:

| Module | Description | Priority |
|---|---|---|
| **Category Management** | Structured category list with inflow/outflow classification and hierarchical groups | High |
| **Counterparty Registry** | Create/manage vendors, employees, franchisees, clients with groups | High |
| **Planned Payments Register** | Scheduled future payments with category, counterparty, date, amount, week number | High |
| **Planned Income Register** | Mirror of planned payments for expected inflows | High |
| **Plan vs. Actual Matching** | Link planned payment to executed transaction; highlight unexecuted plans | High |
| **Cash Calendar View** | Daily/weekly calendar showing planned vs. actual cash flow per category | Medium |
| **Weekly View** | ISO week grouping; `Диапазон недель`-style navigation | Medium |
| **Location Tracker** | Vending machine placement locations with rent, machine count, landlord | Medium |
| **Franchise Partner Module** | Franchise partner registry, royalty tracking, payout scheduling | Medium |
| **P&L Statement** | Structured P&L: Revenue → Gross Profit → OPEX → Operating Profit → Net Profit | Medium |
| **Quarterly Report** | Aggregate transactions into quarterly P&L buckets | Medium |
| **CAPEX Tracking** | Flag transactions as CAPEX; asset registry with depreciation | Low |
| **Assumptions Store** | Key business parameters (USD/IDR rate, OPEX/machine, etc.) editable by user | Low |

---

## 7. Implementation Phases

### Phase A — Foundation: Categories & Counterparties
*Prerequisite for everything else.*

- Create `cashflow_categories` table with seed data from `Справочник`
- Create `counterparties` table
- Add `category_id` and `counterparty_id` fields to existing `transactions`
- Update Add page: category dropdown (from reference list) + counterparty autocomplete
- Update Transactions list: filter by category, filter by counterparty

**Unlocks:** Structured actual cash flow tracking (Факт ДДС equivalent in CFO AI)

---

### Phase B — Planned Payments Register
*Core planning workflow.*

- Create `planned_cashflows` table (outflows + inflows)
- New page: `/plan` — add/edit/view planned payments
- Fields: type, category, counterparty, amount, date, comment, week, invoice number
- List view: group by week; show overdue/upcoming/executed status
- Mark as executed: links plan record to actual transaction

**Unlocks:** `Плановые Реестр выбытий` + `Плановый Реестр поступлений` equivalents

---

### Phase C — Cash Calendar
*Visual planning layer.*

- Calendar view: monthly/weekly toggle
- Each day cell: planned outflows (red), planned inflows (green), actual transactions
- Running balance line: opening → closing per day
- Cash/non-cash split (наличные / безнал)

**Unlocks:** `Платежный календарь простой` equivalent

---

### Phase D — Locations & Franchise Partners
*Operations layer.*

- Create `locations` table (vending machine placements)
- Create `franchise_partners` table
- Franchise payouts: auto-schedule based on partner royalty_rate
- Location OPEX: monthly rent/utilities auto-planned per location
- Dashboard widget: fleet count (own + franchise)

**Unlocks:** Network scale tracking (P&L section A)

---

### Phase E — P&L & Forecasting
*Strategic layer — longest horizon.*

- Structured P&L statement: Revenue / COGS / Gross Profit / OPEX / Operating Profit / Net Profit
- Revenue streams: Wash (own/franchise), DOOH ads (own/franchise), Franchise fees, Royalties
- Quarterly aggregation view
- Simple assumptions store (USD/IDR rate, OPEX/machine, etc.)
- Forecast mode: project forward from assumptions (not full Excel model — just driver-based)

**Unlocks:** `P&L Квартальный` and `Допущения` equivalents

---

## 8. Current System Gaps (Summary)

### Critical gaps (block Phase A/B):
1. **No category reference table** — categories are free-text strings in `transactions.category`. Cannot filter, aggregate, or plan reliably without a normalised list.
2. **No counterparty entity** — Helm Care actively tracks who they pay (Google, Zoho, franchise partners). This is completely absent from CFO AI.
3. **No planned payment entity** — `reminders` exist but have no amount, no category, no currency, no counterparty, and are not linked to the cash flow system.

### Important gaps (block Phase C/D):
4. **No daily balance snapshot** — CFO AI computes balance from transactions but doesn't store an explicit opening/closing balance per day per account.
5. **No location/site entity** — All machine placements (Cocomart, Circle K, Alfamaret, etc.) are just counterparties in the spreadsheet. CFO AI has no concept of operational locations.
6. **No franchise partner entity** — Franchise payouts are scheduled payments to named partners; CFO AI cannot distinguish these from regular expenses.

### Strategic gaps (block Phase E):
7. **No P&L statement** — Pulse dashboard shows total income/expenses but not a structured P&L with gross profit, operating profit, EBITDA.
8. **No forecasting** — CFO AI is entirely backward-looking (actual transactions). No planning horizon.
9. **No assumptions store** — Business parameters like USD/IDR rate, OPEX per machine, royalty rate are hardcoded in the P&L spreadsheet with no home in CFO AI.

---

## 9. Recommended Next Engineering Task: TASK 28

**TASK 28 — Category Management System**

Build the foundation layer that all subsequent phases depend on:

1. **Backend:** Create `cashflow_categories` table (НЕ менять existing schema — add new table only)
   - Seed with 41 categories from `Справочник` sheet
   - `GET /api/categories` endpoint returning active categories grouped by direction + group
   - `POST /api/categories` (admin only) to add custom categories

2. **Frontend — Add page:** Replace free-text category input with a grouped dropdown
   - Groups: "Доходы" (inflows) / "Расходы" (outflows), then sub-group
   - Allow free-text fallback ("Custom category...") for backward compatibility

3. **Frontend — Transactions list:** Add category filter chip row
   - Filter by category group (e.g. "All IT Services")
   - Category badge on each transaction row (colour-coded by group)

4. **Frontend — Pulse page:** Break down expenses by category group in a new chart widget

**Why this first:** Every other Phase (B–E) requires structured categories. Without this, planned payments, P&L aggregation, and budget tracking are impossible. It's also the lowest-risk change — additive only, no existing data touched.

---

*Document created: 2026-06-10*
*Source files: Helm Care internal financial templates*
*CFO AI project: helm-finance-web*
