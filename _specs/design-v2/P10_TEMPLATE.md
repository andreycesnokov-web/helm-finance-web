# P-10 industry template: category → group (for owner review)

Status: **draft for the owner.** There is no migration and no code for P-10 yet (DECISIONS.md: "the owner first wants to see the industry template"). Nothing in the app reads this file.

Company: the owner's company, with two KBLI codes:

- **81210** — general cleaning of buildings (services).
- **47999** — retail not in stores, other: vending machines.

## What the template does once P-10 is approved

Every cash-flow category gets exactly one **group**. Performance → Profit then adds categories up by group, instead of using the keyword guesser it uses today ("Estimate · counted when money moved").

The groups are the 7 from PROPOSALS.md P-10:

| Group | Meaning | In profit? |
|---|---|---|
| `revenue` | Money earned from customers | Yes, as sales |
| `direct_cost` | Costs that grow with each job or each sale (cost of sales) | Yes, before gross profit |
| `operating_cost` | Running the company, whatever the volume | Yes, after gross profit |
| `asset_purchase` | Buying something that lasts more than a year | No. It goes to the asset register (P-11, not approved yet); only its monthly wear and tear will count |
| `funding` | Loans, owner money in or out, dividends | No |
| `tax` | Company taxes paid to the tax office | No, shown separately (see question Q3) |
| `transfer` | Money moving between our own accounts | No, never counted |

Rules that come with it (accrual, from P-10):

- Revenue counts in the month of the invoice.
- Costs count in the month the bill is received, including unpaid bills.
- An uncategorised record is shown as "N of M records have a category" and is never guessed into profit.

## A. Existing system categories (migration 002) → proposed group

These are the system categories every business already has. Names are as stored (Russian); an English gloss is given for review.

| Category (as stored) | English | Today: flow / activity | Proposed group | Note |
|---|---|---|---|---|
| Перевод между счетами — поступление | Transfer between own accounts (in) | inflow / technical | `transfer` | |
| Перевод между счетами — выбытие | Transfer between own accounts (out) | outflow / technical | `transfer` | |
| Продажи в вендинговых автоматах | Vending machine sales | inflow / operating | `revenue` | 47999 |
| Продажи франшизы | Franchise package sales | inflow / operating | `revenue` | |
| Роялти | Royalties from franchisees | inflow / operating | `revenue` | |
| Паушальный взнос | Franchise entry fee | inflow / operating | `revenue` | Q5 |
| Реклама DOOH | DOOH advertising income | inflow / operating | `revenue` | |
| Прочие поступления | Other income | inflow / operating | `revenue` | Q6 |
| Возвраты от поставщиков | Refunds from suppliers | inflow / operating | `direct_cost` (negative) | Reduces the cost it refunds |
| Возвраты клиентам | Refunds to customers | outflow / operating | `revenue` (negative) | Reduces sales, not a cost |
| Закупка товара | Goods for resale | outflow / operating | `direct_cost` | 47999 stock |
| Транспортные услуги | Transport / delivery | outflow / operating | `direct_cost` | Q4 |
| Эквайринг | Card / QRIS acquiring fees | outflow / operating | `direct_cost` | Paid per sale |
| РКО | Bank account fees | outflow / operating | `operating_cost` | |
| Зарплата производственного персонала | Wages: field and production staff | outflow / operating | `direct_cost` | 81210 cleaners |
| Зарплата административного персонала | Wages: admin staff | outflow / operating | `operating_cost` | |
| Зарплата коммерческого персонала | Wages: sales and marketing | outflow / operating | `operating_cost` | |
| Налоги на ФОТ | Payroll taxes and BPJS | outflow / operating | `operating_cost` | Q3 |
| Обучение персонала | Staff training | outflow / operating | `operating_cost` | |
| Расходы на персонал | Other staff costs | outflow / operating | `operating_cost` | |
| Поиск и найм персонала | Recruiting | outflow / operating | `operating_cost` | |
| Командировочные расходы | Business travel | outflow / operating | `operating_cost` | |
| Оплата рекламных систем | Ad platforms | outflow / operating | `operating_cost` | |
| Маркетинговые подрядчики | Marketing contractors | outflow / operating | `operating_cost` | |
| Административные подрядчики | Admin contractors (accounting, legal) | outflow / operating | `operating_cost` | |
| Электронные подписки | Software subscriptions | outflow / operating | `operating_cost` | |
| Связь и интернет | Phone and internet | outflow / operating | `operating_cost` | |
| Содержание вендинговых автоматов | Vending machine upkeep | outflow / operating | `direct_cost` | 47999 |
| Аренда торговых точек | Rent for machine locations | outflow / operating | `direct_cost` | 47999, Q4 |
| Аренда техники | Equipment rental | outflow / operating | `direct_cost` | 81210 job equipment, Q4 |
| Содержание офиса | Office running costs | outflow / operating | `operating_cost` | |
| Хоз. инвентарь | Household supplies | outflow / operating | `operating_cost` | Q4: cleaning chemicals used on jobs would be `direct_cost` |
| Аренда офиса | Office rent | outflow / operating | `operating_cost` | |
| Ремонт и содержание офиса | Office repairs | outflow / operating | `operating_cost` | |
| Оргтехника | Office equipment | outflow / operating | `operating_cost` or `asset_purchase` | Q2 |
| Покупка наличности | Cash bought (cash withdrawal) | outflow / operating | `transfer` | Cash moves to the cash box; nothing is spent |
| Выплата франчайзи | Payouts to franchisees | outflow / operating | `direct_cost` | |
| Продажа ОС | Sale of fixed assets | inflow / investing | `asset_purchase` (negative) | Q7 |
| Возврат кредитов и займов | Loans repaid to us | inflow / investing | `funding` | |
| Прочие инвестиционные доходы | Other investment income | inflow / investing | `revenue` | Q6: "other income" line |
| Покупка ОС | Purchase of fixed assets | outflow / investing | `asset_purchase` | |
| Ремонт ОС | Repair of fixed assets | outflow / investing | `operating_cost` | Q2 |
| Получение кредитов и займов | Loans received | inflow / financing | `funding` | |
| Вклад собственника | Owner contribution | inflow / financing | `funding` | Never linked to Personal until the bridge is approved |
| Оплаты по кредитам и займам | Loan repayments | outflow / financing | `funding` | Q1: interest |
| Дивиденды | Dividends | outflow / financing | `funding` | |

