// DESIGN PREVIEW — visual QA for the PR #80 design foundation.
//
// Route /design-preview. Renders a 404 unless VITE_DESIGN_PREVIEW_ENABLED === 'true',
// following the same gating idiom as PreviewApp.jsx. Vite only exposes VITE_-prefixed
// env to the bundle, so a production build without the flag ships the 404 branch.
//
// Why it exists: PR #80 changed the shared PageHeader, the flagship card watermark, the
// token layer and the semantic colour of the Pulse KPIs. Those are visual claims, and a
// visual claim needs a picture. This page renders the ACTUAL production components —
// PageHeader, SummaryCard and Pulse's own ExecutiveHero — against fixed data, so a
// screenshot proves what shipped rather than what a hand-written mock looked like.
//
// Safety: no auth, no API, no Supabase, no customer data. Every figure below is invented
// and every company name is fictional. Nothing here writes anything.
import { formatAmount } from '../lib/money'
import en from '../i18n/en'
import { WalletsEmptyState } from './WalletsEmptyState'
import { walletsSummary } from './walletsSummary'
import { walletsSummaryByCurrency } from './walletsSummaryConcepts'
import { WalletCurrencyField } from './WalletCurrencyField'
import { CURRENCY_NAMES, formatCurrency, compactAmount } from '../lib/money'
import { PageHeader, SummaryCard, Card, Btn, StatusBadge, Icon } from '../shell/ui'
import { ExecutiveHero } from './business/PulseBlocks'
import { RadarHeader, RadarForecast, radarFigures } from './RadarBlocks'
import {
  AICFOHeader, AICFOSummary, AICFOScore, AICFOSignals, AICFOFigures,
  AICFORisks, AICFOActions, AICFOAsk, AICFOQuickNav, AICFOEmpty, SUGGESTED_KEYS,
} from './AICFOBlocks'
import { aiQuestionsLeft, hasNoFinancialData } from '../lib/aiCfoFigures'
import WorkspaceShell, { BUSINESS_NAV } from '../shell/WorkspaceShell'
import './DesignPreview.css'

const PREVIEW_ON = import.meta.env.VITE_DESIGN_PREVIEW_ENABLED === 'true'

// Same 404 the gated premium preview renders, so a disabled flag looks identical
// to a route that was never registered.
function NotFound() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-ui)', color: 'var(--text-muted)' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 64, color: 'var(--brand-navy)' }}>404</div>
        <div>Not found</div>
      </div>
    </div>
  )
}

// The production formatter, byte for byte the one Pulse uses (index.jsx:57).
const idr = (v) => 'Rp ' + formatAmount(String(v ?? 0), 'IDR')

// The product's own English strings, read straight out of the translation layer
// the real page uses. Not i18n/index's t(), because that resolves against the
// stored language (ru by default) and a screenshot has to be deterministic — and
// not a local copy of the words, because the last preview held its own copy of
// the zero state and the two drifted within a day.
const tEn = (key) => key.split('.').reduce((o, k) => (o == null ? o : o[k]), en) ?? key

/* ── fixtures ──────────────────────────────────────────────────────────────
   Invented companies, invented figures. No real balance, tax number, bank
   detail or counterparty appears anywhere in this file. The values are chosen
   to exercise the states, not to look plausible for any real business. */
const PULSE_FIXTURE = {
  totalBalance: 122850000,
  income: 78745000,
  expenses: 42450000,
  netPosition: 60294000,
  burnRate: 3282833,
  burnWindowDays: 30,
  runway: 37,
  sourcesConnected: 4,
  sourcesTotal: 4,
  // Named keys, not an items array — ExecutiveHero reads other.opening_balance,
  // other.funding and so on (PulseBlocks.jsx:124). An items array renders an empty list.
  other_cash_movement: { total: 17000000, opening_balance: 12000000, funding: 5000000 },
}

// The same shape with the signs that flip every semantic colour.
const PULSE_NEGATIVE = {
  ...PULSE_FIXTURE,
  income: 0,
  netPosition: -18200000,
  runway: 12,
}

/* The real app frame, driven by synthetic props.
   WorkspaceShell is presentational — its only hook is useState, and it reads
   nothing but the props below — so the shell in these screenshots is the shell
   the product ships, not a drawing of it. No auth, no router, no network. */
const SHELL_WORKSPACES = {
  personal: [{ id: 'demo-personal', name: 'Personal', type: 'personal', role: 'owner' }],
  business: [{
    id: 'demo-business', name: 'Nusantara Facilities', type: 'business',
    // No business_code: the switcher renders one when present, and a technical
    // identifier is not something a business user needs to read on every screen.
    role: 'owner', location: 'Bali, Indonesia',
  }],
}
const noop = () => {}

