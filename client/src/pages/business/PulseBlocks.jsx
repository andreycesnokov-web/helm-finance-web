// Financial Pulse Dashboard v1 — presentation blocks.
//
// HONESTY RULES THIS FILE ENFORCES:
//   • Every figure shown is a value the backend already returns from GET /api/pulse, or a
//     count from GET /api/business/financial-counts. Nothing is derived into a new
//     accounting metric on the client.
//   • Metrics the ledger cannot support (EBITDA, CAPEX, gross profit, net profit) are NOT
//     approximated. They render as readiness cards that state what is missing.
//   • The only client-side arithmetic is presentational: comparing two figures the API
//     already returned (receivables vs payables) and counting non-zero data sources.
//
// NAMING: what the API calls `expenses` is shown as "Operating cash out", because
// CASH_OUT_LEGACY = ['expense','payroll'] — bank, FX and network fees are classed as
// 'fee' and are NOT included. The helper text says so rather than quietly mislabelling it
// as total operating expenses. The backend formula is unchanged.
//
// EMPTY WORKSPACE: an account with no data is the FIRST impression, so it is designed, not
// defaulted. Zeros stay honest (Rp 0 is the true balance) but recede, and the page leads
// with what to do next instead of a grid of dashes.
import { Card, StatusBadge, Btn, Icon, DataList } from '../../shell/ui'
import './Pulse.css'

/* ── executive hero ───────────────────────────────────────────────────────── */