## B. Categories the template would add for these KBLI codes

These are new rows the template would offer when the business has the KBLI code. Each is a suggestion; the owner may switch any of them off.

### KBLI 81210 — building cleaning services

| Proposed category | Group | Why |
|---|---|---|
| Cleaning service income | `revenue` | Contract and one-off cleaning invoices |
| Cleaning supplies used on jobs (chemicals, cloths, bags) | `direct_cost` | Grows with each job |
| Subcontracted cleaners | `direct_cost` | Labour bought per job |
| Transport to client sites | `direct_cost` | Per-job travel |
| Uniforms and safety equipment | `direct_cost` | Per cleaner; small items |
| Cleaning machines (scrubbers, vacuums) | `asset_purchase` | Lasts more than a year (Q2) |
| Machine servicing and spare parts | `operating_cost` | |

### KBLI 47999 — vending machines

| Proposed category | Group | Why |
|---|---|---|
| Vending sales (cash) | `revenue` | Collected from the machine |
| Vending sales (QRIS / card) | `revenue` | Settled by the gateway |
| Stock for machines | `direct_cost` | Same as Закупка товара; kept as one category if preferred |
| Cash collection and machine refilling | `direct_cost` | Per route / visit |
| Site rent and revenue share to the location owner | `direct_cost` | Paid per machine location |
| Gateway and QRIS fees | `direct_cost` | Same as Эквайринг |
| Vending machines | `asset_purchase` | Lasts more than a year |
| Machine repairs and parts | `operating_cost` | |

## Questions for the owner

- **Q1 — Loan interest.** Loan repayments mix principal and interest. Principal is `funding`. Interest is a cost of the business. Should interest get its own category (`operating_cost`, shown as "interest" under profit), or stay inside repayments until a loan register exists (P-03)?
- **Q2 — Where does an asset start?** Proposal: a single item over **Rp 5,000,000** that lasts more than a year is `asset_purchase`; anything smaller is `operating_cost`. The accountant should confirm the threshold. Should Оргтехника and Ремонт ОС follow this rule?
- **Q3 — Taxes.** Proposal:
  - Employer BPJS and payroll costs are `operating_cost`.
  - PPh 21 withheld from staff belongs to the employee, so it is part of the wage, not company tax.
  - Corporate income tax (PPh 25/29) and final tax (PPh 4(2)) are `tax`, shown below operating profit.
  - VAT (PPN) is not a cost.

  Do you agree?
- **Q4 — Direct versus operating.** For a cleaning job: transport, equipment rental and cleaning chemicals are counted as `direct_cost`, so gross margin per contract is meaningful. For vending: site rent is counted as `direct_cost`. Is that how you think about margin?
- **Q5 — Franchise entry fee.** Count it as revenue when invoiced (proposal), or spread it over the contract term? Spreading needs the accountant and a later rule.
- **Q6 — Other income.** Keep Прочие поступления and Прочие инвестиционные доходы inside `revenue`, or show them as "other income" under operating profit? The proposal is to keep 7 groups and label them "other income" on screen.
- **Q7 — Selling an asset.** The sale price reduces `asset_purchase`, and the gain or loss is worked out by the accountant at close. Is that acceptable until the asset register (P-11) exists?

## What happens after review

1. The owner marks changes in this file, or answers Q1–Q7.
2. A P-10 batch is then written. It contains:
   - one additive migration: `cashflow_categories.pnl_group` (nullable, CHECK on the 7 groups) and `industry_templates`;
   - tests on the profit formulas;
   - the template seeded only as **suggestions** that the owner confirms per business.

   Until confirmed, Performance keeps today's estimate. Pulse and AI CFO figures do not change, because they keep using the keyword classifier, as PROPOSALS.md requires.
