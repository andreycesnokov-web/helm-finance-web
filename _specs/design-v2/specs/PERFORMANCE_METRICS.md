# Performance metrics: how CFO AI counts profit and cash

Workspace: Business only. Personal never feeds these numbers.

## Two views, never mixed
- **Cash view (Pulse, Radar):** money that actually moved. This view drives runway and burn.
- **Profit view (Performance → Profit):** accrual basis.
  - Revenue counts in the month it is invoiced or delivered.
  - Costs count in the month the goods or service arrive, including unpaid bills.
  - It shows as **Estimate** until the accountant closes the month.

## Category groups
Every category belongs to exactly one group: Revenue · Direct cost · Operating cost · Asset purchase · Funding · Tax · Transfer.
- The industry template is chosen from the KBLI codes, for example:
  - Restaurant: food and drink cost is a direct cost.
  - Rental business: property upkeep and agent fees.
  - Developer: land and construction, with revenue recognised at handover.
- Coverage is shown openly, e.g. "39 of 41 records have a category".

## Formulas
- Gross profit = Revenue − Direct costs. Margin = Gross profit / Revenue.
- EBITDA = Gross profit − Operating costs.
- Net profit = EBITDA − Depreciation (from the asset register) − Interest (from Funding loans) − Income tax (zero on a loss).
- Operating cash flow = Net profit + Depreciation − increase in receivables + increase in payables.
- Free cash flow = Operating cash flow − Equipment bought.
- Burn = average of (operating cash flow + equipment bought) over the last 3 months.
- Runway (Pulse) = Cash now ÷ Burn × 30 days.
- Cash-out date (Forecast tab):
  - Uses the Radar 30-day forecast, which includes known receivables and payables.
  - Months after that use the average burn and known loan repayments.

## Rules
- Equipment over Rp 5M becomes an asset and is depreciated over its useful life.
- Loans, investor money and internal transfers are never revenue or cost.
- Taxes withheld for others (PPh 21, PPh 23, PPh 4(2)) are not the company's cost.
- Suppliers and landlords are paid net of withholding.
- The withheld tax is a separate payment on the 15th of the next month.
- The withholding slip (bukti potong) is made before that payment.

## Screens
- Performance tabs:
  - Profit: KPIs, 12-month revenue/gross profit and EBITDA/net profit charts, monthly waterfall, cost lines.
  - Cash: cash flow chart, month-end cash, burn and runway, profit-to-cash bridge.
  - Forecast: weekly receivables and payables, 3-month cash.
- A phone version is included.