export function ExecutiveHero({ d, idr, readiness, empty }) {
  const runway = d.runway === 999 || d.runway == null ? null : Number(d.runway)
  const tiles = [
    { key: 'revenue', label: 'Revenue this month', value: '+ ' + idr(d.income), tone: 'pos',
      hint: 'Money received this month' },
    { key: 'outflow', label: 'Operating cash out', value: '− ' + idr(d.expenses), tone: 'neg',
      hint: 'Expenses and payroll · excludes bank, FX and network fees' },
    { key: 'net', label: 'Net position', value: idr(d.netPosition),
      tone: Number(d.netPosition) >= 0 ? 'pos' : 'neg',
      hint: 'Cash + receivables − payables' },
    { key: 'runway', label: 'Runway', value: runway === null ? '—' : `${runway} days`,
      tone: runway !== null && runway < 30 ? 'neg' : undefined,
      hint: runway === null ? 'Needs expense history' : `At ${idr(d.burnRate)}/day · ${d.burnWindowDays || 30}d window` },
  ]
  return (
    <section className={`pulse-hero${empty ? ' is-empty' : ''}`}>
      <div className="pulse-hero-main">
        <div className="pulse-hero-top">
          <span className="pulse-hero-label">Total cash · IDR</span>
          {readiness}
        </div>
        <div className="pulse-hero-value">{idr(d.totalBalance)}</div>
        <div className="pulse-hero-meta">
          {empty
            ? 'No accounts connected yet — this updates the moment you add one.'
            : 'Confirmed cash across all business accounts'}
        </div>
      </div>
      <div className="pulse-hero-tiles">
        {tiles.map((t) => (
          <div key={t.key} className="pulse-tile">
            <span className="pulse-tile-label">{t.label}</span>
            {/* Zeros stay truthful but stop competing for attention while empty. */}
            <span className={`pulse-tile-value ${empty ? 'is-muted' : (t.tone || '')}`}>{t.value}</span>
            <span className="pulse-tile-hint">{t.hint}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ── empty-workspace callout ──────────────────────────────────────────────── */

const FIRST_STEPS = [
  { key: 'wallet', label: 'Add business wallet', sub: 'Bank, cash, e-wallet or gateway', icon: 'wallet', to: '/business/accounts', primary: true },
  { key: 'transaction', label: 'Add transaction', sub: 'Record money in or out', icon: 'list', to: '/business/transactions' },
  { key: 'document', label: 'Upload document', sub: 'Invoice, receipt or contract', icon: 'doc', to: '/business/documents' },
  { key: 'provider', label: 'Connect payment provider', sub: 'Route incoming payments', icon: 'link', to: '/business/payment-connections' },
]

/**
 * Shown only when the workspace genuinely has no data. It is the page's lead: the numbers
 * above are all legitimately zero, so the useful thing to say is what unlocks them.
 */
export function EmptyWorkspaceCallout({ navigate }) {
  return (
    <section className="pulse-start">
      <div className="pulse-start-head">
        <span className="pulse-start-ic"><Icon.play width="20" height="20" aria-hidden="true" /></span>
        <div>
          <h2 className="pulse-start-title">Your finance workspace is ready</h2>
          <p className="pulse-start-sub">
            Add the first data source to unlock CFO insights. Cash, runway and working capital
            start calculating as soon as there is something to calculate from — nothing here is
            estimated in the meantime.
          </p>
        </div>
      </div>
      <div className="pulse-start-grid">
        {FIRST_STEPS.map((a) => {
          const C = Icon[a.icon] || Icon.dot
          return (
            <button key={a.key} type="button"
              className={`pulse-start-action${a.primary ? ' is-primary' : ''}`}
              onClick={() => navigate(a.to)}>
              <span className="pulse-start-action-ic"><C width="18" height="18" aria-hidden="true" /></span>
              <span className="pulse-start-action-text">
                <span className="pulse-start-action-label">
                  {a.label}
                  {a.primary && <em>Start here</em>}
                </span>
                <span className="pulse-start-action-sub">{a.sub}</span>
              </span>
              <Icon.chev width="15" height="15" className="pulse-action-chev" aria-hidden="true" />
            </button>
          )
        })}
      </div>
    </section>
  )
}

/* ── financial trends (chart-ready placeholders) ──────────────────────────── */

/**
 * An empty chart FRAME — grid, axis and month slots, drawn from nothing.
 *
 * There is deliberately no data path: not a flat line, not a sample series, not a
 * shimmer pretending to be values. A placeholder that looks like a plotted line is
 * indistinguishable from real data at a glance, and this is a finance product. The frame
 * shows where the chart will live; the caption says what unlocks it.
 */
function ChartFrame({ variant = 'line' }) {
  const cols = 6
  return (
    <svg className="pulse-trend-svg" viewBox="0 0 320 104" preserveAspectRatio="none"
      role="presentation" aria-hidden="true" focusable="false">
      {/* horizontal gridlines */}
      {[20, 44, 68].map((y) => (
        <line key={y} x1="26" y1={y} x2="316" y2={y} className="pulse-trend-grid" strokeDasharray="3 5" />
      ))}
      {/* axes */}
      <line x1="26" y1="8" x2="26" y2="88" className="pulse-trend-axis" />
      <line x1="26" y1="88" x2="316" y2="88" className="pulse-trend-axis" />
      {variant === 'bars' ? (
        // Receivables vs Payables is a comparison, so its frame is bar-shaped.
        [0, 1].map((i) => (
          <rect key={i} x={70 + i * 110} y="36" width="80" height="52" rx="5"
            className="pulse-trend-slot" />
        ))
      ) : (
        // month slots along the axis — where columns/points will land
        Array.from({ length: cols }).map((_, i) => (
          <line key={i} x1={26 + ((i + 1) * (290 / (cols + 1)))} y1="86" x2={26 + ((i + 1) * (290 / (cols + 1)))} y2="92"
            className="pulse-trend-axis" />
        ))
      )}
    </svg>
  )
}

// Each card names the chart, and says exactly what has to exist before it can be drawn.
const TRENDS = [
  { key: 'revenue', title: 'Revenue trend', variant: 'line',
    empty: 'Appears after transactions or invoices are recorded.' },
  { key: 'outflow', title: 'Operating cash out trend', variant: 'line',
    empty: 'Appears after expenses or payroll are recorded.' },
  { key: 'runway', title: 'Cash runway forecast', variant: 'line',
    empty: 'Appears after a cash balance and expense history both exist.' },
  { key: 'workingcap', title: 'Receivables vs payables', variant: 'bars',
    empty: 'Appears after invoices or debts are added.' },
]

/**
 * Trends are not rendered from live figures because no endpoint returns monthly history —
 * `/api/pulse` is a single point in time. Aggregating a trend client-side would mean
 * refetching the whole ledger and reimplementing the revenue/expense definitions in the
 * browser, so the reason shown changes with the situation rather than the chart being faked.
 */
export function TrendsSection({ empty }) {
  return (
    <section className="pulse-trends">
      <div className="pulse-trends-head">
        <div>
          <h2 className="pulse-trends-title">Financial trends</h2>
          <p className="pulse-trends-sub">
            Pulse will show trends once the system has enough monthly history. We do not
            estimate trends from incomplete data.
          </p>
        </div>
        <StatusBadge tone="neutral">Needs monthly history</StatusBadge>
      </div>
      <div className="pulse-trends-grid">
        {TRENDS.map((t) => (
          <article key={t.key} className="pulse-trend">
            <header className="pulse-trend-top">
              <h3 className="pulse-trend-name">{t.title}</h3>
            </header>
            <div className="pulse-trend-frame">
              <ChartFrame variant={t.variant} />
              <span className="pulse-trend-caption">
                {empty ? t.empty : 'Trend endpoint required: /api/pulse/trends'}
              </span>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

/* ── data readiness ───────────────────────────────────────────────────────── */

/**
 * Factual, not scored: how many of the four data sources this workspace actually has, and
 * the real counts behind each. No weighting, no invented "confidence percentage".
 */
export function readinessOf(counts) {
  const c = counts || {}
  const sources = [
    { key: 'wallets', label: 'Accounts', n: Number(c.wallets || 0), to: '/business/accounts', unlocks: 'Total cash' },
    { key: 'transactions', label: 'Transactions', n: Number(c.transactions || 0), to: '/business/transactions', unlocks: 'Revenue, cash out, runway' },
    { key: 'debts', label: 'Receivables & payables', n: Number(c.debts || 0), to: '/business/receivables', unlocks: 'Working capital, net position' },
    { key: 'bank_import_batches', label: 'Bank imports', n: Number(c.bank_import_batches || 0), to: '/business/bank-import', unlocks: 'Faster transaction entry' },
  ]
  const present = sources.filter((s) => s.n > 0).length
  return { sources, present, total: sources.length }
}

// Setup progress, not an alarm: an empty workspace is a normal starting point, so 0/4 is
// neutral rather than a warning.
export function ReadinessBadge({ readiness, loading }) {
  if (loading) return null
  const { present, total } = readiness
  return (
    <StatusBadge tone={present === total ? 'success' : 'neutral'}>
      {present} of {total} sources connected
    </StatusBadge>
  )
}

export function ReadinessPanel({ readiness, loading, navigate }) {
  if (loading) return null
  const { sources, present, total } = readiness
  const pct = total ? Math.round((present / total) * 100) : 0
  return (
    <Card title="Setup progress">
      <div className="pulse-progress">
        <div className="pulse-progress-head">
          <span className="pulse-progress-count">{present} of {total} data sources connected</span>
          <span className="pulse-progress-pct">{pct}%</span>
        </div>
        <span className="pulse-progress-bar" role="progressbar" aria-valuenow={present}
          aria-valuemin={0} aria-valuemax={total} aria-label="Data sources connected">
          <span className="pulse-progress-fill" style={{ width: `${pct}%` }} />
        </span>
      </div>
      <ul className="pulse-readiness">
        {sources.map((s) => (
          <li key={s.key} className={s.n > 0 ? 'is-on' : ''}>
            <span className="pulse-readiness-mark" aria-hidden="true">
              {s.n > 0 ? <Icon.check width="12" height="12" /> : <Icon.dot width="7" height="7" />}
            </span>
            <span className="pulse-readiness-text">
              <span className="pulse-readiness-label">{s.label}</span>
              <span className="pulse-readiness-unlocks">Unlocks {s.unlocks.toLowerCase()}</span>
            </span>
            {s.n > 0
              ? <span className="pulse-readiness-n">{s.n}</span>
              : <button type="button" className="pulse-readiness-go" onClick={() => navigate(s.to)}>Add</button>}
          </li>
        ))}
      </ul>
    </Card>
  )
}

/* ── working capital ──────────────────────────────────────────────────────── */

export function WorkingCapital({ d, idr, navigate }) {
  const rec = Number(d.receivables || 0)
  const pay = Number(d.payables || 0)
  const pendRec = Number(d.pendingReceivables || 0)
  const pendPay = Number(d.pendingPayables || 0)
  const max = Math.max(rec, pay)
  // Presentational only: the two bars are proportional to two figures the API returned.
  const pctOf = (v) => (max > 0 ? Math.round((v / max) * 100) : 0)
  const empty = rec === 0 && pay === 0 && pendRec === 0 && pendPay === 0

  return (
    <Card title="Working capital"
      action={empty ? null : (
        <StatusBadge tone={pay > rec ? 'warning' : 'neutral'}>
          {pay > rec ? 'Owed more than owed to you' : 'Balanced'}
        </StatusBadge>
      )}>
      {empty ? (
        <div className="pulse-empty">
          <span className="pulse-empty-ic"><Icon.transfer width="20" height="20" aria-hidden="true" /></span>
          <p className="pulse-empty-title">Nothing owed either way yet</p>
          <p className="pulse-empty-body">
            Once you record what customers owe you and what you owe suppliers, this compares the
            two side by side — the gap between them is what working capital actually means.
          </p>
          <Btn sm variant="ghost" onClick={() => navigate('/business/receivables')}>Add a receivable</Btn>
        </div>
      ) : (
        <>
          <div className="pulse-wc">
            {[
              { label: 'Receivables', v: rec, pending: pendRec, tone: 'pos', note: 'Owed to you' },
              { label: 'Payables', v: pay, pending: pendPay, tone: 'neg', note: 'You owe' },
            ].map((row) => (
              <div key={row.label} className="pulse-wc-row">
                <div className="pulse-wc-head">
                  <span className="pulse-wc-label">{row.label}<em>{row.note}</em></span>
                  <span className={`pulse-wc-v ${row.tone}`}>{idr(row.v)}</span>
                </div>
                <span className="pulse-wc-bar">
                  <span className={`pulse-wc-fill ${row.tone}`} style={{ width: `${pctOf(row.v)}%` }} />
                </span>
                {row.pending > 0 && (
                  <span className="pulse-wc-pending">+{idr(row.pending)} pending — not counted in cash</span>
                )}
              </div>
            ))}
          </div>
          <p className="pulse-note">
            Receivables are not cash. They are shown beside payables so the gap between what is
            owed to you and what you owe is visible at a glance.
          </p>
        </>
      )}
    </Card>
  )
}

/* ── metrics that cannot be computed honestly yet ─────────────────────────── */

// Compact by design: the shared header carries the reasoning once, so each card only has to
// name the metric and the one input that is missing. No numbers, no estimates.
const LOCKED_METRICS = [
  { key: 'ebitda', title: 'EBITDA',
    needs: 'Depreciation, amortisation, interest and tax as tracked expense types',
    to: '/business/accountant', cta: 'AI Accountant' },
  { key: 'capex', title: 'CAPEX',
    needs: 'A capital-expenditure category, so asset purchases can be told apart from ordinary spend',
    to: '/business/documents', cta: 'Documents' },
  { key: 'gross', title: 'Gross profit',
    needs: 'Cost of goods sold separated from operating costs',
    to: '/business/transactions', cta: 'Transactions' },
  { key: 'net', title: 'Estimated net profit',
    needs: 'Gross profit, plus everything below the operating line',
    to: '/business/accountant', cta: 'AI Accountant' },
]

export function UnavailableMetrics({ navigate }) {
  return (
    <Card title="Not available yet"
      action={<StatusBadge tone="neutral"><Icon.lock width="12" height="12" /> Needs richer data</StatusBadge>}>
      <p className="pulse-note pulse-locked-intro">
        These four need accounting detail the ledger does not carry today. They are left blank on
        purpose — an estimate here would be a number you could not defend to an accountant.
      </p>
      <ul className="pulse-locked-grid">
        {LOCKED_METRICS.map((m) => (
          <li key={m.key} className="pulse-locked">
            <span className="pulse-locked-title">{m.title}</span>
            <span className="pulse-locked-needs"><em>Needs</em>{m.needs}</span>
            <button type="button" className="pulse-locked-go" onClick={() => navigate(m.to)}>
              {m.cta}<Icon.chev width="13" height="13" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}

/* ── action center ────────────────────────────────────────────────────────── */

const ACTIONS = [
  { key: 'wallet', label: 'Add business wallet', sub: 'Bank, cash, e-wallet or gateway', icon: 'wallet', to: '/business/accounts' },
  { key: 'document', label: 'Upload document', sub: 'Invoice, receipt or contract', icon: 'doc', to: '/business/documents' },
  { key: 'transaction', label: 'Add transaction', sub: 'Record money in or out', icon: 'list', to: '/business/transactions' },
  { key: 'provider', label: 'Connect payment provider', sub: 'Route incoming payments', icon: 'link', to: '/business/payment-connections' },
  { key: 'cfo', label: 'Ask AI CFO', sub: 'Questions about your numbers', icon: 'cfo', to: '/business/ai-cfo' },
  { key: 'team', label: 'Invite accountant or team', sub: 'Roles control what they see', icon: 'users', to: '/business/team' },
]

export function ActionCenter({ navigate, title = 'Action center' }) {
  return (
    <Card title={title}>
      <div className="pulse-actions">
        {ACTIONS.map((a) => {
          const C = Icon[a.icon] || Icon.dot
          return (
            <button key={a.key} type="button" className="pulse-action" onClick={() => navigate(a.to)}>
              <span className="pulse-action-ic"><C width="17" height="17" aria-hidden="true" /></span>
              <span className="pulse-action-text">
                <span className="pulse-action-label">{a.label}</span>
                <span className="pulse-action-sub">{a.sub}</span>
              </span>
              <Icon.chev width="15" height="15" className="pulse-action-chev" aria-hidden="true" />
            </button>
          )
        })}
      </div>
    </Card>
  )
}

/* ── AI CFO summary ───────────────────────────────────────────────────────── */

/**
 * Deterministic risk checks over figures the API already returned. These are plain
 * comparisons, stated in the copy so the reasoning is visible — not a model output and not
 * a hidden formula. `aiText` from the backend is shown verbatim as the current read.
 */
function risksOf(d) {
  const out = []
  const cash = Number(d.totalBalance || 0)
  const pay = Number(d.payables || 0)
  const runway = d.runway === 999 || d.runway == null ? null : Number(d.runway)
  if (runway !== null && runway < 30) out.push(`Runway is ${runway} days at the current burn rate.`)
  if (pay > cash && pay > 0) out.push('Payables exceed cash on hand — obligations are larger than the money available today.')
  if (Number(d.income || 0) === 0 && Number(d.expenses || 0) > 0) out.push('Spending is recorded this month but no income is.')
  return out
}

export function CfoSummary({ d, readiness, countsLoading, navigate, premium, empty }) {
  const risks = risksOf(d)
  const gaps = countsLoading ? [] : readiness.sources.filter((s) => s.n === 0).map((s) => s.label)
  return (
    <Card title="AI CFO summary"
      action={<span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <StatusBadge tone="info"><Icon.cfo width="13" height="13" /> Live</StatusBadge>
        {premium && <Btn sm variant="ghost" onClick={() => navigate('/business/ai-cfo')}>Ask AI CFO</Btn>}
      </span>}>
      <div className="pulse-cfo">
        <span className="pulse-cfo-ic"><Icon.cfo width="20" height="20" aria-hidden="true" /></span>
        <div className="pulse-cfo-body">
          <p className="pulse-cfo-read">
            {empty
              ? 'Nothing to analyse yet. This becomes a real read of your position as soon as the first account or transaction exists.'
              : (d.aiText || 'No urgent actions detected.')}
          </p>

          {!empty && (
            <div className="pulse-cfo-block">
              <span className="pulse-cfo-label">Risk</span>
              {risks.length
                ? <ul className="pulse-cfo-list">{risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
                : <p className="pulse-cfo-p">No threshold breached: runway, payables and income are all within normal range for the data recorded.</p>}
            </div>
          )}

          <div className="pulse-cfo-block">
            <span className="pulse-cfo-label">Data gaps</span>
            {gaps.length
              ? <p className="pulse-cfo-p">Not yet recorded: {gaps.join(', ').toLowerCase()}. Figures above are computed from what exists, so treat them as partial.</p>
              : <p className="pulse-cfo-p">All four data sources have records. Figures above are computed from a complete set of inputs.</p>}
          </div>

          <div className="pulse-cfo-block">
            <span className="pulse-cfo-label">Next action</span>
            <p className="pulse-cfo-p">
              {gaps.length
                ? `Add ${gaps[0].toLowerCase()} first — it feeds the largest number of figures on this page.`
                : risks.length
                  ? 'Review the risk above before committing to any large payment.'
                  : 'Keep recording transactions daily so runway and burn stay accurate.'}
            </p>
          </div>
        </div>
      </div>
    </Card>
  )
}

export function RecentActivity({ items, navigate }) {
  return (
    <Card title="Recent activity">
      {items.length === 0 ? (
        <div className="pulse-empty">
          <span className="pulse-empty-ic"><Icon.list width="20" height="20" aria-hidden="true" /></span>
          <p className="pulse-empty-title">No transactions yet</p>
          <p className="pulse-empty-body">
            The latest money movements appear here as a running sanity check on the totals above.
          </p>
          <Btn sm variant="ghost" onClick={() => navigate('/business/transactions')}>Add a transaction</Btn>
        </div>
      ) : <DataList items={items} />}
    </Card>
  )
}