/* Radar — the same shape GET /api/pulse?scope=business returns.

   The due dates are offsets from today rather than fixed strings: Radar renders
   "in 12d" from daysUntil(), so a hardcoded date would make the label drift a day
   at a time and every screenshot diff would be noise. The offsets are fixed, so
   the rendered labels are stable. */
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
const RADAR_FIXTURE = {
  totalBalance: 122850000,
  burnRate: 3282833,
  burnWindowDays: 30,
  debts: [
    { id: 'r1', type: 'receivable', counterparty: 'PT Sinar Abadi', amount: 48200000, due_date: inDays(9) },
    { id: 'r2', type: 'receivable', counterparty: 'Bali Retail Group', amount: 17650000, due_date: inDays(23) },
    { id: 'p1', type: 'payable', counterparty: 'Kantor Pajak', amount: 21400000, due_date: inDays(4) },
    { id: 'p2', type: 'payable', counterparty: 'Supplier Nusantara', amount: 9800000, due_date: inDays(-3) },
  ],
}
// The zero-data case: a workspace with a balance but nothing planned.
const RADAR_EMPTY = { totalBalance: 122850000, burnRate: 3282833, burnWindowDays: 30, debts: [] }

/* ── AI CFO ────────────────────────────────────────────────────────────────
   The same shape GET /api/ai-cfo/context returns. The CFO Score, its factors,
   the alert and the hiring verdict are all SERVER output, so they are fixtures
   here rather than something the preview computes — which is the point: these
   are the numbers the page is handed, and the screenshot shows what it does
   with them. Invented company, invented figures, no real counterparty.

   The scores below are the engine's own values for their labels
   (server/index.js calculateCfoScore), so the picture is of a state the product
   can actually be in rather than an arrangement of plausible numbers. */
const AICFO_FIXTURE = {
  business: { name: 'Nusantara Facilities', base_currency: 'IDR', plan: 'founder', effective_plan: 'founder' },
  cash: { total_balance: 122850000, wallets_count: 4 },
  current_month: {
    income: 78745000, expenses: 42450000, net_flow: 36295000,
    transactions_count: 62, burn_rate: 3282833, burn_window_days: 30,
  },
  receivables: { total_remaining: 65850000, overdue_count: 0, overdue_total: 0 },
  payables: { total_remaining: 31200000, overdue_count: 0, overdue_total: 0 },
  runway_days: 37,
  cfo_score: {
    score: 80,
    status: 'healthy',
    summary: 'Strong cash position. All key metrics are positive.',
    factors: {
      cash_health: { score: 90, label: 'Strong cash position', impact: 'positive' },
      runway: { score: 70, label: 'Runway adequate (30+ days)', impact: 'neutral' },
      receivables: { score: 85, label: 'All receivables on time', impact: 'positive' },
      payables: { score: 80, label: 'Payables under control', impact: 'positive' },
      expense_control: { score: 92, label: 'Net flow positive', impact: 'positive' },
    },
  },
  ai_alert: {
    status: 'healthy',
    headline: 'Business is financially stable',
    description: 'Cash is strong with no urgent payment risks detected. Keep monitoring monthly.',
  },
  hiring_readiness: {
    status: 'ready',
    safe_monthly_salary: 12400000,
    recommendation: 'Income covers obligations.',
  },
  risks: [{ type: 'healthy', severity: 'low', title: 'No significant risks', description: 'Finances look stable', amount: 0 }],
  next_actions: [
    {
      action_type: 'receivable_due_soon', priority: 'medium', route: '/receivables',
      title: 'Rp 18.4M due within 7 days',
      description: 'Two invoices fall due this week — confirm payment dates.',
      amount: 18400000,
    },
    {
      action_type: 'pulse', priority: 'low', route: '/transactions',
      title: 'Keep the ledger current',
      description: 'Add transactions daily so the forecast stays accurate.',
      amount: 0,
    },
  ],
}

/* The state that has to be seen to be judged: a business under real pressure.
   Every band the page can paint appears at once — a critical score, a negative
   factor, a warning factor, a neutral one, a critical alert, "Not recommended"
   hiring, and overdue counts on both sides of the ledger. This is the picture
   that shows whether restrained red is still legible as red. */
