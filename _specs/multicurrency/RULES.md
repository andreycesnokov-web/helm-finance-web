# Rules & Specification: Multi-Currency Accounts & Valuation

**Document Version:** 1.0  
**Date:** 2026-10-04  
**Workspace Type Affected:** Business (`business_id` scoped). Personal is isolated and strictly untouched.  
**Status:** APPROVED BY OWNER on 2026-10-04.  
**Rate Provider Strategy:** Option C (Hybrid: Bank Indonesia JISDOR for fiat + CoinGecko/Binance for USDT). MOCK provider used in test suite.

---

## 1. Context & Business Goals

Helm Finance / CFO AI operates primarily for Indonesian entities with **IDR** (Indonesian Rupiah) as the base reporting currency (`businesses.base_currency = 'IDR'`).

Many businesses in Indonesia (including PTs, trading companies, tech startups, and hospitality) operate multi-currency operations:
- Holding foreign bank accounts in **USD**, **SGD**, **EUR**;
- Holding crypto operational reserves in **USDT**;
- Receiving payments from international clients in foreign currency;
- Paying overseas vendors, SaaS tools, and foreign contractors.

### Core Objectives:
1. Allow business accounts (wallets) to be denominated in **IDR, USD, SGD, EUR, USDT**.
2. Store the original transaction amount and native currency as immutable financial truth.
3. Automatically convert every foreign-currency transaction to IDR at the exchange rate on the transaction date and store the conversion rate on the transaction record itself.
4. Value the company's total cash ("Cash now" on Pulse and "Total Balance" in Accounts) at **today's** exchange rate, with a clear "as of <rate date>" timestamp.
5. Record inter-currency transfers with double-entry legs plus explicit FX gain/loss (курсовая разница).
6. Enable full support for other currencies across the new design (v2) in **English, Russian, and Indonesian (EN / RU / ID)**.
7. Preserve strict zero-regression on production: PT Helm Care Indonesia accounts are currently 100% IDR, so production cash figures (`Rp 131,82M`) must remain unchanged to the single rupiah.

---

## 2. Root Cause Analysis of Existing Currency Defects

### Defect 1: 1:1 Raw Copy to `amount_idr` on Writes
- **Bank Statement Import** (`server/index.js:5950`):
  `amount_original: r.amount, amount_idr: r.amount, currency_original: batch.currency || 'IDR'`
  When importing a USD statement, a $1,000 payment was written as `amount_idr: 1000` (Rp 1,000 instead of ~Rp 16,300,000).
- **Batch Transaction Entry** (`server/index.js:8051`):
  `amount_idr: t.currency === 'IDR' ? t.amount : (t.amount_idr || t.amount)`
  If the client does not provide `amount_idr`, it falls back to raw `t.amount`.
- **Transaction Amount Edit / Patch** (`server/index.js:748`):
  `patch.amount_original = a; patch.amount_idr = a;`
  Editing a transaction amount resets `amount_idr` directly to the original amount without FX conversion.

### Defect 2: Inconsistent Aggregation Across Endpoints
- **Pulse (`GET /api/pulse`)**:
  Calculates `totalBalance = allIncome - allExpenses + allCorrections` using `SUM(transactions.amount_original)` across all wallets, regardless of wallet currency. A USD wallet with $8,000 and an IDR wallet with Rp 120,000,000 are added together as `120,008,000` and labelled "Rp".
- **Accounts (`GET /api/wallets`)**:
  Wallets calculate balance in their native currency, but the UI previously summed only IDR wallets and left out foreign accounts.
- **Consequence**:
  Pulse "Cash now" and Accounts "Total Balance" disagree whenever a business holds a non-IDR wallet.

### Defect 3: Design v2 Ignores or Forces IDR
- **`client/src/v2/lib/addEntry.js`**:
  Hardcodes `currency: 'IDR'` and amount parsing regex `/^\d{1,3}([\s.,]?\d{3})*$|^\d+$/` which rejects cents/decimals required for USD, EUR, SGD, USDT.
