# 03 — Chart of accounts specification (proposal, not implemented)

**Proposal:** every company gets its own chart of accounts, copied from a versioned system template and extended by
the company or its accountant. Accounts carry a stable internal key so posting rules never depend on a code or a
name. The reporting framework (SAK Indonesia, SAK EP or SAK EMKM) is a per-company setting confirmed by the
accountant; the chart does not assume one.

## 1. Indonesian reporting frameworks (official sources)

| Framework | Who | Status | Source |
|---|---|---|---|
| Kerangka Standar Pelaporan Keuangan Indonesia (four pillars) | all | approved by DSAK IAI 12 Dec 2022, effective 1 Jan 2024; pillar 1 SAK Internasional, pillar 2 SAK Indonesia, pillar 3 SAK Indonesia untuk Entitas Privat (EP) / ETAP, pillar 4 SAK EMKM | [IAI — Kerangka SPKI](https://web.iaiglobal.or.id/SAK-IAI/Kerangka%20Standar%20Pelaporan%20Keuangan%C2%A0Indonesia) |
| SAK Indonesia (pillar 2) | entities with public accountability, entities under the capital-market regulator | IFRS-based PSAK/ISAK | same |
| SAK EP (pillar 3) | entities **without public accountability** that publish general-purpose statements; an entity with public accountability only if its regulator allows | approved 30 Jun 2021, effective 1 Jan 2025, replaces SAK ETAP, based on IFRS for SMEs, early adoption from 2022 with disclosure | [IAI — SAK EP](https://web.iaiglobal.or.id/Berita-IAI/detail/standar_akuntansi_keuangan_indonesia_untuk_entitas_privat), [IAI — Produk SAK EP disahkan](https://web.iaiglobal.or.id/SAK-IAI/Produk%20SAK%20Entitas%20Privat%20Disahkan) |
| SAK EMKM (pillar 4) | micro/small/medium entities meeting the UMKM criteria | approved 24 Oct 2016, effective 1 Jan 2018, historical cost | [IAI — SAK EMKM](https://web.iaiglobal.or.id/Berita-IAI/detail/standar_akuntansi_keuangan_indonesia_untuk_entitas_mikro_kecil_dan_menengah) |

Consequences for the design:

- **PT PMA ≠ a framework.** Foreign ownership does not decide the standard; public accountability, the regulator and
  group reporting needs do. A typical private PT PMA without public accountability would use SAK EP; one consolidated
  into a listed parent may choose SAK Indonesia. The IAI page maps entity types to pillars in an image table, so the
  final per-company choice is the accountant's. The product stores it, never infers it.
- New company setting `reporting_framework` ∈ `sak_indonesia | sak_ep | sak_emkm | not_confirmed` (default
  `not_confirmed`; accounting reports then carry "framework not confirmed").
- The chart is framework-neutral. Framework-specific policies (depreciation method and lives, inventory method,
  employee-benefit measurement) are company accounting policies, not account definitions.

## 2. Bookkeeping language and currency

- Default: bookkeeping in **Rupiah and Bahasa Indonesia**; English and US dollars only with the Minister of Finance's
  permission — UU KUP art. 28 as amended by UU HPP (UU 7/2021); PMK 81/2024 art. 455(3); permitted taxpayers pay
  PPh 25/29 and related assessments in USD (PMK 81/2024 art. 106(2)). Source:
  [DJP — izin pembukuan dalam dolar AS](https://www.pajak.go.id/id/artikel/memiliki-izin-pembukuan-dalam-mata-uang-dolar-amerika-serikat-perhatikan-cara-pembayaran)
  (DJP staff article, 6 Feb 2026).
- Design: company `functional_currency` (IDR default; USD only when `usd_bookkeeping_permit` is recorded with its
  decision number and date). All journal balancing happens in the functional currency. Account names are stored in
  Indonesian, English and Russian (`name_i18n`); Indonesian is the statutory name.

## 3. Tax facts the chart must be able to hold (rates are NOT in the chart)

- PPN: 12% rate; for goods and services that are not luxury, the base is "nilai lain" 11/12 of the price (effective
  11%) — PMK 131/2024. [DJP — PMK 131/2024](https://pajak.go.id/index.php/id/artikel/pmk-1312024-tarif-ppn-sebelas-dua-belas)
- PPh 21: monthly withholding by TER categories A/B/C, December true-up — PP 58/2023, PMK 168/2023.
  [PMK 168/2023 (pajak.go.id)](https://pajak.go.id/sites/default/files/2024-02/PMK%20168%20Tahun%202023%20Tentang%20PPh%20Pasal%2021%20TER.pdf)
- Rates and applicability live only in verified `tax_rules` versions (today: 3 deadline rules, parameters not defined,
  unverified). Posting rules take tax **amounts** from accountant-reviewed `tax_treatments` / payroll runs; they never
  compute a rate.

## 4. Schema proposal (no tables created)

```sql
-- System templates: versioned, read-only for companies.
gl_account_templates (
  template_code text, template_version int, account_key text,          -- e.g. 'id_pt_default', 1, 'ar_trade'
  code text, name_i18n jsonb,                                           -- {"id":…,"en":…,"ru":…}
  account_class text, account_subtype text, normal_balance text,       -- see §5
  parent_key text, is_postable boolean, control_kind text,
  PRIMARY KEY (template_code, template_version, account_key))

-- Company chart.
gl_accounts (
  id uuid PK, business_id uuid NOT NULL REFERENCES businesses,
  account_key text,            -- stable internal identifier; unique per business when not null
  code text NOT NULL,          -- unique per business; immutable after the first posting
  name_i18n jsonb NOT NULL,
  account_class text NOT NULL CHECK (account_class IN
    ('asset','liability','equity','revenue','cost_of_sales','operating_expense','other_income','other_expense')),
  account_subtype text,        -- current_asset, fixed_asset, contra_asset, tax_payable, income_tax, …
  normal_balance text NOT NULL CHECK (normal_balance IN ('debit','credit')),
  parent_id uuid REFERENCES gl_accounts,  -- same business (trigger)
  is_postable boolean NOT NULL DEFAULT true,          -- headers are not postable
  control_kind text,           -- bank | ar | ap | ppn_in | ppn_out | pph_prepaid | pph_payable | payroll_payable |
                               -- bpjs_payable | retained_earnings | current_year_earnings | opening_equity |
                               -- suspense | fx_unrealised | accumulated_depreciation | due_from_shareholder | …
  wallet_id uuid UNIQUE REFERENCES wallets,           -- one bank/cash account per wallet
  currency text,               -- set for bank accounts and foreign-currency AR/AP; NULL = functional currency
  is_active boolean NOT NULL DEFAULT true,
  template_code text, template_version int,
  created_by_user_id bigint, created_at timestamptz, deactivated_at timestamptz,
  UNIQUE (business_id, code), UNIQUE (business_id, account_key))

-- Mapping from the categories people already use (one confirmed account per category and direction).
gl_category_accounts (
  business_id uuid, cashflow_category_id uuid, direction text CHECK (direction IN ('in','out')),
  account_id uuid NOT NULL, confirmed_by_user_id bigint, confirmed_at timestamptz,
  PRIMARY KEY (business_id, cashflow_category_id, direction))
```

Rules enforced in the database (triggers):

- an account with posted lines cannot be deleted; its `code`, `account_class` and `normal_balance` cannot change;
  it can be deactivated (no new postings) and renamed (name history in `audit_events`);
- `parent_id`, `wallet_id` and mapped categories must belong to the same business;
- a header (`is_postable = false`) never receives a line; control accounts (`ar`, `ap`, `bank`, tax, payroll) accept
  postings only from the posting engine, never from a manual journal unless the line names the subledger item;
- one `current_year_earnings` account per company, computed in reports, never posted.

## 5. Default chart `id_pt_default` v1 (proposal for accountant review)

Codes follow the common Indonesian 1–9 layout. Bank accounts are created one per wallet under 1-1200.
Every account name has ID / EN / RU; ID and EN shown.

| Code | Key | Indonesian | English | Class / subtype | Normal | Control |
|---|---|---|---|---|---|---|
| 1-0000 | assets | ASET | ASSETS | asset (header) | D | |
| 1-1100 | cash_on_hand | Kas | Cash on hand | asset / current | D | bank (petty-cash wallet) |
| 1-1200 | banks | Bank | Bank accounts (one child per wallet) | asset / current (header) | D | |
| 1-1290 | cash_in_transit | Kas dalam perjalanan | Cash in transit | asset / current | D | |
| 1-1300 | ar_trade | Piutang usaha | Trade receivables | asset / current | D | ar |
| 1-1310 | ar_allowance | Cadangan kerugian piutang | Allowance for doubtful receivables | asset / contra | C | |
| 1-1350 | due_from_shareholders | Piutang pemegang saham | Due from shareholders | asset / current | D | due_from_shareholder |
| 1-1360 | due_from_related | Piutang pihak berelasi | Due from related parties | asset / current | D | |
| 1-1370 | employee_advances | Uang muka karyawan | Employee advances | asset / current | D | |
| 1-1400 | inventory | Persediaan | Inventory | asset / current | D | |
| 1-1500 | prepaid_expenses | Biaya dibayar di muka | Prepaid expenses | asset / current | D | |
| 1-1510 | supplier_advances | Uang muka pembelian | Advances to suppliers | asset / current | D | |
| 1-1610 | ppn_input | PPN Masukan | VAT input | asset / prepaid tax | D | ppn_in |
| 1-1620 | pph22_prepaid | PPh 22 dibayar di muka | Prepaid PPh 22 | asset / prepaid tax | D | pph_prepaid |
| 1-1630 | pph23_prepaid | PPh 23 dibayar di muka | Prepaid PPh 23 (withheld by customers) | asset / prepaid tax | D | pph_prepaid |
| 1-1640 | pph25_prepaid | PPh 25 dibayar di muka | Prepaid PPh 25 instalments | asset / prepaid tax | D | pph_prepaid |
| 1-1650 | tax_deposit | Deposit pajak | Tax deposit | asset / prepaid tax | D | |
| 1-2100 | land | Tanah | Land | asset / fixed | D | |
| 1-2200 | buildings | Bangunan | Buildings | asset / fixed | D | |
| 1-2300 | machinery | Mesin dan peralatan | Machinery and equipment | asset / fixed | D | |
| 1-2400 | vehicles | Kendaraan | Vehicles | asset / fixed | D | |
| 1-2500 | office_equipment | Peralatan kantor | Office and IT equipment | asset / fixed | D | |
| 1-2600 | accum_depreciation | Akumulasi penyusutan | Accumulated depreciation (child per asset class) | asset / contra | C | accumulated_depreciation |
| 1-2700 | intangibles | Aset takberwujud | Intangible assets | asset / non-current | D | |
| 1-2710 | accum_amortisation | Akumulasi amortisasi | Accumulated amortisation | asset / contra | C | |
| 1-2800 | deposits_long | Uang jaminan | Security deposits | asset / non-current | D | |
| 2-0000 | liabilities | LIABILITAS | LIABILITIES | liability (header) | C | |
| 2-1100 | ap_trade | Utang usaha | Trade payables | liability / current | C | ap |
| 2-1200 | accrued_expenses | Beban akrual | Accrued expenses | liability / current | C | |
| 2-1300 | customer_advances | Uang muka pelanggan | Customer advances | liability / current | C | |
| 2-1310 | deferred_revenue | Pendapatan diterima di muka | Deferred revenue | liability / current | C | |
| 2-1400 | salaries_payable | Utang gaji | Salaries payable | liability / current | C | payroll_payable |
| 2-1410 | bpjs_kes_payable | Utang BPJS Kesehatan | BPJS Health payable | liability / current | C | bpjs_payable |
| 2-1420 | bpjs_tk_payable | Utang BPJS Ketenagakerjaan | BPJS Employment payable | liability / current | C | bpjs_payable |
| 2-1510 | ppn_output | PPN Keluaran | VAT output | liability / tax | C | ppn_out |
| 2-1520 | ppn_payable | Utang PPN | VAT payable (net, after period offset) | liability / tax | C | |
| 2-1530 | pph21_payable | Utang PPh 21 | PPh 21 payable | liability / tax | C | pph_payable |
| 2-1540 | pph23_payable | Utang PPh 23 | PPh 23 withheld from suppliers | liability / tax | C | pph_payable |
| 2-1550 | pph4_2_payable | Utang PPh 4 ayat 2 | PPh 4(2) final tax payable | liability / tax | C | pph_payable |
| 2-1560 | pph26_payable | Utang PPh 26 | PPh 26 payable | liability / tax | C | pph_payable |
| 2-1570 | cit_payable | Utang PPh badan | Corporate income tax payable | liability / tax | C | |
| 2-1600 | short_term_loans | Utang bank jangka pendek | Short-term bank loans | liability / current | C | |
| 2-1610 | current_portion_ltd | Bagian lancar utang jangka panjang | Current portion of long-term loans | liability / current | C | |
| 2-1700 | due_to_shareholders | Utang pemegang saham | Due to shareholders (founder loans) | liability / current | C | |
| 2-1710 | due_to_related | Utang pihak berelasi | Due to related parties | liability / current | C | |
| 2-1800 | interest_payable | Utang bunga | Interest payable | liability / current | C | |
| 2-2100 | long_term_loans | Utang bank jangka panjang | Long-term bank loans | liability / non-current | C | |
| 2-2300 | employee_benefits | Liabilitas imbalan kerja | Employee benefit obligation | liability / non-current | C | |
| 3-0000 | equity | EKUITAS | EQUITY | equity (header) | C | |
| 3-1000 | share_capital | Modal disetor | Paid-in share capital | equity | C | |
| 3-1100 | apic | Tambahan modal disetor | Additional paid-in capital | equity | C | |
| 3-1200 | capital_deposits | Uang muka setoran modal | Capital contributions not yet issued as shares | equity | C | |
| 3-2000 | retained_earnings | Saldo laba | Retained earnings | equity | C | retained_earnings |
| 3-2100 | current_year_earnings | Laba tahun berjalan | Current-year profit (computed, not postable) | equity | C | current_year_earnings |
| 3-3000 | dividends | Dividen | Dividends declared | equity / contra | D | |
| 3-9000 | opening_equity | Ekuitas saldo awal | Opening balance equity (temporary, cleared by the accountant) | equity | C | opening_equity |
| 4-1000 | sales_goods | Penjualan barang | Sales of goods | revenue | C | |
| 4-2000 | service_revenue | Pendapatan jasa | Service revenue | revenue | C | |
| 4-9000 | sales_returns | Retur dan potongan penjualan | Sales returns and discounts | revenue / contra | D | |
| 5-1000 | cogs | Harga pokok penjualan | Cost of goods sold | cost_of_sales | D | |
| 5-2000 | cost_of_services | Beban pokok jasa | Cost of services (subcontractors, direct labour) | cost_of_sales | D | |
| 6-1000 | salaries_expense | Beban gaji | Salaries and wages | operating_expense | D | |
| 6-1100 | employer_bpjs | Beban BPJS perusahaan | Employer BPJS contributions | operating_expense | D | |
| 6-1200 | employee_benefits_exp | Beban imbalan kerja | Employee benefits | operating_expense | D | |
| 6-2000 | rent | Beban sewa | Rent | operating_expense | D | |
| 6-2100 | utilities | Beban listrik dan air | Utilities | operating_expense | D | |
| 6-2200 | telecom | Beban telepon dan internet | Telecom and internet | operating_expense | D | |
| 6-3000 | marketing | Beban pemasaran | Marketing | operating_expense | D | |
| 6-4000 | professional_fees | Beban jasa profesional | Professional fees | operating_expense | D | |
| 6-4100 | software | Beban langganan perangkat lunak | Software subscriptions | operating_expense | D | |
| 6-5000 | travel | Beban perjalanan dinas | Travel | operating_expense | D | |
| 6-5100 | office_supplies | Beban perlengkapan kantor | Office supplies | operating_expense | D | |
| 6-6000 | depreciation | Beban penyusutan | Depreciation | operating_expense | D | |
| 6-6100 | amortisation | Beban amortisasi | Amortisation | operating_expense | D | |
| 6-7000 | bank_charges | Beban administrasi bank | Bank charges | operating_expense | D | |
| 6-7100 | gateway_fees | Beban payment gateway | Payment gateway fees | operating_expense | D | |
| 6-8000 | taxes_licences | Beban pajak dan perizinan | Non-income taxes and licences | operating_expense | D | |
| 6-9000 | other_opex | Beban operasional lainnya | Other operating expenses | operating_expense | D | |
| 7-1000 | interest_income | Pendapatan bunga | Interest income (jasa giro) | other_income | C | |
| 7-2000 | fx_realised | Laba (rugi) selisih kurs terealisasi | FX gain/loss — realised | other_income | C | |
| 7-2100 | fx_unrealised | Laba (rugi) selisih kurs belum terealisasi | FX gain/loss — unrealised | other_income | C | fx_unrealised |
| 7-9000 | other_income | Pendapatan lain-lain | Other income | other_income | C | |
| 8-1000 | interest_expense | Beban bunga | Interest expense | other_expense | D | |
| 8-2000 | final_tax_interest | PPh final atas bunga | Final tax on interest income | other_expense | D | |
| 8-9000 | other_expense | Beban lain-lain | Other expenses | other_expense | D | |
| 9-1000 | income_tax_expense | Beban pajak penghasilan | Income tax expense | other_expense / income_tax | D | |
| 9-9999 | suspense | Akun penampung | Suspense (must be zero at close) | asset / clearing | D | suspense |

## 6. Mapping from existing CFO AI data

| Existing signal | Default account (proposal, confirmed per company) |
|---|---|
| wallet | its own bank / cash account (created with the wallet, `control_kind = bank`) |
| `pnl_group = revenue` | 4-2000 (or 4-1000 per category) |
| `direct_cost` | 5-2000 (or 5-1000) |
| `operating_cost` | per category: salaries 6-1000, rent 6-2000, …; otherwise 6-9000 |
| `other_income` | 7-9000 |
| `interest` | 8-1000 (expense) / 7-1000 (income) |
| `tax` | **not an expense by default**: tax payments settle a liability (2-15xx) or a prepayment (1-16xx); each needs its obligation, so unlinked tax payments post to suspense with a review item |
| `asset_purchase` | the asset's class account (1-21xx … 1-25xx); with an `assets` row it uses the asset's class |
| `funding` | from the funding register: `equity` → 3-1000 / 3-1200, founder loan → 2-1700, bank loan → 2-1600 / 2-2100; without a register row → suspense |
| `transfer` | no P&L account: transfer posting between two bank accounts |
| purpose `personal` | 1-1350 Due from shareholders (accountant may reclassify to dividends or employee benefit — a tax matter) |
| purpose `capital` | fixed-asset class account |
| purpose `non_pnl` | suspense until the accountant names the balance-sheet account |
| purpose `needs_review` / no mapping | 9-9999 suspense |

The current system category templates (`cashflow_categories` with `business_id IS NULL`) are Russian-language and
specific to a vending/franchise business; they are not a neutral basis for Indonesian companies. The Indonesian chart
is therefore a new template; category→account suggestions are proposals a person confirms.

## 7. Company customisation rules

1. A company may add accounts under any postable class header, choose its own codes within the class prefix, rename,
   and deactivate unused accounts.
2. It may not delete an account with postings, change its class or normal balance, or post to headers.
3. System keys (`ar_trade`, `ppn_output`, …) cannot be removed while a posting rule refers to them; the company may
   rename them.
4. Template upgrades never overwrite a company chart: new template accounts are offered, not forced.
5. Every chart change is an `audit_events` row.