const AICFO_RISK = {
  ...AICFO_FIXTURE,
  cash: { total_balance: 9420000, wallets_count: 3 },
  current_month: {
    income: 12100000, expenses: 34800000, net_flow: -22700000,
    transactions_count: 41, burn_rate: 1160000, burn_window_days: 30,
  },
  receivables: { total_remaining: 47300000, overdue_count: 4, overdue_total: 38900000 },
  payables: { total_remaining: 58600000, overdue_count: 3, overdue_total: 24500000 },
  runway_days: 8,
  cfo_score: {
    score: 41,
    status: 'critical',
    summary: 'Overdue payables exceed cash. Immediate action required.',
    factors: {
      cash_health: { score: 30, label: 'Cash critically low', impact: 'negative' },
      runway: { score: 20, label: 'Runway critical (<15 days)', impact: 'negative' },
      receivables: { score: 30, label: 'Most receivables overdue', impact: 'negative' },
      payables: { score: 20, label: 'Overdue payables exceed cash', impact: 'negative' },
      expense_control: { score: 62, label: 'Monthly expenses exceed income', impact: 'warning' },
    },
  },
  ai_alert: {
    status: 'critical',
    headline: 'Immediate cash action required',
    description: 'Overdue payables are larger than the cash on hand. Collect the overdue receivables and agree new dates with suppliers before committing to anything else.',
  },
  hiring_readiness: {
    status: 'not_ready',
    safe_monthly_salary: 0,
    recommendation: 'Not recommended',
  },
  risks: [
    { type: 'runway_critical', severity: 'critical', title: 'Only 8 days runway', description: 'Cash will run out very soon', amount: 9420000 },
    { type: 'overdue_payables', severity: 'high', title: '3 overdue payables', description: 'Payments overdue — may affect relationships', amount: 24500000 },
    { type: 'overdue_receivables', severity: 'high', title: '4 overdue receivables', description: 'Clients have not paid past due date', amount: 38900000 },
    { type: 'payables_due_soon', severity: 'medium', title: '2 payments due within 7 days', description: 'Upcoming cash outflows', amount: 11300000 },
  ],
  next_actions: [
    {
      action_type: 'payable_overdue', priority: 'high', route: '/payables',
      title: 'Kantor Pajak is 12 days overdue',
      description: 'The largest overdue payable — agree a date today.',
      amount: 14200000,
    },
    {
      action_type: 'receivable_followup', priority: 'high', route: '/receivables',
      title: 'Chase Rp 38.9M in overdue invoices',
      description: 'Four clients are past their due date.',
      amount: 38900000,
    },
    {
      action_type: 'cash_protection', priority: 'high', route: '/transactions',
      title: 'Hold discretionary spending',
      description: 'Runway is under two weeks at the current burn.',
      amount: 0,
    },
  ],
}

/* A workspace nobody has entered anything into.
   The engine still scores it — "not enough expense history" (70), "runway
   unknown" (60), "no receivables" (80), "no payables" (90, POSITIVE) and "no
   monthly data" (60) weight to 72 — so this fixture carries that real score to
   prove the page withholds the verdict rather than the engine withholding the
   number. hasNoFinancialData() is what decides, and the preview calls the
   production function rather than a copy of the rule. */
const AICFO_EMPTY = {
  business: { name: 'Nusantara Facilities', base_currency: 'IDR', plan: 'free', effective_plan: 'free' },
  cash: { total_balance: 0, wallets_count: 0 },
  current_month: { income: 0, expenses: 0, net_flow: 0, transactions_count: 0, burn_rate: 0, burn_window_days: 0 },
  receivables: { total_remaining: 0, overdue_count: 0, overdue_total: 0 },
  payables: { total_remaining: 0, overdue_count: 0, overdue_total: 0 },
  runway_days: null,
  cfo_score: {
    score: 72,
    status: 'warning',
    summary: 'Not enough expense history. Monitor closely and take action.',
    factors: {
      cash_health: { score: 70, label: 'Not enough expense history', impact: 'neutral' },
      runway: { score: 60, label: 'Runway unknown — add expenses', impact: 'neutral' },
      receivables: { score: 80, label: 'No receivables', impact: 'neutral' },
      payables: { score: 90, label: 'No payables', impact: 'positive' },
      expense_control: { score: 60, label: 'No monthly data yet', impact: 'neutral' },
    },
  },
  ai_alert: null,
  hiring_readiness: null,
  risks: [],
  next_actions: [],
}

/* Partially populated: wallets and transactions exist, but no receivable or
   payable has ever been entered, so two of the five factors are the engine's
   "nothing here" branches. It is NOT the empty state — there is real cash and a
   real burn behind the score — and the page has to show the difference. */
const AICFO_PARTIAL = {
  ...AICFO_FIXTURE,
  cash: { total_balance: 41500000, wallets_count: 1 },
  current_month: {
    income: 0, expenses: 8400000, net_flow: -8400000,
    transactions_count: 7, burn_rate: 280000, burn_window_days: 12,
  },
  receivables: { total_remaining: 0, overdue_count: 0, overdue_total: 0 },
  payables: { total_remaining: 0, overdue_count: 0, overdue_total: 0 },
  runway_days: 148,
  cfo_score: {
    score: 78,
    status: 'healthy',
    summary: 'Runway excellent (90+ days). Expenses significantly exceed income.',
    factors: {
      cash_health: { score: 78, label: 'Adequate cash reserves', impact: 'positive' },
      runway: { score: 100, label: 'Runway excellent (90+ days)', impact: 'positive' },
      receivables: { score: 80, label: 'No receivables', impact: 'neutral' },
      payables: { score: 90, label: 'No payables', impact: 'positive' },
      expense_control: { score: 48, label: 'Expenses significantly exceed income', impact: 'negative' },
    },
  },
  ai_alert: null,
  hiring_readiness: { status: 'insufficient_data', safe_monthly_salary: 0, recommendation: 'Add wallets, transactions and expenses to calculate safe hiring budget.' },
  risks: [{ type: 'healthy', severity: 'low', title: 'No significant risks', description: 'Finances look stable', amount: 0 }],
  next_actions: [],
}