- **`client/src/v2/pages/Accounts.jsx`**:
  Leaves non-IDR wallets out of the total with a disclaimer note (`acc.otherCcy`).
- **`client/src/v2/lib/pulseModel.js`, `radarSeries.js`, `performance.js`**:
  Filter out non-IDR records:
  `if (!t || (t.currency_original && t.currency_original !== 'IDR')) continue`
  Foreign income and expenses are completely invisible in cash flow, burn rate, and runway.

---

## 3. The Rules of Multi-Currency Math & Ledger Records

### Rule 1: The Principle of Financial Truth
1. `amount_original` and `currency_original` are the primary financial truth. They represent the actual currency and amount moved or held.
2. `amount_original` is never altered by subsequent exchange rate fluctuations.
3. Every wallet has an immutable base `currency` (e.g., `'USD'`, `'IDR'`, `'EUR'`, `'SGD'`, `'USDT'`). Once transactions exist in a wallet, its currency cannot be changed.

### Rule 2: Historical Transaction Valuation (`amount_idr`)
1. For every business transaction, `amount_idr` represents the reporting value in IDR **at the effective date of the transaction**:
   $$\text{amount\_idr} = \text{round}(\text{amount\_original} \times \text{rate})$$
2. For IDR transactions:
   $$\text{rate} = 1.0, \quad \text{amount\_idr} = \text{amount\_original}$$
3. For foreign currency transactions ($C \in \{\text{USD}, \text{SGD}, \text{EUR}, \text{USDT}\}$):
   - $\text{rate}$ is the historical exchange rate for pair $C/\text{IDR}$ on `transaction_date`.
   - The rate used is stored explicitly on the transaction record in `booked_rate` (NUMERIC(38,18)), along with `rate_source` (e.g. `'jisdor'`, `'mock'`, `'manual'`).
   - If migration 038 is active, it may also reference `fx_quote_id` -> `exchange_rate_quotes(id)`.
4. **Historical Immutability**:
   Once recorded, a transaction's `booked_rate` and `amount_idr` are **locked**. They never fluctuate when market exchange rates change tomorrow. They represent historical accounting cost.

### Rule 3: Account (Wallet) Balances
1. A wallet's ledger balance is always maintained and computed in its **own native currency**:
   $$\text{balance}_{\text{native}} = \sum \text{Cash In} - \sum \text{Cash Out} + \sum \text{Corrections}$$
   using `amount_original` of transactions assigned to that `wallet_id`.
2. In the UI (Accounts):
   - The primary balance is displayed in native currency: e.g. `$ 8,400.00`, `€ 5,200.00`, `Rp 120.000.000`.
   - The secondary balance is displayed as its IDR equivalent at **today's valuation rate**:
     $$\text{IDR equivalent} = \text{balance}_{\text{native}} \times \text{today\_rate}(C \to \text{IDR})$$
     rendered as: `≈ Rp 137.3M`.

### Rule 4: Company Total Valuation ("Cash now" & Accounts Total)
1. The company's total liquid cash is reported in the company's base currency (**IDR**).
2. The formula for company total cash is:
   $$\text{Total Cash}_{\text{IDR}} = \sum_{w \in \text{IDR wallets}} \text{balance}_w + \sum_{w \in \text{Foreign wallets}} \left( \text{balance}_w \times \text{today\_rate}(\text{currency}_w \to \text{IDR}) \right)$$
3. **Valuation Date Stamp**:
   The headline figure is accompanied by a timestamp / label:
   - EN: *"Valued at today's rate (as of 4 Oct 2026)"*
   - RU: *"По курсу на сегодня (на 4 окт 2026)"*
   - ID: *"Berdasarkan kurs hari ini (per 4 Okt 2026)"*
4. **Consistency Invariant**:
   **Pulse "Cash now" MUST EXACTLY EQUAL Accounts "Total Balance"** down to the single rupiah. Both call the unified valuation logic.