// The plan shape useAccess() derives planLabel and the question cap from.
const AICFO_ACCESS = { limits: { max_ai_questions_per_month: 200 }, usage: { ai_questions_this_month: 0 } }
const AICFO_ACCESS_FREE = { limits: { max_ai_questions_per_month: 10 }, usage: { ai_questions_this_month: 0 } }

/* A conversation, for the screenshot of the chat panel. Declared here with the
   other fixtures rather than beside the component that uses it: AICFO_SHELLS
   below refers to it, and a const referenced above its own declaration is a
   temporal-dead-zone ReferenceError that takes the whole module down. */
const AICFO_CHAT = [
  { role: 'user', content: 'What is my biggest cash risk?' },
  {
    role: 'assistant',
    content: 'Your biggest exposure is **Rp 38.9M in overdue receivables** across four '
      + 'clients, against **Rp 9.4M** of cash on hand. Collecting even half of it would '
      + 'cover the three overdue payables.',
  },
]

const LONG_TITLE = 'Nusantara Integrated Facilities Management & Industrial Services'
const LONG_DESC = 'Cash position, this month’s operating figures and anything waiting on you — '
  + 'including unclassified transactions, documents awaiting confirmation and any tax deadline '
  + 'falling inside the next reporting period.'

// ?only=<id> renders a single example. Screenshot tooling captures the top of the
// viewport, so a hash anchor is not enough to frame one component — this is.
const params = typeof location !== 'undefined'
  ? new URLSearchParams(location.search)
  : new URLSearchParams()
const ONLY = params.get('only')
// ?shell=pulse | ?shell=accounts renders the page inside the real application
// frame, which is the only way a screenshot can speak to sidebar, gutters and
// content width rather than to a component floating on a blank page.
const SHELL = params.get('shell')

const Section = ({ id, title, note, children, wide }) => (
  ONLY && ONLY !== id ? null : (
  <section className="dsp-section" id={id}>
    <div className="dsp-section-head">
      <h2 className="dsp-h2">{title}</h2>
      {note && <p className="dsp-note">{note}</p>}
    </div>
    <div className={wide ? 'dsp-stage dsp-stage-wide' : 'dsp-stage'}>{children}</div>
  </section>
  )
)

// Page bodies, shared by the isolated catalogue and the in-shell views, so the
// two can never drift into showing different things.
const PulseBody = () => (
  <>
    <PageHeader
      eyebrow="Business Workspace"
      title="Nusantara Facilities"
      description="Cash position, this month's operating figures and anything waiting on you."
    />
    <ExecutiveHero d={PULSE_FIXTURE} idr={idr} readiness={null} empty={false} />
  </>
)

/* Wallets, in both of the states the page really has.

   These are fixtures for the SAME branch the production page takes, not a second
   rendering of it: the totals, the compact/exact split, the wallet count and the
   zero state all come out of the same expressions and the same components
   Accounts.jsx uses. That matters because the previous concept was hand-copied
   markup, and it ended up showing "Add your first wallet" underneath a card
   claiming four wallets and Rp 152 450 000 — a state the product cannot be in.

   Four IDR wallets, summing to exactly Rp 152 450 000. */
const WALLETS_FIXTURE = [
  { id: 'w1', name: 'BCA · Operating', currency: 'IDR', balance: 94200000 },
  { id: 'w2', name: 'Mandiri · Payroll', currency: 'IDR', balance: 38500000 },
  { id: 'w3', name: 'Cash box · Denpasar', currency: 'IDR', balance: 12750000 },
  { id: 'w4', name: 'Xendit settlement', currency: 'IDR', balance: 7000000 },
]
const WALLETS_EMPTY = []
// A workspace that banks in dollars. The headline must be written in ITS currency
// — "$1.2M", never "Rp" in front of dollars.
const WALLETS_USD = [
  { id: 'u1', name: 'Wise · USD operating', currency: 'USD', balance: 842500 },
  { id: 'u2', name: 'Mercury · reserves', currency: 'USD', balance: 410000 },
]
// The case that started this: unlike currencies in one workspace. There is no
// rate in this product, so there is no combined total — one labelled amount each.
const WALLETS_MIXED = [...WALLETS_FIXTURE, ...WALLETS_USD]
// A wallet whose currency was never set. It is counted, never totalled, and the
// row asks for the currency instead of being folded into someone else's total.
const WALLETS_NEEDS_CURRENCY = [
  ...WALLETS_FIXTURE.slice(0, 2),
  { id: 'x1', name: 'Imported · unknown currency', currency: null, balance: 5000000 },
]
// Four currencies, for the layout stress test, plus a deliberately long figure.
const WALLETS_SGD = [{ id: 's1', name: 'DBS · SGD', currency: 'SGD', balance: 8200 }]
const WALLETS_EUR = [{ id: 'e1', name: 'Revolut · EUR', currency: 'EUR', balance: 12400 }]
const WALLETS_FOUR = [...WALLETS_FIXTURE, ...WALLETS_USD, ...WALLETS_SGD, ...WALLETS_EUR]
const WALLETS_LONG = [
  { id: 'L1', name: 'Consolidated treasury', currency: 'IDR', balance: 999999999 },
  { id: 'L2', name: 'USD treasury', currency: 'USD', balance: 98765432 },
]
const WALLET_SETS = {
  'accounts': WALLETS_FIXTURE,
  'accounts-empty': WALLETS_EMPTY,
  'accounts-usd': WALLETS_USD,
  'accounts-mixed': WALLETS_MIXED,
  'accounts-nocur': WALLETS_NEEDS_CURRENCY,
  'accounts-four': WALLETS_FOUR,
}
// Radar is a different page shape, so it gets its own shell routes rather than a
// wallet collection.
const RADAR_SHELLS = { radar: RADAR_FIXTURE, 'radar-empty': RADAR_EMPTY }
// AI CFO likewise. Four states, because the page's whole job is a verdict and
// each of these is a different verdict — including the one it declines to give.
const AICFO_SHELLS = {
  'ai-cfo': { data: AICFO_FIXTURE, access: AICFO_ACCESS, planLabel: 'Founder', messages: [] },
  'ai-cfo-risk': { data: AICFO_RISK, access: AICFO_ACCESS, planLabel: 'Founder', messages: AICFO_CHAT },
  'ai-cfo-empty': { data: AICFO_EMPTY, access: AICFO_ACCESS_FREE, planLabel: 'Free Plan', messages: [] },
  'ai-cfo-partial': { data: AICFO_PARTIAL, access: AICFO_ACCESS_FREE, planLabel: 'Trial · 6d left', messages: [] },
}

/* ── the APPROVED future model, for reference only ─────────────────────────
   Balances by currency, once the backend derives native balances. It is not
   wired into any production page: today Accounts totals IDR and says plainly
   that other currencies are not totalled yet, because its balances come from
   amount_idr.

   The approved shape: the base currency stays visually primary in the navy
   flagship; every other currency is shown separately beside it; there is no
   combined grand total and no implied conversion. Deliberately not a navy hero
   per currency — competing heroes make a page with no subject, and this layout
   must never suggest one figure is the sum of the others.

   See walletsSummaryConcepts.jsx for what activating it requires. */
const CurrencyConcept = ({ wallets }) => {
  const sum = walletsSummaryByCurrency({
    wallets, t: tEn, scopeLabel: tEn('accounts.totalBalance'),
  })
  return (
    <>
      {/* A literal, not a translation key: this heading belongs to the preview
          until the model activates, and a production string for an inactive
          feature is a string that ships for nothing. */}
      <p className="dsp-cur-heading">Balances by currency</p>
      <SummaryCard flagship compact={sum.compact}
        label={sum.label} value={sum.value} meta={sum.meta} />
      {sum.secondary && (
        <div className="dsp-cur-aside">
          {sum.secondary.map((g) => (
            <div key={g.currency} className="dsp-cur-aside-item">
              <span className="dsp-cur-aside-code">{g.currency} — {CURRENCY_NAMES[g.currency] || g.currency}</span>
              <span className="fin dsp-cur-aside-amt">
                {compactAmount(g.total, g.currency) || formatCurrency(g.total, g.currency)}
              </span>
              <span className="dsp-cur-aside-sub">
                {formatCurrency(g.total, g.currency)} · {g.wallets.length === 1
                  ? tEn('accounts.walletsCountOne')
                  : tEn('accounts.walletsCountMany').replace('{n}', g.wallets.length)}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

const RadarBody = ({ data = RADAR_FIXTURE, hasAdvanced = false }) => {
  const figures = radarFigures(data)
  return (
    <>
      <RadarHeader t={tEn} isHealthy={figures.isHealthy} />
      <RadarForecast figures={figures} t={tEn} hasAdvanced={hasAdvanced} />
    </>
  )
}

/* AI CFO, as the product renders it.
   Every block is the production component from AICFOBlocks.jsx, and the
   empty-state decision is the production hasNoFinancialData() — not a copy of
   the rule, so the preview cannot show a state the page would not. The chat is
   given a fixed conversation rather than live state; the container owns the
   state in the real page, which is exactly why the panel takes it as props.

   `lang="en"` for the same reason this file uses tEn: the engine strings pass
   through localizeInsight(), which otherwise follows whatever language the
   developer has stored, and a screenshot has to be deterministic. */
const AICFOBody = ({ data = AICFO_FIXTURE, access = AICFO_ACCESS, planLabel = 'Founder', messages = [] }) => {
  const aiQLeft = aiQuestionsLeft(access)
  const empty = hasNoFinancialData(data)
  const askPanel = (
    <AICFOAsk t={tEn} messages={messages} suggestions={SUGGESTED_KEYS} aiQLeft={aiQLeft} />
  )
  return (
    <div className="aicfo-page">
      <AICFOHeader t={tEn} onRefresh={noop} />
      <AICFOSummary ctx={data} t={tEn} planLabel={planLabel} aiQLeft={aiQLeft} />
      {empty ? (
        <>
          <AICFOEmpty t={tEn} onNavigate={noop} />
          {askPanel}
        </>
      ) : (
        <>
          <AICFOScore score={data.cfo_score} t={tEn} lang="en" />
          <AICFOSignals ctx={data} t={tEn} onAsk={noop} lang="en" />
          <AICFOFigures ctx={data} t={tEn} onNavigate={noop} />
          <AICFORisks ctx={data} t={tEn} />
          <AICFOActions ctx={data} t={tEn} onNavigate={noop} />
          {askPanel}
          <AICFOQuickNav ctx={data} t={tEn} onNavigate={noop} />
        </>
      )}
    </div>
  )
}

const AccountsBody = ({ wallets = WALLETS_FIXTURE }) => {
  // The production derivation, called with the production translations. Not a
  // mirror of Accounts.jsx — literally the function Accounts.jsx calls, so the
  // currency rule cannot hold in one and not the other.
  const summary = walletsSummary({
    wallets, t: tEn, scopeLabel: tEn('accounts.totalBalance'),
  })
  return (
    <>
      <PageHeader
        title={tEn('accounts.walletsAccounts')}
        description={tEn('accounts.walletsSubtitle')}
        primaryAction={<Btn variant="primary">{tEn('accounts.addWallet')}</Btn>}
      />
      <SummaryCard flagship compact={summary.compact}
        label={summary.label} value={summary.value} meta={summary.meta} />
      {/* The real zero-state component, not a drawing of it. */}
      {wallets.length === 0 && <WalletsEmptyState t={tEn} onAddWallet={noop} />}
    </>
  )
}

// ?shell=accounts[-empty|-usd|-mixed|-nocur] renders the same page against
// different resolved wallet collections. Every one is the same branch of the same
// component; only the data differs.
function ShellPreview({ page }) {
  const isAccounts = Object.prototype.hasOwnProperty.call(WALLET_SETS, page)
  const isRadar = Object.prototype.hasOwnProperty.call(RADAR_SHELLS, page)
  const isAiCfo = Object.prototype.hasOwnProperty.call(AICFO_SHELLS, page)
  return (
    // No preview banner here on purpose: these are pictures of the product frame,
    // and a strip of our own chrome above it would misrepresent what ships.
    <div className="dsp-shell">
      <WorkspaceShell
        workspaces={SHELL_WORKSPACES}
        activeId="demo-business"
        onSelectWorkspace={noop}
        nav={BUSINESS_NAV}
        activeKey={isAiCfo ? 'cfo' : isRadar ? 'radar' : isAccounts ? 'accounts' : 'pulse'}
        onNavigate={noop}
      >
        {isAiCfo
          ? <AICFOBody {...AICFO_SHELLS[page]} />
          : isRadar
            ? <RadarBody data={RADAR_SHELLS[page]} />
            : isAccounts ? <AccountsBody wallets={WALLET_SETS[page]} /> : <PulseBody />}
      </WorkspaceShell>
    </div>
  )
}

export default function DesignPreview() {
  if (!PREVIEW_ON) return <NotFound />
  if (SHELL) return <ShellPreview page={SHELL} />

  return (
    <div className="dsp-root">
      <div className="dsp-banner" role="note">
        DESIGN PREVIEW · SYNTHETIC DATA · NOT A CUSTOMER PAGE
      </div>

      <div className="dsp-wrap">
        {/* Deliberately not an h1: each example below renders the real PageHeader,
            which owns the h1. A catalogue page must not compete with the thing it
            is cataloguing. */}
        <p className="dsp-title">PR #80 — design foundation</p>
        <p className="dsp-lede">
          The real components, not a mock: <code>PageHeader</code>, <code>SummaryCard</code> and
          {' '}<code>FlagshipMark</code> from <code>shell/ui.jsx</code>, and Pulse&rsquo;s own
          {' '}<code>ExecutiveHero</code>. Every figure is invented.
        </p>

        {/* ── Pulse ────────────────────────────────────────────────────── */}
        <Section id="pulse" title="Pulse" wide
          note="Shared header with a description, the navy flagship card wearing the shared mark, and the KPI row — which stays unbranded.">
          <PulseBody />
        </Section>

        {/* ── the Add Wallet currency contract ─────────────────────────── */}
        <Section id="currency-field" title="Add wallet — currency"
          note="The real control from the Add / Edit wallet form. Required, chosen from a fixed ISO 4217 list and never typed, code shown with its readable name. Currencies whose native balance the backend cannot yet prove are visible but disabled with the reason; an existing wallet's currency cannot be changed at all, because the API would rewrite it and silently relabel every transaction the wallet already holds.">
          <div className="dsp-form">
            <WalletCurrencyField
              currencies={['IDR', 'USD', 'EUR', 'SGD', 'MYR', 'THB', 'CNY']}
              value="IDR" onChange={noop} locked={false}
              styleFor={() => ({ bg: '#E8F0FE', color: '#003366' })} t={tEn} />
            <WalletCurrencyField
              currencies={['IDR', 'USD', 'EUR', 'SGD']}
              value="IDR" onChange={noop} locked
              styleFor={() => ({ bg: '#E8F0FE', color: '#003366' })} t={tEn} />
          </div>
        </Section>

        {/* ── APPROVED FUTURE MODEL — not active in production ──────────── */}
        <Section id="currency-concepts" title="Balances by currency — approved, NOT YET ACTIVE" wide
          note="The approved future model, for reference only. It is not wired into any production page and is absent from the flag-off bundle. The base currency stays visually primary in the navy flagship; every other currency is shown separately beside it; there is no combined grand total and no implied conversion. Activating it requires a backend that derives native wallet balances — today Accounts totals IDR only, because balances come from amount_idr.">
          <CurrencyConcept wallets={WALLETS_MIXED} />
          <CurrencyConcept wallets={WALLETS_FOUR} />
          <p className="dsp-note"><strong>Long values</strong></p>
          <CurrencyConcept wallets={WALLETS_LONG} />
        </Section>

        {/* ── Radar ─────────────────────────────────────────────────────── */}
        <Section id="radar" title="Radar" wide
          note="The last page outside the shared system. It drew its own header, an inline navy gradient with a graph-paper grid, and hf-card panels. It now uses the same PageHeader and the same flagship SummaryCard as Pulse and Accounts — so it carries the one official watermark, the compact-over-exact amount hierarchy and the canonical navy. Every figure is unchanged: same expressions, same endpoint, same formatters. Best and worst case stopped being solid colour panels; the colour is on the figure now.">
          <RadarBody />
        </Section>

        <Section id="radar-empty" title="Radar — nothing planned" wide
          note="Zero-data. The forecast still holds, because a balance and a burn rate are enough for one; what is missing is planned movement, so the key-dates panel becomes a real empty state at the symbol's normal size rather than a page-sized logo.">
          <RadarBody data={RADAR_EMPTY} hasAdvanced />
        </Section>

        {/* ── AI CFO ────────────────────────────────────────────────────── */}
        <Section id="ai-cfo" title="AI CFO" wide
          note="The last business page outside the shared system. It drew its own header with no h1 at all, a dark hero from .hf-dark-card — the legacy #0F172A navy with a graph-paper grid built from two repeating-linear-gradients — and hf-card panels, across 105 inline style blocks, 9 hex literals, 18 rgba() literals and 16 emoji standing in for icons. It now uses the same PageHeader and the same flagship SummaryCard as Pulse, Accounts and Radar, so it carries the one official watermark and the canonical navy. Every figure is unchanged: the CFO Score, its five factors and their thresholds, the alert and the hiring verdict are all server output and arrive ready to render. Money names its currency; days and scores do not.">
          <AICFOBody />
        </Section>

        <Section id="ai-cfo-risk" title="AI CFO — a business under pressure" wide
          note="Every band the page can paint, at once: a critical score, four negative or warning factors, a critical alert and a hiring verdict of Not recommended. The alert and the hiring card used to be solid tinted panels — a filled amber block for a warning, a filled red one for Not recommended — which made a considered opinion about a business read as a system error. They are ordinary cards with a restrained severity stripe now, and red still reads as red.">
          <AICFOBody data={AICFO_RISK} messages={AICFO_CHAT} />
        </Section>

        <Section id="ai-cfo-empty" title="AI CFO — nothing recorded yet" wide
          note="The engine scores the ABSENCE of data as readily as data: an untouched workspace takes the not-enough-expense-history (70), runway-unknown (60), no-receivables (80), no-payables (90, impact positive) and no-monthly-data (60) branches, which weight to 72 — so a business that has entered nothing was being told its financial health was 72 out of 100 and its payables were in excellent shape. The fixture behind this screenshot carries that real 72. Not one threshold or weight changed; the page declines to present a verdict with nothing behind it and asks for the first transaction instead. Cash stays on screen at Rp 0, because zero cash with zero wallets is true.">
          <AICFOBody data={AICFO_EMPTY} access={AICFO_ACCESS_FREE} planLabel="Free Plan" />
        </Section>

        <Section id="ai-cfo-partial" title="AI CFO — partially populated" wide
          note="Wallets and transactions exist; no receivable or payable ever has. Two of the five factors are the engine's nothing-here branches and one is a real negative, so the page shows the score — there is genuine cash and a genuine burn behind it — while the hiring card has too little to work with and says so. This is the state the empty case must not be confused with.">
          <AICFOBody data={AICFO_PARTIAL} access={AICFO_ACCESS_FREE} planLabel="Trial · 6d left" />
        </Section>

        {/* ── Accounts, other currencies ───────────────────────────────── */}
        <Section id="accounts-currencies" title="Wallets — what this release actually says" wide
          note="A balance belongs to one currency, and a currency is only totalled once its native balance is provable. Accounts reads the business endpoint, whose balance is a sum of amount_idr — so IDR is provable and nothing else is. A dollar-only workspace therefore reports no figure at all rather than printing rupiah behind a dollar sign; a mixed workspace totals its IDR and says how many wallets it left out; a wallet with no currency is counted and asked about. None of these invent a number.">
          <AccountsBody wallets={WALLETS_USD} />
          <AccountsBody wallets={WALLETS_MIXED} />
          <AccountsBody wallets={WALLETS_FOUR} />
          <AccountsBody wallets={WALLETS_NEEDS_CURRENCY} />
        </Section>

        {/* ── Accounts, empty ──────────────────────────────────────────── */}
        <Section id="accounts-empty" title="Wallets — no accounts yet" wide
          note="The zero state, from the component the real page renders. The card stays and tells the truth — Rp 0, no wallets added yet — rather than disappearing and rebuilding the page around the first wallet. One call to action, wired to the page's existing add-wallet flow.">
          <AccountsBody wallets={WALLETS_EMPTY} />
        </Section>

        {/* ── Accounts ─────────────────────────────────────────────────── */}
        <Section id="accounts" title="Accounts" wide
          note="The same header and the same navy flagship card, from the same components and the same watermark — this page used to draw its own gradient with a graph-paper grid.">
          <AccountsBody />
        </Section>

        {/* ── semantic colour ──────────────────────────────────────────── */}
        <Section id="semantic" title="Semantic colour" wide
          note="Same component, figures flipped: zero revenue is no longer green, cash out is ink, a negative net position is red and a short runway warns.">
          <ExecutiveHero d={PULSE_NEGATIVE} idr={idr} readiness={null} empty={false} />
          <div className="dsp-chips">
            <span className="dsp-chip dsp-ok">Reconciled — success</span>
            <span className="dsp-chip dsp-warn">Needs review — warning</span>
            <span className="dsp-chip dsp-bad">Overdue 42 days — danger</span>
            <span className="dsp-chip dsp-info">AI suggestion — info</span>
          </div>
          <div className="dsp-values">
            <span className="fin dsp-v-pos">+ {idr(78745000)}</span>
            <span className="fin dsp-v-ink">− {idr(42450000)}</span>
            <span className="fin dsp-v-warn">37 days</span>
            <span className="fin dsp-v-neg">− {idr(18200000)}</span>
          </div>
        </Section>

        {/* ── wrapping ─────────────────────────────────────────────────── */}
        <Section id="wrapping" title="Long title and description" wide
          note="A long company name and a long description must wrap without pushing the actions off the row or clipping.">
          <PageHeader
            eyebrow="Business Workspace"
            title={LONG_TITLE}
            description={LONG_DESC}
            primaryAction={<Btn variant="primary">Primary action</Btn>}
            secondaryActions={<Btn variant="ghost">Secondary</Btn>}
            context={<>
              <StatusBadge tone="shared" icon={<Icon.users />}>Shared workspace</StatusBadge>
              <StatusBadge tone="neutral">Owner</StatusBadge>
            </>}
          />
        </Section>

        {/* ── the two branding layers ──────────────────────────────────── */}
        <Section id="watermark" title="Branding layers" wide
          note="Two marks, deliberately unequal. This header has no controls, so it carries the ambient page-hero mark at 3.5% set well inside a reserved column no text may enter; the flagship navy card carries the brand moment at 7%, cropped by the card edge. An action header (Accounts, and the long-title example above) drops the hero mark rather than sit it behind a control. Both marks are absent from the accessibility tree.">
          <PageHeader
            eyebrow="Business Workspace"
            title="Nusantara Facilities"
            description="With no action on this header, the hero symbol sits inside the band with clear space around it, so it reads as a background watermark rather than an icon clipped by the layout."
          />
          <SummaryCard
            flagship
            label="Total cash · IDR"
            value={<span className="fin">{idr(122850000)}</span>}
            meta="Cropped by the card edge, and behind nothing anyone has to read."
          />
          {/* The same component with the prop left off — the difference between a
              flagship card and an ordinary one is one word at the call site. */}
          <SummaryCard
            label="An ordinary summary card · no mark"
            value={<span className="fin">{idr(4820000)}</span>}
            meta="The watermark is opt-in, so every other card on every page stays plain."
          />
        </Section>

        {/* ── focus ────────────────────────────────────────────────────── */}
        <Section id="focus" title="Focus and controls"
          note="Tab through these. The ring is the brand blue's accessible ink (#1565C0) at 2px with a 2px offset — 3.65:1 against the page and 5.75:1 on white, where the raw accent measured 2.76:1. On navy surfaces it switches to white.">
          <Card title="Interactive">
            <div className="dsp-row">
              <Btn variant="primary" className="dsp-focus-target">Primary</Btn>
              <Btn variant="ghost">Secondary</Btn>
              <Btn variant="secondary">Emphasis</Btn>
              <a href="#pulse" className="dsp-link">A link</a>
            </div>
          </Card>
        </Section>
      </div>
    </div>
  )
}