### Rule 5: Cross-Currency Transfers (FX Conversion)
When money moves between wallets of different currencies (e.g. USD account $\to$ IDR account, or EUR account $\to$ USD account):
1. **Two Balanced Legs**:
   - **Source Leg (Expense)**: Recorded on the source wallet in source currency:
     - `wallet_id`: Source wallet (e.g. USD)
     - `type`: `'expense'`
     - `category`: `'Transfer'`
     - `amount_original`: $A_{\text{src}}$ (e.g. `$ 1,000.00`)
     - `currency_original`: $C_{\text{src}}$ (`'USD'`)
     - `amount_idr`: $A_{\text{src}} \times \text{rate}(C_{\text{src}} \to \text{IDR}, \text{date})$
   - **Destination Leg (Income)**: Recorded on the destination wallet in destination currency:
     - `wallet_id`: Destination wallet (e.g. IDR)
     - `type`: `'income'`
     - `category`: `'Transfer'`
     - `amount_original`: $A_{\text{dst}}$ (e.g. `Rp 16.250.000`)
     - `currency_original`: $C_{\text{dst}}$ (`'IDR'`)
     - `amount_idr`: $A_{\text{dst}} \times \text{rate}(C_{\text{dst}} \to \text{IDR}, \text{date})$
2. **Transfer Grouping**:
   - Both legs share a common group identifier in `source`: `xfer:<uuid>`.
3. **FX Gain / Loss / Fee (Курсовая разница / комиссия)**:
   - Real-world bank transfers have bank spreads or fees:
     $$\Delta_{\text{FX}} = \text{amount\_idr}(\text{destination}) - \text{amount\_idr}(\text{source})$$
   - If $\Delta_{\text{FX}} < 0$, it is an **FX Loss / Bank conversion fee**.
   - If $\Delta_{\text{FX}} > 0$, it is an **FX Gain**.
   - Recorded either via `fx_conversions` row (linking quote, source leg, target leg, fee, and spread) or an audited metadata attachment, so company net worth does not distort.

### Rule 6: Manual Rate Override & Audit Trail
1. If an invoice or bank statement shows an exact conversion rate applied by the bank (e.g. BCA teller receipt or Mandiri TT rate), the accountant/admin can provide an explicit rate or explicit `amount_idr`.
2. When a manual rate override is used:
   - `rate_source` is set to `'manual'`.
   - `manual_reason` is required (e.g. "BCA remittance slip #48291").
   - An entry is recorded in `audit_events` (actor user ID, transaction ID, manual rate, original rate, reason).

---

## 4. Exchange Rate Provider Proposals

The system abstracts rate fetching through `server/lib/fxProvider.js`. Today, only `mockProvider` is implemented.

To connect real rates, we propose the following options for the owner's decision:

| Provider | Coverage | Pros | Cons | Recommendation |
|---|---|---|---|---|
| **Option A: Bank Indonesia JISDOR (Jakarta Interbank Spot Dollar Rate)** | USD/IDR, EUR/IDR, SGD/IDR official daily fixing | Official Indonesian regulatory standard; matches Indonesian corporate tax and statutory reporting; free public data | Published once per business day (16:15 WIB); no weekend fixing; does not cover USDT | **Strongly Recommended for Indonesian corporate compliance** |
| **Option B: Open Exchange Rates / ExchangeRate-API** | USD, EUR, SGD, IDR (hourly market rates) | Hourly updates, simple REST API, high uptime, global coverage | Commercial subscription for production volume; not official BI tax rate | Good as secondary/fallback provider |
| **Option C: Hybrid (JISDOR for Fiat + Binance/CoinGecko for USDT)** | JISDOR for USD/EUR/SGD; CoinGecko/Binance public price for USDT/IDR | Combines Indonesian statutory compliance for fiat with accurate market pricing for USDT | Requires handling two API connectors | **Optimal long-term architecture** |

> [!IMPORTANT]
> **Owner Decision Required:** We will NOT connect any external rate provider without explicit owner approval. For local development and test suites, deterministic quotes from `mockProvider` will be used.

---

## 5. Implementation Roadmap & Technical Scope

### 5.1 Server-Side Helpers & Endpoints
1. **Unified Helper `toIdr(amount, currency, date, manualQuote = null)`**:
   - Pure function / service in `server/lib/fxProvider.js` (or `server/lib/fxMath.js`).
   - If `currency === 'IDR'`, returns `{ amount_idr: amount, rate: 1, source: 'identity' }`.
   - If non-IDR, looks up rate for `currency/IDR` on `date`.
   - Returns `{ amount_idr, booked_rate, rate_source, rate_date }`.
2. **Apply to Write Paths**:
   - `POST /api/bank-import/batches/:id/confirm`: Convert `r.amount` using batch currency and row date.
   - `POST /api/transactions/batch`: Convert each transaction if `amount_idr` not provided or recomputed based on `t.currency` and `t.transaction_date`.
   - `PATCH /api/transactions/:id`: Recompute `amount_idr` when `amount`, `currency`, or `transaction_date` is updated.
3. **Unified Pulse & Accounts Aggregations**:
   - `/api/wallets`: Returns native `balance` plus `balance_idr` (valued at today's rate).
   - `/api/pulse`: Computes `totalBalance` by summing IDR balances + foreign balances converted at today's rate.
   - Both match identically.

### 5.2 Frontend UI (Design v2)
1. **`client/src/v2/lib/format.js`**:
   - Enhance `money(val, { currency, ... })` to properly format USD (`$ 1,234.56`), EUR (`€ 1,234.56`), SGD (`S$ 1,234.56`), USDT (`1,234.56 USDT`).
2. **`client/src/v2/pages/Accounts.jsx`**:
   - Display native balance + IDR equivalent for every foreign wallet.
   - Show total company cash in IDR, including converted foreign accounts.
   - Display valuation timestamp badge: *"Valued at today's rate"*.
3. **`client/src/v2/lib/addEntry.js` & `AddEntry.jsx`**:
   - Derive currency from the selected wallet.
   - Support decimal amounts for non-IDR currencies.
4. **`client/src/v2/lib/pulseModel.js`, `radarSeries.js`, `performance.js`**:
   - Convert non-IDR cash flows to IDR using `t.amount_idr` so foreign transactions are no longer omitted from cash flow, runway, and radar forecasts.
5. **Localization**:
   - Translations for all new labels across `en.js`, `ru.js`, `id.js`.

### 5.3 Audit & Historical Data Backfill
1. **Read-Only Detection SQL** (to inspect existing skewed rows):
   ```sql
   SELECT 
     id, business_id, transaction_date, 
     currency_original, amount_original, amount_idr,
     created_at
   FROM transactions
   WHERE currency_original IS NOT NULL 
     AND currency_original <> 'IDR'
     AND amount_idr = amount_original;
   ```
2. **Safe Backfill Script**:
   - Prepared in `scripts/backfill-foreign-currency-idr.js`.
   - Runs in dry-run mode by default.
   - Calculates historical `amount_idr` based on historical rate on `transaction_date`.
   - Only executed upon owner's explicit trigger; NEVER run automatically.

---

## 6. Definition of Done (Verification Checklist)

- [ ] This rules document (`_specs/multicurrency/RULES.md`) is reviewed and approved by the owner.
- [ ] Rate provider choice approved by owner (or confirmed to stay on mock for now).
- [ ] Unit tests pass:
  - `toIdr` conversion and precision tests.
  - Multi-currency wallet balance math.
  - Cross-currency transfer double-leg creation and FX gain/loss.
  - Full existing test suite (`tests/*.test.*`, `tests/design/*.test.mjs`).
- [ ] Verification on test business:
  - Pulse "Cash now" equals Accounts total for a company with mixed IDR and USD wallets.
- [ ] Production safety invariant:
  - For PT Helm Care Indonesia (all IDR wallets), total cash remains exactly `Rp 131,82M`.
- [ ] Pull Request opened with complete report; migration/backfill scripts attached but unapplied.
